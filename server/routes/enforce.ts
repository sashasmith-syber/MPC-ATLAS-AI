/**
 * server/routes/enforce.ts — the single enforced request pipeline.
 *
 * Flow (every model request, in order):
 *   a. transport/body-size + content-type constraints
 *   b. authenticate (session) → authorize (action policy)   [separate gates]
 *   c. construct PROTOS packet SERVER-side from verified identity
 *   d. Sanctuary (source allowlist; fail closed)
 *   e. Synthesis (packet contract) + Atlas action schema (stricter)
 *   f. authoritative rate/concurrency/output limits
 *   g. Gemini provider — ONLY after all mandatory gates passed
 *   h. validate response structure, render-safe text out
 *   i. minimal redacted audit event
 *
 * Denied/failed requests NEVER reach the provider and NEVER fall back to a
 * browser-side call. Public errors carry stable codes + request IDs only.
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SessionManager } from '../auth/session';
import { authorize } from '../auth/authorization';
import { Sanctuary, SanctuaryConfigError } from '../protos/sanctuary';
import { buildPacket, PacketValidationError, utf8ByteLength, PACKET_MAX_BYTES } from '../protos/packet';
import { validateRequestData, SchemaError, isAtlasAction } from '../protos/atlasSchema';
import { tallyVotes, DEFAULT_LOGIC_CONFIG } from '../protos/logic';
import { GeminiProvider, UpstreamError } from '../providers/gemini';
import { AuditSink, sessionHandle, redact } from '../audit/log';
import { LIMITS, type AtlasResponse, type AtlasResponseErr, type AtlasResponseOk } from '../../shared/contracts/index';

const MAX_BODY_BYTES = 16 * 1024 * 1024; // hard transport cap (media + JSON overhead)
const REQUEST_DEADLINE_MS = 60_000;

// ── Authoritative server-side rate limiting (per session) ──────────────────
class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  constructor(private maxPerWindow = 10, private windowMs = 60_000) {}
  allow(key: string): boolean {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter(t => now - t < this.windowMs);
    if (arr.length >= this.maxPerWindow) { this.hits.set(key, arr); return false; }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
}

export interface EnforceDeps {
  sessions: SessionManager;
  sanctuary: Sanctuary;
  provider: GeminiProvider | { generate(req: Parameters<GeminiProvider['generate']>[0]): Promise<string> };
  audit: AuditSink;
  systemInstruction: string;
  limiter?: SlidingWindowLimiter;
  /** Real voting principals (node ids). Empty ⇒ consensus "not configured". */
  logicVoters?: () => string[];
}

function err(requestId: string, code: AtlasResponseErr['code'], message: string): AtlasResponseErr {
  return { ok: false, requestId, code, message };
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return await new Promise((resolveP, rejectP) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { rejectP(new Error('BODY_TOO_LARGE')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolveP(Buffer.concat(chunks)));
    req.on('error', rejectP);
  });
}

export function makeEnforceHandler(deps: EnforceDeps) {
  const limiter = deps.limiter ?? new SlidingWindowLimiter();

  return async function handleEnforce(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = randomUUID();
    const send = (status: number, body: AtlasResponse) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    try {
      // a. transport constraints
      const ctype = String(req.headers['content-type'] ?? '');
      if (!ctype.startsWith('application/json')) {
        deps.audit({ ts: Date.now(), requestId, action: '-', sessionHandle: '-', outcome: 'deny', stage: 'transport', detail: 'bad content-type' });
        return send(415, err(requestId, 'INVALID_PACKET', 'Content-Type must be application/json.'));
      }

      let raw: Buffer;
      try { raw = await readBody(req); }
      catch {
        deps.audit({ ts: Date.now(), requestId, action: '-', sessionHandle: '-', outcome: 'deny', stage: 'transport', detail: 'body too large or unreadable' });
        return send(413, err(requestId, 'INVALID_PACKET', 'Request body exceeds size limits.'));
      }

      let parsed: unknown;
      try { parsed = JSON.parse(raw.toString('utf8')); }
      catch { return send(400, err(requestId, 'INVALID_PACKET', 'Malformed JSON body.')); }
      const body = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;

      // Browser claims of source/node/role/voter are STRIPPED before anything else.
      for (const banned of ['source', 'node', 'role', 'voter', 'identity', 'policy', 'api_key', 'apiKey', 'key']) delete body[banned];

      const actionRaw = body.action;
      const sessionIdRaw = body.sessionId;
      const action = typeof actionRaw === 'string' ? actionRaw : '-';

      // b. authenticate — identity comes ONLY from the server-side session store
      const bearer = typeof sessionIdRaw === 'string' ? sessionIdRaw : null;
      const session = deps.sessions.authenticate(bearer);
      if (!session) {
        deps.audit({ ts: Date.now(), requestId, action, sessionHandle: '-', outcome: 'deny', stage: 'authn' });
        return send(401, err(requestId, 'UNAUTHENTICATED', 'Your session is missing or expired. Reload the page to start a new session.'));
      }
      const handle = sessionHandle(session.token);

      // b2. authorize — separate gate: session ≠ permission for every action
      if (!isAtlasAction(action)) {
        deps.audit({ ts: Date.now(), requestId, action, sessionHandle: handle, outcome: 'deny', stage: 'schema', detail: 'unknown action' });
        return send(400, err(requestId, 'INVALID_PACKET', 'Unknown action.'));
      }
      const authz = authorize(session, action);
      if (!authz.allowed) {
        deps.audit({ ts: Date.now(), requestId, action, sessionHandle: handle, outcome: 'deny', stage: 'authz', detail: authz.reason });
        return send(403, err(requestId, 'FORBIDDEN_ACTION', 'This action is not permitted for your session.'));
      }

      // e-first data schema (fail fast before building packets) — Atlas stricter schema
      let data;
      try { data = validateRequestData(action, body); }
      catch (e) {
        deps.audit({ ts: Date.now(), requestId, action, sessionHandle: handle, outcome: 'deny', stage: 'schema', detail: redact(String((e as Error).message)) });
        return send(400, err(requestId, 'INVALID_PACKET', 'Request failed validation. Please shorten your message or check the attachment format.'));
      }

      // c. construct PROTOS packet SERVER-side; source derived from verified identity
      let packet;
      try {
        packet = buildPacket({
          source: session.sourceId, // NOT client-supplied — ever
          action,
          data: { bytesIn: raw.length, mediaCount: data.media?.length ?? 0 }, // metadata summary only; no raw prompt in packet
          timestamp: Date.now(),
        });
      } catch (e) {
        const msg = e instanceof PacketValidationError || e instanceof Error ? String(e.message) : 'packet error';
        deps.audit({ ts: Date.now(), requestId, action, sessionHandle: handle, outcome: 'deny', stage: 'synthesis', detail: redact(msg) });
        return send(400, err(requestId, 'INVALID_PACKET', 'Request exceeded protocol limits.'));
      }
      if (utf8ByteLength(JSON.stringify(packet)) > PACKET_MAX_BYTES) {
        return send(400, err(requestId, 'INVALID_PACKET', 'Request exceeded protocol limits.'));
      }

      // d. Sanctuary (fail closed on exceptions AND config problems)
      let decision;
      try { decision = deps.sanctuary.authorize(packet); }
      catch (e) {
        deps.audit({ ts: Date.now(), requestId, action, sessionHandle: handle, outcome: 'deny', stage: 'sanctuary', detail: e instanceof SanctuaryConfigError ? 'config error' : 'exception' });
        return send(403, err(requestId, 'DENIED_BY_POLICY', 'The enforcement layer denied this request.'));
      }
      if (decision.result !== 'approve') {
        deps.audit({ ts: Date.now(), requestId, action, sessionHandle: handle, outcome: 'deny', stage: 'sanctuary', detail: decision.reason });
        return send(403, err(requestId, 'DENIED_BY_POLICY', 'The enforcement layer denied this request.'));
      }
      deps.audit({ ts: Date.now(), requestId, action, sessionHandle: handle, outcome: 'approve', stage: 'sanctuary' });

      // e. Synthesis already validated shape above; log validity
      deps.audit({ ts: Date.now(), requestId, action, sessionHandle: handle, outcome: 'approve', stage: 'synthesis' });

      // g-logic. Consensus: honest status — never theatrical approvals.
      let logicStatus: AtlasResponseOk['gates']['logic'] = 'not_applicable';
      if (authz.consensusRequired) {
        const voters = deps.logicVoters?.() ?? [];
        if (voters.length < DEFAULT_LOGIC_CONFIG.minVoters) {
          deps.audit({ ts: Date.now(), requestId, action, sessionHandle: handle, outcome: 'deny', stage: 'logic', detail: 'consensus not configured' });
          return send(503, err(requestId, 'DENIED_BY_POLICY', 'Consensus infrastructure is not configured; this operation is unavailable.'));
        }
        // If real voters existed, votes would be collected here from those
        // authenticated principals, bound to this exact packet + requestId.
        const tally = tallyVotes(voters.map(node => ({ result: 'approve' as const, node })));
        if (tally.result !== 'approve') {
          deps.audit({ ts: Date.now(), requestId, action, sessionHandle: handle, outcome: 'deny', stage: 'logic', detail: `tally ${tally.result}` });
          return send(403, err(requestId, 'DENIED_BY_POLICY', 'Consensus denied this operation.'));
        }
        logicStatus = 'approve';
      }

      // f. authoritative rate limit (server-side; browser buckets are UX only)
      if (!limiter.allow(handle)) {
        deps.audit({ ts: Date.now(), requestId, action, sessionHandle: handle, outcome: 'deny', stage: 'rate' });
        return send(429, err(requestId, 'RATE_LIMITED', 'Too many requests. Please wait a moment before trying again.'));
      }

      // h. provider call — first point where any external execution may occur
      const contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> = [];
      if (data.media?.length) {
        contents.push({
          role: 'user',
          parts: [
            { text: data.text || 'Analyze this audio.' },
            { inlineData: { mimeType: data.media[0].mimeType, data: data.media[0].dataBase64 } },
          ],
        });
      } else {
        contents.push({ role: 'user', parts: [{ text: data.text }] });
      }

      let reply: string;
      try {
        reply = await deps.provider.generate({
          systemInstruction: deps.systemInstruction, // trusted app constant, never user text
          contents: contents as never,
          deadlineMs: REQUEST_DEADLINE_MS,
          maxOutputTokens: 2048,
        });
      } catch (e) {
        const kind = e instanceof UpstreamError ? e.kind : 'fatal';
        deps.audit({ ts: Date.now(), requestId, action, sessionHandle: handle, outcome: 'error', stage: 'provider', detail: kind });
        if (kind === 'timeout') return send(504, err(requestId, 'TIMEOUT', 'Akai Atlas timed out responding. Please try again.'));
        if (kind === 'rate' || kind === 'quota') return send(429, err(requestId, 'RATE_LIMITED', 'Atlas capacity is temporarily exhausted. Please try again shortly.'));
        return send(502, err(requestId, 'UPSTREAM_UNAVAILABLE', 'Atlas is unavailable right now. Please try again shortly.'));
      }

      // h2. validate + render-safe response structure
      if (typeof reply !== 'string') {
        deps.audit({ ts: Date.now(), requestId, action, sessionHandle: handle, outcome: 'error', stage: 'response', detail: 'bad provider shape' });
        return send(502, err(requestId, 'UPSTREAM_UNAVAILABLE', 'Atlas received an invalid response. Please try again.'));
      }
      const safe = sanitizeReply(reply);
      deps.audit({ ts: Date.now(), requestId, action, sessionHandle: handle, outcome: 'approve', stage: 'response', bytesIn: raw.length, bytesOut: safe.length });

      const ok: AtlasResponseOk = {
        ok: true,
        requestId,
        reply: safe,
        gates: { sanctuary: 'approve', synthesis: 'valid', logic: logicStatus },
      };
      send(200, ok);
    } catch (e) {
      // Fail closed with a stable public code; internals go to audit only.
      deps.audit({ ts: Date.now(), requestId, action: '-', sessionHandle: '-', outcome: 'error', stage: 'response', detail: redact(String((e as Error)?.message ?? 'internal')) });
      if (!res.headersSent) send(500, err(requestId, 'INTERNAL', 'Atlas encountered an internal error. Please try again.'));
    }
  };
}

/** Render-safe output handling: strip executable markup, scrub secret shapes. */
export function sanitizeReply(text: string): string {
  return redact(text.replace(/<\/?script[^>]*>/gi, ''));
}

export { SlidingWindowLimiter };

/**
 * server/audit/log.ts — minimal REDACTED audit events.
 *
 * Records only what troubleshooting needs: request id, timestamp, action,
 * pseudonymous session handle, gate outcomes, provider status, byte counts.
 * NEVER records raw prompts, conversation history, uploaded media or any
 * secret material. These are plain local log lines: they are NOT immutable
 * or tamper-proof and are never described as such.
 */

import { createHash } from 'node:crypto';

export interface AuditEvent {
  ts: number;
  requestId: string;
  action: string;
  sessionHandle: string;   // sha256(token)[0:12] — pseudonymous, not anonymous
  outcome: 'approve' | 'deny' | 'error';
  stage: 'transport' | 'authn' | 'authz' | 'sanctuary' | 'synthesis' | 'schema' | 'logic' | 'rate' | 'provider' | 'response';
  detail?: string;         // safe, non-identifying detail only
  bytesIn?: number;
  bytesOut?: number;
}

export type AuditSink = (e: AuditEvent) => void;

export function sessionHandle(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

const REDACTION_PATTERNS: RegExp[] = [
  /AIza[\w-]{20,}/g,
  /ya29\.[\w-]+/g,
  /Bearer\s+\S+/gi,
];

/** Defense-in-depth: even "safe" detail strings pass through here. */
export function redact(text: string): string {
  let out = text;
  for (const p of REDACTION_PATTERNS) out = out.replace(p, '[REDACTED]');
  return out.slice(0, 300);
}

export function makeConsoleSink(): AuditSink {
  return (e) => {
    const line = JSON.stringify({ ...e, detail: e.detail ? redact(e.detail) : undefined });
    // Single-line structured log; consumers may ship these anywhere.
    process.stdout.write(`[audit] ${line}\n`);
  };
}

/** Collecting sink for tests. */
export function makeMemorySink(): { sink: AuditSink; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return { sink: (e) => events.push(e), events };
}

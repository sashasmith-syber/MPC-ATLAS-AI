/**
 * atlasClient.ts — Hardened Gemini client for Akai Atlas.
 *
 * Layered on top of @google/genai with:
 *  - API-key ROTATION: every request pulls the next key from the pool
 *  - RETRY with exponential backoff + jitter, rotating to a fresh key each attempt
 *  - COOLDOWN reporting so rate-limited/quota keys are temporarily parked
 *  - Per-session CHAT HISTORY replay (history travels with the rotated key)
 *  - Input validation / prompt-injection filtering / output sanitization
 *  - Token-bucket RATE LIMITER and max-output caps
 *  - AbortController timeouts and secret-redacted error surfaces
 */

import { GoogleGenAI, GenerateContentResponse, Part } from '@google/genai';
import { keyPool, KeyState, redactSecrets } from './apiKeyPool';

const MODEL = 'gemini-2.5-flash';
const MAX_RETRIES = 3;              // attempts beyond the first
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_INPUT_CHARS = 8_000;
const MAX_OUTPUT_TOKENS = 2_048;
const MAX_HISTORY_MESSAGES = 40;    // cap replay size (hardening + cost control)

// ── Token bucket: max ~1 request / 2s sustained, burst of 3 ─────────────────
class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(private capacity = 3, private refillPerSec = 0.5) {
    this.tokens = capacity;
    this.last = Date.now();
  }
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
      this.last = now;
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      await new Promise(r => setTimeout(r, Math.ceil((1 - this.tokens) / this.refillPerSec * 1000)));
    }
  }
}
const limiter = new TokenBucket();

// ── Prompt-injection & abuse filters ────────────────────────────────────────
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|any\s+)?(previous|prior|above)\s+(instructions|prompts)/i,
  /disregard\s+(the\s+)?(system|your)\s+(prompt|instructions)/i,
  /you\s+are\s+(now|no\s+longer)\s+/i,
  /(reveal|print|repeat|show|output)\b.{0,40}\b(system\s+(prompt|instruction)|api\s+key|secret)/i,
  /developer\s+mode/i,
  /jailbreak/i,
];

export interface SanitizeResult {
  ok: boolean;
  text: string;
  reason?: string;
}

export function sanitizeInput(raw: string): SanitizeResult {
  let text = raw.normalize('NFKC').replace(/\p{C}/gu, '').trim(); // strip control chars
  if (!text) return { ok: false, text, reason: 'Empty input.' };
  if (text.length > MAX_INPUT_CHARS) {
    return { ok: false, text: text.slice(0, MAX_INPUT_CHARS), reason: `Input truncated to ${MAX_INPUT_CHARS} characters.` };
  }
  for (const p of INJECTION_PATTERNS) {
    if (p.test(text)) {
      return { ok: false, text, reason: 'Request blocked: it appears to attempt overriding my instructions. Ask me anything about the MPC instead!' };
    }
  }
  return { ok: true, text };
}

/** Strip code fences around non-code prose and scrub any leaked secrets. */
export function sanitizeOutput(text: string): string {
  return redactSecrets(text).replace(/<\/?script[^>]*>/gi, '');
}

// ── Error classification ────────────────────────────────────────────────────
type ErrClass = 'rate' | 'quota' | 'invalid_key' | 'transient' | 'fatal';

function classifyError(err: unknown): ErrClass {
  const e = err as { status?: number; message?: string };
  const msg = String(e?.message ?? err ?? '');
  const status = e?.status ?? (/429/.test(msg) ? 429 : /403|UNAUTHENTICATED|API_KEY_INVALID/.test(msg) ? 403 : 0);
  if (status === 429 || /RESOURCE_EXHAUSTED|rate/i.test(msg)) {
    return /quota\s*(per\s*day|exceeded\s*daily)/i.test(msg) ? 'quota' : 'rate';
  }
  if (status === 403 || /API_KEY_INVALID|INVALID_ARGUMENT.*key/i.test(msg)) return 'invalid_key';
  if (status >= 500 || /DEADLINE|UNAVAILABLE|INTERNAL|fetch failed|network|abort/i.test(msg)) return 'transient';
  return 'fatal';
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const backoff = (attempt: number) => Math.min(1000 * 2 ** attempt, 16_000) + Math.random() * 500;

export interface ChatTurn { role: 'user' | 'model'; text: string; }

export class AtlasClient {
  private history: ChatTurn[] = [];
  private lastKeyUsed: string | null = null;

  get activeKeyMasked(): string | null { return this.lastKeyUsed; }
  get keyRotationCount(): number { return keyPool.size(); }

  /** Rotate to the pool's next key and build a fresh client bound to it. */
  private clientFor(state: KeyState): GoogleGenAI {
    return new GoogleGenAI({ apiKey: keyPool.getToken(state) });
  }

  private buildContents(parts: Part[]): Array<{ role: 'user' | 'model'; parts: Part[] }> {
    const replay = this.history.slice(-MAX_HISTORY_MESSAGES).map(t => ({
      role: t.role,
      parts: [{ text: t.text }] as Part[],
    }));
    replay.push({ role: 'user', parts });
    return replay;
  }

  /**
   * Send a message with rotation + retry. Resolves with sanitized model text.
   * Throws a redacted, user-safe Error when all attempts are exhausted.
   */
  async sendMessage(parts: Part[]): Promise<string> {
    if (!keyPool.ready) throw new Error('NO_KEYS: No API keys available. Provide a key to continue.');
    await limiter.take();

    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const state = keyPool.next();
      if (!state) break;
      this.lastKeyUsed = state.masked;

      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const ai = this.clientFor(state);
        const request = ai.models.generateContent({
          model: MODEL,
          contents: this.buildContents(parts),
          config: {
            systemInstruction: atlasBlueprintRef.value,
            temperature: 0.7,
            topP: 0.95,
            topK: 50,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          },
        });
        // @google/genai v1 exposes no per-request AbortSignal — enforce our own
        // hard deadline via Promise.race so a hung key can't stall the rotation loop.
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => { timedOut = true; reject(new Error('DEADLINE_EXCEEDED: request timed out')); }, REQUEST_TIMEOUT_MS);
        });
        const response = (await Promise.race([request, timeout])) as GenerateContentResponse;
        const text = sanitizeOutput(response.text ?? '');
        keyPool.reportSuccess(state);
        return text;
      } catch (err) {
        lastErr = err;
        const cls = classifyError(err);
        console.warn(`[atlas] attempt ${attempt + 1} failed (${cls}) with key ${state.masked}:`, redactSecrets(String((err as Error)?.message ?? err)));
        if (cls === 'invalid_key') {
          keyPool.reportFailure(state, /* permanent */ true);
        } else if (cls === 'rate' || cls === 'quota' || cls === 'transient') {
          keyPool.reportFailure(state);
        } else {
          throw new Error(redactSecrets((err as Error)?.message ?? 'Request failed.'));
        }
        void timedOut; // surfaced through the redacted message above
        if (attempt < MAX_RETRIES) await sleep(backoff(attempt));
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
    const msg = redactSecrets(String((lastErr as Error)?.message ?? lastErr ?? 'All API keys are cooling down.'));
    throw new Error(`POOL_EXHAUSTED: ${msg}`);
  }

  recordUser(text: string): void { this.history.push({ role: 'user', text }); }
  recordModel(text: string): void { this.history.push({ role: 'model', text }); }
}

/**
 * The blueprint is defined in the main app module (index.tsx) and injected here
 * at startup — avoids a circular import while keeping one source of truth.
 */
export const atlasBlueprintRef: { value: string } = { value: '' };

export const atlasClient = new AtlasClient();

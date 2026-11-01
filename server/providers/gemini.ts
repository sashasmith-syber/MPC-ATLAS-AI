/**
 * server/providers/gemini.ts — SERVER-ONLY Gemini provider adapter.
 *
 * Provider secrets live here (env: GEMINI_API_KEY[_2,_3]) and NEVER reach the
 * browser. Key rotation exists solely for quota-pressure spreading + cooldown
 * hygiene; it must never be used to circumvent provider access restrictions
 * (each key remains bound to its own quota/account — documented).
 *
 * Cancellation semantics (tested against installed @google/genai 1.52.0):
 * GenerateContentConfig.abortSignal IS supported → we pass a real AbortSignal
 * tied to the request deadline. Per SDK docs this cancels the client-side
 * fetch but NOT the in-flight server-side operation (billing may still occur);
 * therefore deadlines are hard, retries bounded, and late results from an
 * aborted attempt are discarded and never mutate completed request state.
 */

import { GoogleGenAI, type Part } from '@google/genai';

export interface ProviderRequest {
  model?: string;
  systemInstruction: string;
  contents: Array<{ role: 'user' | 'model'; parts: Part[] }>;
  temperature?: number;
  maxOutputTokens?: number;
  deadlineMs: number;
}

export class UpstreamError extends Error {
  readonly kind: 'rate' | 'quota' | 'invalid_key' | 'transient' | 'timeout' | 'fatal';
  constructor(kind: UpstreamError['kind'], safeMessage: string) {
    super(safeMessage);
    this.kind = kind;
  }
}

interface KeySlot { masked: string; token: string; failures: number; cooldownUntil: number; }

function maskKey(t: string): string { return t.length <= 8 ? '••••' : `${t.slice(0, 4)}…${t.slice(-4)}`; }

const SECRET_RE = /AIza[\w-]{20,}|ya29\.[\w-]+|Bearer\s+\S+/gi;
function scrub(s: string): string { return s.replace(SECRET_RE, '[REDACTED]').slice(0, 300); }

export class GeminiProvider {
  private slots: KeySlot[] = [];
  private cursor = 0;
  /** Bounded outstanding requests — prevents uncontrolled overlap under load. */
  private inflight = 0;
  static readonly MAX_INFLIGHT = 4;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    for (const k of ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3']) {
      const v = env[k];
      if (typeof v === 'string' && /^AIza[\w-]{20,}$/.test(v.trim())) {
        const token = v.trim();
        if (!this.slots.some(s => s.token === token)) {
          this.slots.push({ masked: maskKey(token), token, failures: 0, cooldownUntil: 0 });
        }
      }
    }
  }

  get configured(): boolean { return this.slots.length > 0; }
  /** Non-secret status only — never expose previews beyond masked handles. */
  get status(): { poolSize: number; activeMasked: string | null } {
    return {
      poolSize: this.slots.length,
      activeMasked: this.slots[this.cursor % Math.max(1, this.slots.length)]?.masked ?? null,
    };
  }

  private nextSlot(): KeySlot | null {
    if (this.slots.length === 0) return null;
    const now = Date.now();
    for (let i = 0; i < this.slots.length; i++) {
      const idx = (this.cursor + i) % this.slots.length;
      if (this.slots[idx].cooldownUntil <= now) { this.cursor = idx + 1; return this.slots[idx]; }
    }
    return null; // all cooling → caller fails fast rather than hammering
  }

  private classify(err: unknown): UpstreamError['kind'] {
    const e = err as { status?: number; message?: string; name?: string };
    const msg = String(e?.message ?? err ?? '');
    if (e?.name === 'AbortError' || /abort/i.test(msg)) return 'timeout';
    const status = e?.status ?? (/429/.test(msg) ? 429 : /40[13]|UNAUTHENTICATED|API_KEY_INVALID/.test(msg) ? 403 : 0);
    if (status === 429 || /RESOURCE_EXHAUSTED|rate/i.test(msg)) return /quota.*(day|exceeded)/i.test(msg) ? 'quota' : 'rate';
    if (status === 403 || /API_KEY_INVALID/i.test(msg)) return 'invalid_key';
    if (status >= 500 || /DEADLINE|UNAVAILABLE|INTERNAL|fetch failed|network/i.test(msg)) return 'transient';
    return 'fatal';
  }

  /**
   * One bounded generate call with failover across keys.
   * Retry budget is small and FIXED (no exponential storm); each attempt gets
   * its own AbortController-backed deadline slice.
   */
  async generate(req: ProviderRequest): Promise<string> {
    if (!this.configured) throw new UpstreamError('fatal', 'provider not configured');
    if (this.inflight >= GeminiProvider.MAX_INFLIGHT) throw new UpstreamError('transient', 'provider concurrency bound reached');

    const attempts = Math.min(3, Math.max(1, this.slots.length));
    const perAttemptMs = Math.max(2_000, Math.floor(req.deadlineMs / attempts));
    let lastKind: UpstreamError['kind'] = 'fatal';
    this.inflight += 1;
    try {
      for (let a = 0; a < attempts; a++) {
        const slot = this.nextSlot();
        if (!slot) break;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), perAttemptMs);
        try {
          const ai = new GoogleGenAI({ apiKey: slot.token });
          const response = await ai.models.generateContent({
            model: req.model ?? 'gemini-2.5-flash',
            contents: req.contents as Part[],
            config: {
              systemInstruction: req.systemInstruction,
              temperature: req.temperature ?? 0.7,
              maxOutputTokens: req.maxOutputTokens ?? 2048,
              abortSignal: ac.signal, // real cancellation support (SDK ≥1.x)
            },
          });
          slot.failures = 0; slot.cooldownUntil = 0;
          return response.text ?? '';
        } catch (err) {
          lastKind = this.classify(err);
          if (lastKind === 'invalid_key') slot.cooldownUntil = Number.POSITIVE_INFINITY;
          else if (lastKind === 'rate' || lastKind === 'quota') slot.cooldownUntil = Date.now() + Math.min(30_000 * 2 ** slot.failures++, 900_000);
          if (lastKind === 'fatal') throw new UpstreamError('fatal', scrub(String((err as Error)?.message ?? 'provider error')));
          // transient/timeout/rate/quota → rotate & retry within bounded budget
        } finally {
          clearTimeout(timer);
        }
      }
      throw new UpstreamError(lastKind === 'timeout' ? 'timeout' : 'transient', 'all provider attempts exhausted');
    } finally {
      this.inflight -= 1;
    }
  }
}

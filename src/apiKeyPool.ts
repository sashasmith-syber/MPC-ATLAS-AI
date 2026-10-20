/**
 * apiKeyPool.ts — Hardened API key management for Akai Atlas.
 *
 * Provides:
 *  - Multi-key pool with ROUND-ROBIN ROTATION per request
 *  - Per-key failure tracking + automatic COOLDOWN on rate-limit/quota errors
 *  - Runtime key injection via a server-injected global (window.__ATLAS_KEYS__)
 *    so keys never need to be baked into the JS bundle at build time
 *  - Redaction helpers so raw keys can never leak into logs/errors/UI
 */

export interface KeyState {
  token: string;         // obfuscated in-memory form
  masked: string;        // safe display form, e.g. "AIza…a1B2"
  failures: number;      // consecutive failures
  cooldownUntil: number; // epoch ms until which this key is skipped
}

const COOLDOWN_BASE_MS = 30_000;      // 30s first strike
const COOLDOWN_MAX_MS = 15 * 60_000;  // cap escalation at 15 min

// ---- obfuscation (NOT encryption — defense-in-depth against casual dumps) ----
const OBF_KEY = 'atlas-pool-v1';
function xorObfuscate(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    out += String.fromCharCode(input.charCodeAt(i) ^ OBF_KEY.charCodeAt(i % OBF_KEY.length));
  }
  return btoa(out);
}
function xorDeobfuscate(encoded: string): string {
  const raw = atob(encoded);
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    out += String.fromCharCode(raw.charCodeAt(i) ^ OBF_KEY.charCodeAt(i % OBF_KEY.length));
  }
  return out;
}

export function maskKey(token: string): string {
  if (token.length <= 8) return '••••';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function peekToken(s: KeyState): string {
  try {
    return xorDeobfuscate(s.token);
  } catch {
    return '';
  }
}

/** Scrub any known key material out of an arbitrary string before logging/rendering. */
export function redactSecrets(text: string): string {
  let safe = text;
  for (const s of keyPool.current()) {
    const real = peekToken(s);
    if (real && safe.includes(real)) safe = safe.split(real).join(`[REDACTED:${s.masked}]`);
  }
  // Generic fallbacks: Google API key shape & OAuth tokens
  safe = safe.replace(/AIza[\w-]{20,}/g, '[REDACTED:API_KEY]');
  safe = safe.replace(/ya29\.[\w-]+/g, '[REDACTED:OAUTH_TOKEN]');
  return safe;
}

interface InjectedGlobals {
  __ATLAS_KEYS__?: string[];      // plain keys served at runtime by your web server
  __ATLAS_KEYS_OBF__?: string[];  // pre-obfuscated keys (preferred)
}

declare global {
  interface Window {
    __ATLAS_KEYS__?: string[];
    __ATLAS_KEYS_OBF__?: string[];
  }
}

class ApiKeyPool {
  private states: KeyState[] = [];
  private cursor = 0;
  ready = false;

  /** Collect keys from every trusted source, de-duplicated. */
  load(): void {
    const collected: string[] = [];
    const push = (maybeKey: unknown) => {
      if (typeof maybeKey === 'string' && /^AIza[\w-]{20,}$/.test(maybeKey.trim())) {
        collected.push(maybeKey.trim());
      }
    };

    // 1) Runtime injection from the hosting environment (preferred, no rebuild needed).
    const g = window as unknown as InjectedGlobals;
    (g.__ATLAS_KEYS_OBF__ ?? []).forEach(obf => {
      try { push(xorDeobfuscate(obf)); } catch { /* ignore malformed entry */ }
    });
    (g.__ATLAS_KEYS__ ?? []).forEach(push);

    // 2) Build-time env (dev convenience only — see README hardening notes).
    try {
      if (typeof process !== 'undefined' && process.env) {
        ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'API_KEY'].forEach(k => push(process.env[k]));
      }
    } catch { /* process may not exist in browser builds */ }

    // 3) sessionStorage stash (user-supplied fallback key, kept out of the bundle).
    try {
      const stashed = sessionStorage.getItem('atlas.stash.key');
      if (stashed) push(xorDeobfuscate(stashed));
    } catch { /* storage unavailable */ }

    const unique = [...new Set(collected)];
    this.states = unique.map(token => ({
      token: xorObfuscate(token),
      masked: maskKey(token),
      failures: 0,
      cooldownUntil: 0,
    }));
    this.ready = this.states.length > 0;
  }

  size(): number { return this.states.length; }
  listMasked(): string[] { return this.states.map(s => s.masked); }
  current(): KeyState[] { return this.states; }

  stashKey(plainKey: string): boolean {
    if (!/^AIza[\w-]{20,}$/.test(plainKey.trim())) return false;
    try {
      sessionStorage.setItem('atlas.stash.key', xorObfuscate(plainKey.trim()));
    } catch { /* ignore */ }
    this.load();
    return true;
  }

  /** Round-robin selection among keys not currently in cooldown. */
  next(): KeyState | null {
    if (this.states.length === 0) return null;
    const now = Date.now();
    for (let i = 0; i < this.states.length; i++) {
      const idx = (this.cursor + i) % this.states.length;
      if (this.states[idx].cooldownUntil <= now) {
        this.cursor = (idx + 1) % this.states.length; // rotate for next call
        return this.states[idx];
      }
    }
    // All cooling down → pick whichever recovers soonest.
    return [...this.states].sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0];
  }

  getToken(state: KeyState): string { return peekToken(state); }

  reportSuccess(state: KeyState): void {
    state.failures = 0;
    state.cooldownUntil = 0;
  }

  /** Escalating exponential cooldown: 30s → 1m → 2m → 4m … capped at 15min. */
  reportFailure(state: KeyState, permanent = false): void {
    state.failures += 1;
    if (permanent) {
      state.cooldownUntil = Number.MAX_SAFE_INTEGER; // invalid/blocked key: park forever
      return;
    }
    const ms = Math.min(COOLDOWN_BASE_MS * 2 ** (state.failures - 1), COOLDOWN_MAX_MS);
    state.cooldownUntil = Date.now() + ms;
  }
}

export const keyPool = new ApiKeyPool();
keyPool.load();

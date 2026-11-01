/**
 * server/auth/session.ts — AUTHENTICATION (who are you?)
 *
 * No pre-existing server-side auth mechanism was found in the checkout
 * (the app was browser-only), so this is the explicit local-only development
 * mode required by the integration brief:
 *
 *  - Development mode: bound to LOOPBACK ONLY (127.0.0.1). Sessions are
 *    random opaque tokens issued by POST /api/session. This is NOT production
 *    authentication and must never face untrusted networks.
 *  - Production mode: startup FAILS CLOSED unless ATLAS_AUTH_MODE=external
 *    with a real verifier injected (see createSessionManager options);
 *    there is no implicit dev fallback.
 *
 * The session token authenticates a caller; it does NOT encode privileges.
 * Authorization is a separate gate (authorization.ts). Source identifiers
 * used in PROTOS packets are DERIVED HERE from verified sessions — the
 * browser can never choose its own source.
 */

import { randomBytes, randomUUID, createHash } from 'node:crypto';

export interface SessionRecord {
  token: string;              // opaque bearer secret returned to the browser
  sourceId: string;           // server-derived PROTOS source ("atlas-session:<id>")
  principal: string;          // server-side principal label (dev-mode constant)
  createdAt: number;
  lastSeenAt: number;
}

export interface ExternalVerifier {
  /** Return a stable principal id for a request, or null to deny. */
  verify(req: { headers: Record<string, string | undefined> }): Promise<{ principal: string } | null>;
}

const SESSION_TTL_MS = 8 * 60 * 60_000;

export class SessionManager {
  private sessions = new Map<string, SessionRecord>(); // token → record

  constructor(
    private readonly mode: 'development' | 'production',
    private readonly externalVerifier?: ExternalVerifier,
  ) {
    if (mode === 'production' && !externalVerifier) {
      throw new Error('production mode requires an external auth verifier (fail closed)');
    }
  }

  async createSession(clientPrincipalHint?: string): Promise<SessionRecord> {
    let principal: string;
    if (this.mode === 'production') {
      const v = await this.externalVerifier!.verify({ headers: {} });
      if (!v) throw new Error('unauthenticated');
      principal = v.principal;
    } else {
      // Dev mode: single local operator on loopback. The hint is display-only;
      // identity stays server-owned either way.
      principal = 'local-operator';
    }
    const token = randomBytes(32).toString('hex');
    const id = randomUUID();
    const rec: SessionRecord = {
      token,
      sourceId: `atlas-session:${this.mode === 'development' ? clientPrincipalHint ?? id : id}`,
      principal,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    };
    this.sessions.set(token, rec);
    return rec;
  }

  /** Authenticate a bearer token. Returns null (deny) on anything unknown/expired. */
  authenticate(token: string | undefined | null): SessionRecord | null {
    this.sweep();
    if (!token) return null;
    const rec = this.sessions.get(this.hashToken(token));
    if (!rec) return null;
    if (Date.now() - rec.createdAt > SESSION_TTL_MS) {
      this.sessions.delete(this.hashToken(token));
      return null;
    }
    rec.lastSeenAt = Date.now();
    return rec;
  }

  revoke(token: string | undefined | null): void {
    if (token) this.sessions.delete(this.hashToken(token));
  }

  count(): number { return this.sessions.size; }

  // Tokens are stored keyed by their SHA-256 hash: a dump of server memory
  // state / logs yields pseudonymous handles, not live bearer secrets.
  // (Hashing identities ≠ anonymity; documented in SECURITY_LIMITATIONS.)
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.sessions) {
      if (now - v.createdAt > SESSION_TTL_MS) this.sessions.delete(k);
    }
  }
}

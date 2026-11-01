/**
 * PROTOS-1 Sanctuary — isolated server-only TypeScript port.
 *
 * Upstream contract preserved:
 *   - Authorizes packet SOURCE identifiers against a configured allowlist.
 *   - FAILS CLOSED: missing/unreadable/malformed config ⇒ deny; any
 *     enforcement exception ⇒ deny.
 *   - A source ID is NOT proof of identity (see docs). Membership in the
 *     sanctuary grants passage only — action permissions are a separate,
 *     additional gate (server/auth/authorization.ts).
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProtosPacket } from './packet';

export interface SanctuaryConfig {
  /** Allowed source identifiers (exact string match, per upstream semantics). */
  allowed_sources: string[];
}

export interface SanctuaryDecision {
  result: 'approve' | 'deny';
  reason?: string;
}

export class SanctuaryConfigError extends Error {}

/**
 * Path controls: policy path resolution happens ONLY on the server and is
 * confined to a base directory — a configured path may never escape it via
 * traversal (parity with "implement filesystem/path controls only on server").
 */
export function resolvePolicyPath(baseDir: string, relOrAbs: string): string {
  const abs = resolve(baseDir, relOrAbs);
  const base = resolve(baseDir);
  if (abs !== base && !abs.startsWith(base + '/')) {
    throw new SanctuaryConfigError('policy path escapes configured base directory');
  }
  return abs;
}

export function loadSanctuaryConfig(filePath: string): SanctuaryConfig {
  let raw: string;
  try {
    if (!existsSync(filePath)) throw new SanctuaryConfigError('policy file not found');
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    if (e instanceof SanctuaryConfigError) throw e;
    throw new SanctuaryConfigError('policy file unreadable');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SanctuaryConfigError('policy file malformed (invalid JSON)');
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as SanctuaryConfig).allowed_sources)) {
    throw new SanctuaryConfigError('policy file malformed (allowed_sources must be an array)');
  }
  const cfg = parsed as SanctuaryConfig;
  if (cfg.allowed_sources.some(s => typeof s !== 'string' || s.length === 0 || s.length > 256)) {
    throw new SanctuaryConfigError('policy file malformed (source entries must be non-empty strings ≤256 chars)');
  }
  return cfg;
}

export class Sanctuary {
  private constructor(private readonly config: SanctuaryConfig) {}

  static fromConfig(config: SanctuaryConfig): Sanctuary {
    return new Sanctuary(config);
  }

  static fromFile(filePath: string): Sanctuary {
    return new Sanctuary(loadSanctuaryConfig(filePath));
  }

  /**
   * Deny-on-everything-unknown: exceptions inside this method ALWAYS produce
   * a deny decision — never a fall-through approve.
   */
  authorize(packet: Pick<ProtosPacket, 'source'>): SanctuaryDecision {
    try {
      if (typeof packet.source !== 'string') return { result: 'deny', reason: 'source must be a string' };
      if (this.isAllowed(packet.source)) return { result: 'approve' };
      return { result: 'deny', reason: 'source not authorized' };
    } catch {
      return { result: 'deny', reason: 'enforcement exception' };
    }
  }

  /**
   * Atlas port extension (documented in docs/PROTOS1_INTEGRATION.md): the
   * upstream reference performs exact-string allowlist matching. This port
   * additionally supports an explicit trailing-`*` wildcard prefix entry so
   * per-session source IDs need not be enumerated. Wildcards are still
   * exact-prefix matches — deny-by-default for everything else.
   */
  private isAllowed(source: string): boolean {
    for (const entry of this.config.allowed_sources) {
      if (entry === source) return true;
      if (entry.endsWith('*') && entry.length > 1 && source.startsWith(entry.slice(0, -1))) return true;
    }
    return false;
  }
}

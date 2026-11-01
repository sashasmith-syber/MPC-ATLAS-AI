/**
 * PROTOS-1 Synthesis — isolated server-only TypeScript port.
 *
 * This is an Atlas-local PORT of the upstream Python reference
 * (protos.protos1_enforcer / config semantics), NOT an official upstream
 * package. It preserves the documented packet contract:
 *
 *   - Required fields: source, action, data
 *   - Optional fields: timestamp, metadata
 *   - source identifier max: 256 characters
 *   - action max: 128 characters
 *   - packet max: 65,536 ENCODED UTF-8 BYTES (byte length, not JS string length)
 *
 * IMPORTANT (upstream semantics): this is SCHEMA VALIDATION only. It performs
 * no checksum verification and NO authentication. A valid packet proves shape,
 * nothing more. Identity must come from Sanctuary + verified server sessions.
 *
 * Deliberate stricter-than-upstream behavior (documented separately in
 * docs/PROTOS1_INTEGRATION.md): JSON-safe values only — non-finite numbers,
 * cycles, functions, symbols, bigint and unsupported object types are rejected.
 */

export const PACKET_MAX_BYTES = 65_536;
export const SOURCE_ID_MAX_CHARS = 256;
export const ACTION_MAX_CHARS = 128;

export interface ProtosPacket {
  source: string;
  action: string;
  data: unknown;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export class PacketValidationError extends Error {
  readonly field: string;
  constructor(field: string, reason: string) {
    super(`${field}: ${reason}`);
    this.name = 'PacketValidationError';
    this.field = field;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Strictly JSON-safe deep check with cycle detection. Rejects values whose
 * round-trip through JSON would silently change meaning (NaN/Infinity → null,
 * undefined dropped, Date → string, etc.). Parity fixtures document where
 * Python's json.dumps differs (it happily emits NaN/Infinity); Atlas rejects
 * those explicitly instead of shipping non-standard JSON.
 */
export function assertJsonSafe(value: unknown, seen = new Set<object>(), path = 'data'): void {
  switch (typeof value) {
    case 'string':
      return;
    case 'boolean':
      return;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new PacketValidationError(path, `non-finite number (${String(value)}) is not permitted`);
      }
      return;
    case 'undefined':
      throw new PacketValidationError(path, 'undefined values are not permitted');
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new PacketValidationError(path, `${typeof value} values are not supported`);
    case 'object': {
      if (value === null) return;
      if (seen.has(value)) {
        throw new PacketValidationError(path, 'circular reference detected');
      }
      seen.add(value);
      try {
        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) assertJsonSafe(value[i], seen, `${path}[${i}]`);
        } else if (isPlainObject(value)) {
          // Prototype-polluting keys are rejected outright on the server.
          for (const k of ['__proto__', 'constructor', 'prototype']) {
            if (k in value) throw new PacketValidationError(path, `reserved key "${k}" is not permitted`);
          }
          for (const [k, v] of Object.entries(value)) assertJsonSafe(v, seen, `${path}.${k}`);
        } else {
          throw new PacketValidationError(path, 'unsupported object type (must be plain object or array)');
        }
      } finally {
        seen.delete(value);
      }
      return;
    }
  }
}

/** Canonical, deterministic serialization used for size checks + hashing. */
export function canonicalEncode(packet: ProtosPacket): string {
  assertJsonSafe(packet.data, new Set(), 'data');
  assertJsonSafe(packet.metadata ?? null, new Set(), 'metadata');
  const orderedKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(orderedKeys);
    if (isPlainObject(v)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) out[k] = orderedKeys(v[k]);
      return out;
    }
    return v;
  };
  const base: Record<string, unknown> = {
    source: packet.source,
    action: packet.action,
    data: orderedKeys(packet.data),
  };
  if (packet.timestamp !== undefined) base.timestamp = packet.timestamp;
  if (packet.metadata !== undefined) base.metadata = orderedKeys(packet.metadata);
  return JSON.stringify(base);
}

export function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Full Synthesis validation of a constructed packet. Throws on invalid. */
export function validatePacket(p: unknown): ProtosPacket {
  if (!isPlainObject(p)) throw new PacketValidationError('packet', 'packet must be a plain object');
  const packet = p as Record<string, unknown>;

  // Required fields present + correct type
  if (typeof packet.source !== 'string') throw new PacketValidationError('source', 'required field "source" must be a string');
  if (typeof packet.action !== 'string') throw new PacketValidationError('action', 'required field "action" must be a string");
  if (!('data' in packet)) throw new PacketValidationError('data', 'required field "data" is missing');

  // Optional fields type-checked when present
  if ('timestamp' in packet && (typeof packet.timestamp !== 'number' || !Number.isFinite(packet.timestamp))) {
    throw new PacketValidationError('timestamp', 'optional "timestamp" must be a finite number');
  }
  if ('metadata' in packet && !isPlainObject(packet.metadata)) {
    throw new PacketValidationError('metadata', 'optional "metadata" must be a plain object');
  }

  // Upstream field caps (characters for identifiers)
  if (packet.source.length === 0) throw new PacketValidationError('source', 'must be non-empty');
  if (packet.source.length > SOURCE_ID_MAX_CHARS) {
    throw new PacketValidationError('source', `exceeds ${SOURCE_ID_MAX_CHARS}-character maximum (${packet.source.length})`);
  }
  if (packet.action.length === 0) throw new PacketValidationError('action', 'must be non-empty');
  if (packet.action.length > ACTION_MAX_CHARS) {
    throw new PacketValidationError('action', `exceeds ${ACTION_MAX_CHARS}-character maximum (${packet.action.length})`);
  }

  // Whole-packet encoded-size cap measured in UTF-8 BYTES
  const encoded = canonicalEncode(packet as unknown as ProtosPacket);
  const bytes = utf8ByteLength(encoded);
  if (bytes > PACKET_MAX_BYTES) {
    throw new PacketValidationError('packet', `encoded packet exceeds ${PACKET_MAX_BYTES} UTF-8 bytes (${bytes})`);
  }
  return packet as unknown as ProtosPacket;
}

/** Convenience constructor: build then validate. Deny-on-error by throwing. */
export function buildPacket(fields: Pick<ProtosPacket, 'source' | 'action' | 'data'> & Partial<Pick<ProtosPacket, 'timestamp' | 'metadata'>>): ProtosPacket {
  return validatePacket({ ...fields });
}

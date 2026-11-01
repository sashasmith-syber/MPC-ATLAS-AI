/**
 * Atlas-specific request schemas — applied AFTER the upstream PROTOS packet
 * validation (Synthesis) as an additional, stricter gate. Upstream Synthesis
 * only checks packet shape/size; these schemas constrain what `data` may
 * contain per action so untrusted conversation text can never smuggle policy,
 * identity or provider configuration into the backend.
 */

import { LIMITS, type AtlasAction } from '../../shared/contracts/index';

export class SchemaError extends Error {}

const ACTION_SET: ReadonlySet<string> = new Set(['atlas.chat.send', 'atlas.audio.analyze']);

export function isAtlasAction(v: unknown): v is AtlasAction {
  return typeof v === 'string' && ACTION_SET.has(v);
}

export interface ValidatedRequestData {
  text: string;
  media: Array<{ mimeType: string; dataBase64: string; bytes: number }> | undefined;
}

function assertNoReservedKeys(obj: Record<string, unknown>, where: string): void {
  for (const banned of ['source', 'node', 'role', 'voter', 'identity', 'policy', 'api_key', 'apiKey', 'key']) {
    if (banned in obj) throw new SchemaError(`${where}: reserved claim field "${banned}" is not permitted in request data`);
  }
}

/**
 * Validate the browser-supplied request payload against the Atlas action
 * schema. Anything not explicitly allowed is rejected (deny-by-default).
 */
export function validateRequestData(action: string, payload: unknown): ValidatedRequestData {
  if (!isAtlasAction(action)) throw new SchemaError(`unknown action "${String(action)}"`);
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new SchemaError('request body must be a JSON object');
  }
  const body = payload as Record<string, unknown>;
  assertNoReservedKeys(body, 'body');

  // Only sessionId/action/text/media are recognized; unknown fields ignored.
  const text = body.text;
  if (typeof text !== 'string') throw new SchemaError('"text" must be a string');
  if (text.length > LIMITS.MAX_TEXT_CHARS) throw new SchemaError(`"text" exceeds ${LIMITS.MAX_TEXT_CHARS} characters`);

  let media: ValidatedRequestData['media'];
  if (body.media !== undefined) {
    if (!Array.isArray(body.media)) throw new SchemaError('"media" must be an array');
    if (action === 'atlas.chat.send' && body.media.length > 0) {
      throw new SchemaError('chat requests may not carry media (use atlas.audio.analyze)');
    }
    if (body.media.length > 1) throw new SchemaError('at most one media item per request');
    media = body.media.map((m, i) => {
      if (typeof m !== 'object' || m === null) throw new SchemaError(`media[${i}] must be an object`);
      const mm = m as Record<string, unknown>;
      assertNoReservedKeys(mm, `media[${i}]`);
      if (typeof mm.mimeType !== 'string' || !LIMITS.ALLOWED_AUDIO_MIME.includes(mm.mimeType.toLowerCase())) {
        throw new SchemaError(`media[${i}]: unsupported MIME type`);
      }
      if (typeof mm.dataBase64 !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(mm.dataBase64)) {
        throw new SchemaError(`media[${i}]: dataBase64 must be base64 text`);
      }
      const bytes = Buffer.from(mm.dataBase64, 'base64').length;
      if (bytes === 0) throw new SchemaError(`media[${i}]: empty payload`);
      if (bytes > LIMITS.MAX_MEDIA_BASE64_BYTES) {
        throw new SchemaError(`media[${i}]: exceeds ${LIMITS.MAX_MEDIA_BASE64_BYTES} byte cap`);
      }
      return { mimeType: mm.mimeType.toLowerCase(), dataBase64: mm.dataBase64.replace(/\s/g, ''), bytes };
    });
  }

  if (action === 'atlas.audio.analyze' && (!media || media.length === 0)) {
    throw new SchemaError('audio analysis requires one media item');
  }
  if (action === 'atlas.chat.send' && text.trim().length === 0) {
    throw new SchemaError('chat text must be non-empty');
  }
  return { text, media };
}

/**
 * shared/contracts — wire contract between the Atlas browser UI and the
 * Atlas enforcement backend. NO provider secrets, NO auth material here.
 *
 * The browser may ONLY send: sessionId, action, input text, and inline media.
 * Identity (source), policy, voter nodes and provider configuration are
 * derived server-side exclusively; any such claims in a browser request are
 * ignored by design (see server/routes/enforce.ts).
 */

export const PROTOCOL_VERSION = 'atlas-protos-v1';

/** Actions the Atlas backend knows how to authorize + execute. */
export type AtlasAction = 'atlas.chat.send' | 'atlas.audio.analyze';

/** Hard wire limits (also enforced server-side; these mirror them for UX). */
export const LIMITS = {
  MAX_TEXT_CHARS: 8_000,
  MAX_MEDIA_BASE64_BYTES: 10 * 1024 * 1024, // decoded bytes cap for uploads
  MAX_HISTORY_MESSAGES: 40,
  ALLOWED_AUDIO_MIME: [
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/vnd.wave',
    'audio/ogg', 'audio/flac', 'audio/x-flac', 'audio/m4a', 'audio/x-m4a',
    'audio/aac', 'audio/mp4', 'audio/webm',
  ] as readonly string[],
} as const;

export interface InlineMedia {
  mimeType: string;
  /** base64 (no data-url prefix) of the raw audio bytes */
  dataBase64: string;
  /** client-supplied display name only; never trusted for policy */
  name?: string;
}

/** What the browser is allowed to send. Unknown fields are ignored server-side. */
export interface AtlasRequest {
  sessionId: string;
  action: AtlasAction;
  text: string;
  media?: InlineMedia[];
}

/** Stable public error codes — never tokens, paths, SDK errors or stacks. */
export type PublicErrorCode =
  | 'UNAUTHENTICATED'        // no/invalid session
  | 'FORBIDDEN_ACTION'       // identity not permitted for this action
  | 'DENIED_BY_POLICY'       // PROTOS Sanctuary deny
  | 'INVALID_PACKET'         // PROTOS Synthesis / schema failure
  | 'RATE_LIMITED'           // authoritative server-side limit
  | 'OVERLOADED'             // concurrency bound reached
  | 'TIMEOUT'                // bounded provider deadline exceeded
  | 'UPSTREAM_UNAVAILABLE'   // provider failed after bounded retries
  | 'INTERNAL';              // fail-closed catch-all (details audit-only)

export interface AtlasResponseOk {
  ok: true;
  requestId: string;
  reply: string;
  /** Non-secret gate status for transparency badges in the UI. */
  gates: {
    sanctuary: 'approve';
    synthesis: 'valid';
    logic: 'not_applicable' | 'approve' | 'not_configured';
  };
}

export interface AtlasResponseErr {
  ok: false;
  requestId: string;
  code: PublicErrorCode;
  /** Safe, user-displayable message. Never leaks internals. */
  message: string;
}

export type AtlasResponse = AtlasResponseOk | AtlasResponseErr;

/** Non-secret server status consumed by the UI at startup. */
export interface AtlasStatus {
  ok: boolean;
  mode: 'development' | 'production';
  providerConfigured: boolean; // boolean only — never a key preview
  protosPolicyLoaded: boolean;
  protocol: typeof PROTOCOL_VERSION;
}

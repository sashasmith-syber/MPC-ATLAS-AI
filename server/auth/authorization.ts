/**
 * server/auth/authorization.ts — AUTHORIZATION (may you do THIS?)
 *
 * Separate from authentication by design: Sanctuary membership / a valid
 * session does NOT imply permission to execute every action. Each principal
 * class carries an explicit action allowlist, checked AFTER identity
 * verification and BEFORE the PROTOS gates run.
 */

import type { SessionRecord } from './session';
import type { AtlasAction } from '../../shared/contracts/index';

export interface ActionPolicy {
  /** Actions this principal is permitted to invoke. Deny-by-default. */
  allowedActions: ReadonlySet<string>;
  /** Actions that additionally require PROTOS Logic consensus. */
  consensusRequiredActions: ReadonlySet<string>;
}

/** Dev-mode policy: the local operator may chat + analyze audio.
 *  No action in Atlas currently has real multi-principal voting infra, so
 *  any consensus-required action would DENY "not configured" (see routes). */
export const DEV_OPERATOR_POLICY: ActionPolicy = {
  allowedActions: new Set<string>(['atlas.chat.send', 'atlas.audio.analyze']),
  consensusRequiredActions: new Set<string>(), // e.g. future 'atlas.project.write'
};

export type AuthzDecision =
  | { allowed: true; consensusRequired: false }
  | { allowed: true; consensusRequired: true }
  | { allowed: false; reason: string };

export function authorize(session: SessionRecord | null, action: AtlasAction | string): AuthzDecision {
  if (!session) return { allowed: false, reason: 'unauthenticated' };
  const policy = policyFor(session);
  if (!policy.allowedActions.has(action)) {
    return { allowed: false, reason: 'action not permitted for this principal' };
  }
  if (policy.consensusRequiredActions.has(action)) {
    return { allowed: true, consensusRequired: true };
  }
  return { allowed: true, consensusRequired: false };
}

/**
 * Principal → policy mapping. In dev mode every verified session is the local
 * operator. Production integrations must extend this with real per-principal
 * policies; unknown principals fail closed.
 */
export function policyFor(session: SessionRecord): ActionPolicy {
  if (session.principal === 'local-operator') return DEV_OPERATOR_POLICY;
  // Fail closed: no policy ⇒ no permissions.
  return { allowedActions: new Set(), consensusRequiredActions: new Set() };
}

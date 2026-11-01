/**
 * PROTOS-1 Logic — isolated server-only TypeScript port of the voting core.
 *
 * Upstream contract preserved:
 *   - Votes carry a `result` ("approve" | "deny") and a distinct node id.
 *   - Default threshold 0.66, default minimum voters 2.
 *   - Duplicate nodes do not count twice.
 *   - CRITICAL (upstream caveat carried forward): distinct node STRINGS alone
 *     do not establish independent trusted voters. In Atlas, votes may only
 *     ever be produced by authenticated, authorized, distinct server-known
 *     principals — and no such multi-principal voting infrastructure exists
 *     in this deployment yet. Consensus-required operations therefore DENY
 *     with "not configured". Ordinary chat is "logic not applicable", which
 *     is reported honestly and NEVER presented as "consensus passed".
 */

export interface LogicVote {
  result: 'approve' | 'deny';
  node: string;
}

export interface LogicConfig {
  threshold: number;      // fraction of approvals required to approve
  minVoters: number;      // minimum distinct voters for a quorum
}

export const DEFAULT_LOGIC_CONFIG: LogicConfig = { threshold: 0.66, minVoters: 2 };

export interface LogicDecision {
  result: 'approve' | 'deny' | 'no_quorum';
  approvals: number;
  denials: number;
  voters: number;
  ratio: number;
}

export function tallyVotes(votes: LogicVote[], config: LogicConfig = DEFAULT_LOGIC_CONFIG): LogicDecision {
  if (config.threshold < 0 || config.threshold > 1) throw new Error('threshold must be within [0,1]');
  if (!Number.isInteger(config.minVoters) || config.minVoters < 0) throw new Error('minVoters must be a non-negative integer');

  // Deduplicate by node: one vote per distinct node (first vote wins).
  const byNode = new Map<string, LogicVote['result']>();
  for (const v of votes) {
    if (v.result !== 'approve' && v.result !== 'deny') throw new Error(`invalid vote result: ${String(v.result)}`);
    if (typeof v.node !== 'string' || v.node.length === 0) throw new Error('vote node must be a non-empty string');
    if (!byNode.has(v.node)) byNode.set(v.node, v.result);
  }

  const voters = byNode.size;
  let approvals = 0;
  for (const r of byNode.values()) if (r === 'approve') approvals += 1;
  const denials = voters - approvals;

  if (voters < config.minVoters) {
    return { result: 'no_quorum', approvals, denials, voters, ratio: voters === 0 ? 0 : approvals / voters };
  }
  const ratio = approvals / voters;
  return {
    result: ratio >= config.threshold ? 'approve' : 'deny',
    approvals, denials, voters, ratio,
  };
}

// What a space row says about its agents: how many, whether one needs you, and how many leads it
// has. Pure, so tests/ can load it without Herdr.

/** @typedef {"blocked" | "done" | "working" | "idle"} AgentStatus */
/** @typedef {{ total: number, isBlocked: boolean, leadCount: number }} SpaceSummary */

// A lead's terminal carries this label (the gh44-agents mod sets it).
const ROLE_LABEL = "omnia.role";
const LEAD_ROLE = "lead";

/**
 * @param {{ agents: { address: string, space: string, status: AgentStatus }[], terminals: { address: string, labels?: Record<string, string> }[] }} params
 * @returns {Map<string, SpaceSummary>}
 */
export const getSpaceSummaries = ({ agents, terminals }) => {
  const leads = new Set(terminals.filter((t) => t.labels?.[ROLE_LABEL] === LEAD_ROLE).map((t) => t.address));
  /** @type {Map<string, SpaceSummary>} */
  const summaries = new Map();
  for (const a of agents) {
    const s = summaries.get(a.space) ?? { total: 0, isBlocked: false, leadCount: 0 };
    summaries.set(a.space, {
      total: s.total + 1,
      isBlocked: s.isBlocked || a.status === "blocked",
      leadCount: s.leadCount + (leads.has(a.address) ? 1 : 0),
    });
  }
  return summaries;
};

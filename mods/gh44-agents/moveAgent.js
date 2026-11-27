// Moving agents to a lead (or to No lead) is a label change on each agent: omnia.lead=<the lead>,
// or none. Any lead, in any space or machine; the lead reads its followers from the labels, so it
// is never messaged. Undo puts back each agent's label as it was. Pure, so tests/ can load it without Herdr.
import { getFollowLabel } from "./leads.js";

/** @typedef {import("./leads.js").Lead} Lead */
/** @typedef {import("./leads.js").LabelChange} LabelChange */
/** @typedef {"noChange" | "noLead"} MoveRefusal */
/**
 * @typedef {{ status: "moved", moved: string[], leadName: string | null, labels: LabelChange[], undo: LabelChange[] }
 *   | { status: "refused", reason: MoveRefusal }} MovePlan
 */

// to: the lead's address, or null for No lead.
/**
 * @param {{ agents: { address: string, space: string }[], leads: Lead[], leadOf: Map<string, string>, addresses: string[], to: string | null }} params
 * @returns {MovePlan}
 */
export const planMove = ({ agents, leads, leadOf, addresses, to }) => {
  const lead = to === null ? null : leads.find((l) => l.address === to && l.state === "ready");
  if (to !== null && !lead) return { status: "refused", reason: "noLead" };
  const isLead = new Set(leads.map((l) => l.address));
  const picked = agents.filter((a) => addresses.includes(a.address) && !isLead.has(a.address));
  const moving = picked.filter((a) => (leadOf.get(a.address) ?? null) !== to);
  if (!moving.length) return { status: "refused", reason: "noChange" };
  return {
    status: "moved",
    moved: moving.map((a) => a.address),
    leadName: lead?.name ?? null,
    labels: moving.map((a) => ({ terminal: a.address, labels: [getFollowLabel({ lead: to, follower: a.address })] })),
    undo: moving.map((a) => ({ terminal: a.address, labels: [getFollowLabel({ lead: leadOf.get(a.address) ?? null, follower: a.address })] })),
  };
};

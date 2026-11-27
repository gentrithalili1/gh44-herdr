// Leads: a Claude session that follows some agents, in any space, on any machine. Terminal labels
// are the only record: a lead's terminal has omnia.role=lead (and omnia.lead.name), each agent it
// follows has omnia.lead=<the lead's address as seen from the agent's machine>: its bare id on the
// same machine, else "<machine>/<id>", "local/<id>" for this computer. An agent follows at most
// one lead; a lead whose tab closed is gone, and its agents have no lead again.
// The mod also starts new agents under a lead; those wait in the same pending list (kind "agent").
// Pure, so tests/ can load it without Herdr.
import { AGENT_NAME_LABEL, getDisplayName } from "./names.js";

export const ROLE_LABEL = "omnia.role";
export const NAME_LABEL = "omnia.lead.name";
export const FOLLOW_LABEL = "omnia.lead";
const LEAD_ROLE = "lead";
// This computer, as a label read on another machine names it.
const LOCAL_MACHINE = "local";
const SKILL = "gh44-make-lead";
const PENDING_PREFIX = "pending:";
// A started lead's (or new agent's) tab shows within this, and its Claude reports a status within READY_MS.
const OPEN_MS = 20_000;
const READY_MS = 90_000;

/** @typedef {"ready" | "starting" | "failed"} LeadState */
/** @typedef {"noTab" | "closed" | "noAgent" | "noLabel"} LeadFailure */
/** @typedef {{ address: string, space: string, name: string, state: LeadState, followers: string[], reason?: LeadFailure, pendingId?: string, terminal?: string | null, knownTabs?: string[] }} Lead */
/** @typedef {{ address: string, space: string, title: string }} LeadAgent */
/** @typedef {{ address: string, labels?: Record<string, string> }} LabeledTerminal */
/**
 * A lead (or, kind "agent", a new agent under the lead `lead`) the mod started and is waiting
 * for. terminal: its tab's terminal once labeled. knownTabs: the space's tabs before the start; its
 * tab is a new one, whatever the others are called. kind is "lead" when absent.
 * @typedef {{ id: string, kind?: "lead" | "agent", lead?: string, task?: string, name: string, space: string, followers?: string[], status: "starting" | "failed", reason?: LeadFailure, startedAt: number, terminal: string | null, knownTabs: string[] }} PendingLead
 */
/**
 * A new agent being started, shown under its lead.
 * @typedef {{ address: string, lead: string, space: string, name: string, state: "starting" | "failed", reason?: LeadFailure, pendingId: string, terminal: string | null, knownTabs: string[] }} PendingAgent
 */
/** @typedef {{ terminal: string, labels: string[] }} LabelChange */

// "vps/t7" -> "t7": labels hold ids local to their machine.
/** @param {string} address */
export const getLocalId = (address) => address.slice(address.lastIndexOf("/") + 1);
/** @param {string} address */
const getMachine = (address) => (address.includes("/") ? address.slice(0, address.lastIndexOf("/")) : null);

// How `address` (as the app names it) reads on machine `from` (null: this computer).
/** @param {{ from: string | null, address: string }} params */
export const getRelativeAddress = ({ from, address }) => {
  const machine = getMachine(address);
  return machine === from ? getLocalId(address) : `${machine ?? LOCAL_MACHINE}/${getLocalId(address)}`;
};

// Back: a value read on machine `from` -> the address as the app names it.
/** @param {{ from: string | null, value: string }} params */
export const resolveRelativeAddress = ({ from, value }) => {
  if (!value.includes("/")) return from ? `${from}/${value}` : value;
  const machine = getMachine(value);
  return machine === LOCAL_MACHINE ? getLocalId(value) : `${machine}/${getLocalId(value)}`;
};

// The label on `follower` that names `lead`.
/** @param {{ lead: string | null, follower: string }} params */
export const getFollowLabel = ({ lead, follower }) => `${FOLLOW_LABEL}=${lead ? getRelativeAddress({ from: getMachine(follower), address: lead }) : ""}`;

/** @param {{ agents: LeadAgent[], terminals: LabeledTerminal[] }} params @returns {{ leads: Lead[], leadOf: Map<string, string> }} */
export const getLeadModel = ({ agents, terminals }) => {
  const labels = new Map(terminals.map((t) => [t.address, t.labels ?? {}]));
  const labelsOf = (/** @type {string} */ address) => labels.get(address) ?? {};
  const isLead = (/** @type {string} */ address) => labelsOf(address)[ROLE_LABEL] === LEAD_ROLE;
  /** @type {Lead[]} */
  const leads = agents.filter((a) => isLead(a.address)).map((a) => ({
    address: a.address, space: a.space, name: getDisplayName({ labels: labelsOf(a.address), fallback: labelsOf(a.address)[NAME_LABEL] || a.title }), state: "ready", followers: [],
  }));
  /** @type {Map<string, string>} */
  const leadOf = new Map();
  for (const a of agents) {
    const follows = labelsOf(a.address)[FOLLOW_LABEL];
    if (!follows || isLead(a.address)) continue;
    const leadAddress = resolveRelativeAddress({ from: getMachine(a.address), value: follows });
    const lead = leads.find((l) => l.address === leadAddress);
    if (!lead) continue;
    lead.followers.push(a.address);
    leadOf.set(a.address, lead.address);
  }
  return { leads, leadOf };
};

/** @param {string} name */
export const getLeadTabName = (name) => `Lead · ${name}`;

// The lead's first message: the skill, its name and the agents it follows, as they read on the
// lead's machine.
/** @param {{ name: string, followers: string[], machine?: string | null }} params */
export const getLeadPrompt = ({ name, followers, machine = null }) => [
  `/${SKILL}`, `"${name.replaceAll('"', "")}"`, ...followers.map((address) => getRelativeAddress({ from: machine, address })),
].join(" ");

/** @param {{ lead: string, name: string, followers: string[] }} params @returns {LabelChange[]} */
export const getStartLabels = ({ lead, name, followers }) => [
  { terminal: lead, labels: [`${ROLE_LABEL}=${LEAD_ROLE}`, `${NAME_LABEL}=${name}`] },
  ...followers.map((f) => ({ terminal: f, labels: [getFollowLabel({ lead, follower: f })] })),
];

// Making one agent a lead: the session itself becomes the lead (no new tab). It stops following
// any lead, and the skill's message loads the lead role in it.
/** @param {{ terminal: string, name: string }} params @returns {{ labels: LabelChange[], message: string }} */
export const getPromotePlan = ({ terminal, name }) => ({
  labels: [{ terminal, labels: [`${ROLE_LABEL}=${LEAD_ROLE}`, `${NAME_LABEL}=${name}`, `${FOLLOW_LABEL}=`] }],
  message: getLeadPrompt({ name, followers: [] }),
});

// The session keeps running; only the labels go.
/** @param {{ lead: { address: string, followers: string[] } }} params @returns {LabelChange[]} */
export const getStopLabels = ({ lead }) => [
  { terminal: lead.address, labels: [`${ROLE_LABEL}=`, `${NAME_LABEL}=`] },
  ...lead.followers.map((f) => ({ terminal: f, labels: [`${FOLLOW_LABEL}=`] })),
];

/** @param {PendingLead} p */
const isAgentKind = (p) => p.kind === "agent";

// A new agent's labels: the lead it follows and its name.
/** @param {{ terminal: string, lead: string, name: string }} params @returns {LabelChange[]} */
export const getNewAgentLabels = ({ terminal, lead, name }) => [
  { terminal, labels: [getFollowLabel({ lead, follower: terminal }), `${AGENT_NAME_LABEL}=${name}`] },
];

// The tab a pending entry looks for: "Lead · <name>" for a lead, the name itself for a new agent.
/** @param {PendingLead} p */
export const getPendingTabName = (p) => (isAgentKind(p) ? p.name : getLeadTabName(p.name));

// The new agents being started, for the rows under their lead.
/** @param {{ pending: PendingLead[] }} params @returns {PendingAgent[]} */
export const getPendingAgents = ({ pending }) => pending.filter(isAgentKind).map((p) => ({
  address: `${PENDING_PREFIX}${p.id}`, lead: p.lead ?? "", space: p.space, name: p.name,
  state: p.status === "failed" ? /** @type {const} */ ("failed") : /** @type {const} */ ("starting"),
  pendingId: p.id, terminal: p.terminal, knownTabs: p.knownTabs ?? [], ...(p.reason ? { reason: p.reason } : {}),
}));

// The model's leads, then the ones being started that it doesn't have yet.
/** @param {{ leads: Lead[], pending: PendingLead[] }} params @returns {Lead[]} */
export const withPendingLeads = ({ leads, pending }) => {
  const known = new Set(leads.map((l) => l.address));
  return [
    ...leads,
    ...pending.filter((p) => !isAgentKind(p) && (!p.terminal || !known.has(p.terminal))).map((p) => ({
      address: `${PENDING_PREFIX}${p.id}`, space: p.space, name: p.name, state: p.status === "failed" ? /** @type {const} */ ("failed") : /** @type {const} */ ("starting"),
      followers: p.followers ?? [], pendingId: p.id, terminal: p.terminal, knownTabs: p.knownTabs ?? [], ...(p.reason ? { reason: p.reason } : {}),
    })),
  ];
};

/**
 * What a starting lead or new agent needs next: label its tab's terminal, be ready, fail, or wait.
 * A lead is ready once it is a lead (leadAddresses), a new agent once it is an agent (agentAddresses);
 * a failed one that came up after all is ready too. claimed: terminals other pending entries took.
 * @param {{ pending: PendingLead, now: number, spaces: { id: string, tabs: { id: string, name: string }[] }[], panes: { tab: string, terminal: string | null }[], leadAddresses: Set<string>, agentAddresses?: Set<string>, claimed?: Set<string> }} params
 * @returns {{ kind: "label", terminal: string } | { kind: "ready" } | { kind: "fail", reason: LeadFailure } | { kind: "wait" }}
 */
export const getPendingStep = ({ pending, now, spaces, panes, leadAddresses, agentAddresses = new Set(), claimed = new Set() }) => {
  const isUp = (/** @type {string} */ terminal) => (isAgentKind(pending) ? agentAddresses : leadAddresses).has(terminal);
  if (pending.status !== "starting") return pending.terminal && isUp(pending.terminal) ? { kind: "ready" } : { kind: "wait" };
  const age = now - pending.startedAt;
  if (!pending.terminal) {
    const known = new Set(pending.knownTabs ?? []);
    const tabs = new Set((spaces.find((s) => s.id === pending.space)?.tabs ?? []).filter((t) => !known.has(t.id) && t.name === getPendingTabName(pending)).map((t) => t.id));
    const terminal = panes.find((p) => tabs.has(p.tab) && p.terminal && !claimed.has(p.terminal))?.terminal;
    if (terminal) return { kind: "label", terminal };
    return age > OPEN_MS ? { kind: "fail", reason: "noTab" } : { kind: "wait" };
  }
  if (isUp(pending.terminal)) return { kind: "ready" };
  if (!panes.some((p) => p.terminal === pending.terminal)) return { kind: "fail", reason: "closed" };
  return age > READY_MS ? { kind: "fail", reason: "noAgent" } : { kind: "wait" };
};

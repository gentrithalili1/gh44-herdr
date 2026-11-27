// The agents list's groups for the picked view (shared("agents.layout")):
// - status (default): Leads on top, Pinned, then Needs you, Done, Working, Idle; rows name their space.
// - space: a group per space; each lead first with the agents it follows in that space under it,
//   then the rest. An agent stays in its own space: one whose lead is elsewhere names its lead.
// - lead: a group per lead (the lead is its header) with the agents it follows, wherever they
//   are; then No lead.
// - machine: a group per machine holding its spaces as in By space.
// A lead's own tab never shows a second time as an agent row. `order` is what agent.next /
// agent.prev walk: the shown agents and leads, top to bottom.
// Pure, so tests/ can load it without Herdr.
import { getLeadTabName } from "./leads.js";

/** @typedef {"status" | "space" | "lead" | "machine"} AgentsLayout */
/** @typedef {"blocked" | "done" | "working" | "idle"} AgentStatus */
/** @typedef {{ address: string, space: string, status: AgentStatus, pinned: boolean, tab: string, tab_name: string }} GroupAgent */
/** @typedef {{ id: string, name: string, machine: string | null, parent?: string | null }} GroupSpace */
// parent: a worktree space's main checkout space; By space and By machine nest it there.
/** @typedef {import("./leads.js").Lead & { terminal?: string | null }} GroupLead */
/** @typedef {import("./leads.js").PendingAgent} PendingAgent */
// isCross: the row is out of its space's group, so it names its space. A lead's children are the
// rows under it; followers: every agent it follows, wherever it is. An agent's lead: set when its
// lead is in another space, so the row names it. pending: a new agent being started under its lead.
/**
 * @typedef {{ kind: "lead", lead: GroupLead, isCross: boolean, children: AgentRow[], followers: GroupAgent[] }
 *   | { kind: "agent", agent: GroupAgent, isCross: boolean, lead?: GroupLead | null }
 *   | { kind: "pending", pending: PendingAgent, isCross: false }} AgentRow
 */
/** @typedef {"leads" | "pinned" | "status" | "space" | "lead" | "noLead" | "machine"} GroupKind */
/**
 * @typedef {{ id: string, kind: GroupKind, title: string, status: AgentStatus | null, space: string | null, machine: string | null,
 *   lead: GroupLead | null, count: number, rows: AgentRow[], groups: AgentGroup[], isWorktree?: boolean }} AgentGroup
 */

export const AGENTS_LAYOUT_STORE = "agents.layout";
/** @type {{ id: AgentsLayout, label: string }[]} */
export const AGENTS_LAYOUTS = [
  { id: "status", label: "By status" },
  { id: "space", label: "By space" },
  { id: "lead", label: "By lead" },
  { id: "machine", label: "By machine" },
];
/** @type {{ status: AgentStatus, title: string }[]} */
const STATUS_GROUPS = [
  { status: "blocked", title: "Needs you" },
  { status: "done", title: "Done" },
  { status: "working", title: "Working" },
  { status: "idle", title: "Idle" },
];
const LOCAL_MACHINE = "local";

/** @param {unknown} saved @returns {AgentsLayout} */
export const getAgentsLayout = (saved) => AGENTS_LAYOUTS.find((l) => l.id === saved)?.id ?? "status";

/** @param {Partial<AgentGroup> & { id: string, kind: GroupKind, title: string }} params @returns {AgentGroup} */
const group = ({ rows = [], groups = [], count = rows.length, status = null, space = null, machine = null, lead = null, ...rest }) => ({
  ...rest, status, space, machine, lead, count, rows, groups,
});

/** @param {GroupAgent} agent @returns {AgentRow} */
const agentRow = (agent, isCross = false, lead = null) => ({ kind: "agent", agent, isCross, lead });

// Move to: the leads by space, the agent's own space first, then the spaces of its repo (its
// checkout's worktrees, or its checkout), then the rest in Herdr's order. Ready leads only.
/**
 * @param {{ space: string, leads: GroupLead[], spaces: GroupSpace[], repoOf: Record<string, string> }} params
 * @returns {{ space: string, name: string, leads: GroupLead[] }[]}
 */
export const getMoveTargets = ({ space, leads, spaces, repoOf }) => {
  const repo = repoOf[space];
  const rank = (/** @type {string} */ id) => (id === space ? 0 : repo && repoOf[id] === repo ? 1 : 2);
  return spaces
    .map((s, i) => ({ s, i }))
    .sort((x, y) => rank(x.s.id) - rank(y.s.id) || x.i - y.i)
    .map(({ s }) => ({ space: s.id, name: s.name, leads: leads.filter((l) => l.state === "ready" && l.space === s.id) }))
    .filter((section) => section.leads.length);
};

// A lead or new agent being started already has a tab: its terminal, or a new tab in its space
// with the name it looks for. Tabs that were there before the start (knownTabs) are other sessions and stay.
/** @param {{ agent: GroupAgent, starting: { state: string, terminal?: string | null, space: string, knownTabs?: string[] }, tabName: string }} params */
const isStartingTab = ({ agent, starting, tabName }) => starting.state === "starting" && (starting.terminal === agent.address
  || (starting.space === agent.space && agent.tab_name === tabName && !(starting.knownTabs ?? []).includes(agent.tab)));

/**
 * spaces: Herdr's spaces in order (their names and machines). pendingAgents: new agents being started.
 * @param {{ agents: GroupAgent[], layout: AgentsLayout, leads: GroupLead[], pendingAgents?: PendingAgent[], spaces: GroupSpace[], machines: { id: string | null, name: string }[] }} params
 * @returns {{ groups: AgentGroup[], order: string[] }}
 */
export const groupAgents = ({ agents: listed, layout, leads, pendingAgents: allPending = [], spaces: allSpaces, machines }) => {
  // A new agent that came up (even after failing) is a listed agent now: its row is the agent's.
  const listedAddresses = new Set(listed.map((a) => a.address));
  const pendingAgents = allPending.filter((p) => !p.terminal || !listedAddresses.has(p.terminal) || p.state === "starting");
  const agents = listed.filter((agent) => !leads.some((lead) => isStartingTab({ agent, starting: lead, tabName: getLeadTabName(lead.name) }))
    && !pendingAgents.some((p) => isStartingTab({ agent, starting: p, tabName: p.name })));
  const leadAddresses = new Set(leads.map((l) => l.address));
  const workers = agents.filter((a) => !leadAddresses.has(a.address));
  // Each agent follows one lead: a lead being started takes it from the one it had. A failed lead
  // follows nobody, so its agents are free again.
  /** @type {Map<string, string>} */
  const ownerOf = new Map();
  for (const l of [...leads.filter((x) => x.state === "starting"), ...leads.filter((x) => x.state === "ready")]) {
    for (const f of l.followers) if (!ownerOf.has(f)) ownerOf.set(f, l.address);
  }
  const followersOf = (/** @type {GroupLead} */ lead) => workers.filter((a) => ownerOf.get(a.address) === lead.address);
  /** @param {GroupLead} lead @returns {AgentRow[]} */
  const pendingRows = (lead) => pendingAgents.filter((p) => p.lead === lead.address).map((p) => /** @type {AgentRow} */ ({ kind: "pending", pending: p, isCross: false }));
  const followed = new Set(workers.filter((a) => ownerOf.has(a.address)).map((a) => a.address));
  const leadOf = (/** @type {GroupAgent} */ a) => leads.find((l) => l.address === ownerOf.get(a.address)) ?? null;
  // Nested under its lead: a follower in the lead's own space.
  const isNested = (/** @type {GroupAgent} */ a) => leadOf(a)?.space === a.space;
  // Under its lead's row: its followers of that space; out of its space (Leads in By status), only
  // the new agents it is starting.
  /** @param {GroupLead} lead @returns {AgentRow} */
  const leadRow = (lead, isCross = false) => ({
    kind: "lead", lead, isCross, followers: followersOf(lead),
    children: [...(isCross ? [] : followersOf(lead).filter((a) => a.space === lead.space).map((a) => agentRow(a))), ...pendingRows(lead)],
  });

  // The spaces with an agent or a lead in them, in Herdr's order.
  // A worktree space nests under its main checkout's space (on the same machine), which shows
  // then even with no agents of its own.
  const used = new Set([...agents.map((a) => a.space), ...leads.map((l) => l.space)]);
  const known = new Map(allSpaces.map((s) => [s.id, s]));
  /** @param {GroupSpace} s */
  const parentOf = (s) => {
    const p = s.parent ? known.get(s.parent) : null;
    return p && p.id !== s.id && (p.machine ?? null) === (s.machine ?? null) && !p.parent ? p.id : null;
  };
  for (const s of allSpaces) if (used.has(s.id) && parentOf(s)) used.add(/** @type {string} */ (parentOf(s)));
  const spaces = new Map(allSpaces.filter((s) => used.has(s.id)).map((s) => [s.id, { name: s.name, machine: s.machine ?? null, parent: parentOf(s) }]));
  const topSpaces = () => [...spaces].filter(([, s]) => !s.parent);
  /** @param {string} id @returns {AgentGroup} */
  const spaceGroup = (id) => {
    const worktrees = [...spaces].filter(([, s]) => s.parent === id).map(([wid]) => spaceGroup(wid));
    const rows = [
      ...leads.filter((l) => l.space === id).map((l) => leadRow(l)),
      ...workers.filter((a) => a.space === id && !isNested(a)).map((a) => agentRow(a, false, leadOf(a))),
    ];
    const count = rows.reduce((n, r) => n + 1 + (r.kind === "lead" ? r.children.length : 0), 0) + worktrees.reduce((n, g) => n + g.count, 0);
    const s = spaces.get(id);
    return group({ id: `space:${id}`, kind: "space", title: s?.name ?? "", space: id, machine: s?.machine ?? null, rows, count, groups: worktrees, isWorktree: Boolean(s?.parent) });
  };

  /** @type {AgentGroup[]} */
  const groups = [];
  switch (layout) {
    case "status": {
      if (leads.length) groups.push(group({ id: "leads", kind: "leads", title: "Leads", rows: leads.map((l) => leadRow(l, true)) }));
      const pinned = workers.filter((a) => a.pinned);
      if (pinned.length) groups.push(group({ id: "pinned", kind: "pinned", title: "Pinned", rows: pinned.map((a) => agentRow(a, true)) }));
      for (const { status, title } of STATUS_GROUPS) {
        const rows = workers.filter((a) => !a.pinned && a.status === status).map((a) => agentRow(a, true));
        if (rows.length) groups.push(group({ id: `status:${status}`, kind: "status", title, status, rows }));
      }
      break;
    }
    case "space":
      for (const [id] of topSpaces()) groups.push(spaceGroup(id));
      break;
    case "lead":
      for (const l of leads) {
        groups.push(group({ id: `lead:${l.address}`, kind: "lead", title: l.name, space: l.space, lead: l, rows: [...followersOf(l).map((a) => agentRow(a, true)), ...pendingRows(l)] }));
      }
      groups.push(group({ id: "noLead", kind: "noLead", title: "No lead", rows: workers.filter((a) => !followed.has(a.address)).map((a) => agentRow(a, true)) }));
      break;
    case "machine":
      for (const m of machines) {
        const inner = topSpaces().filter(([, s]) => s.machine === m.id).map(([id]) => spaceGroup(id));
        if (!inner.length) continue;
        groups.push(group({ id: `machine:${m.id ?? LOCAL_MACHINE}`, kind: "machine", title: m.name, machine: m.id, groups: inner, count: inner.reduce((n, g) => n + g.count, 0) }));
      }
      break;
    default: {
      /** @type {never} */
      const unknownLayout = layout;
      return unknownLayout;
    }
  }

  const shown = new Set(agents.map((a) => a.address));
  /** @param {AgentRow} r @returns {string[]} */
  const rowOrder = (r) => {
    switch (r.kind) {
      case "lead": return [r.lead.address, ...r.children.flatMap(rowOrder)];
      case "agent": return [r.agent.address];
      case "pending": return [];
      default: {
        /** @type {never} */
        const unknownRow = r;
        return unknownRow;
      }
    }
  };
  /** @param {AgentGroup} g @returns {string[]} */
  const groupOrder = (g) => [...(g.lead ? [g.lead.address] : []), ...g.rows.flatMap(rowOrder), ...g.groups.flatMap(groupOrder)];
  return { groups, order: groups.flatMap(groupOrder).filter((a) => shown.has(a)) };
};

// Every fold key a view has: its groups (worktrees and machines' spaces too) and the leads that
// fold their agents (By space, By machine). Collapse all and Expand all act on these. With
// folded, only the ones that show: a folded group's own key, not what it hides.
/** @param {{ groups: AgentGroup[], folded?: Set<string> | null }} params @returns {string[]} */
export const getFoldIds = ({ groups, folded = null }) => groups.flatMap((g) => (folded?.has(g.id) ? [g.id] : [
  g.id,
  ...g.rows.filter((r) => r.kind === "lead" && r.children.length > 0).map((r) => `fold:${/** @type {{ lead: GroupLead }} */ (r).lead.address}`),
  ...getFoldIds({ groups: g.groups, folded }),
]));

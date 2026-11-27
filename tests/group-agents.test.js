import { test } from "node:test";
import assert from "node:assert/strict";
import { groupAgents, getAgentsLayout, getMoveTargets, getFoldIds } from "../mods/gh44-agents/groupAgents.js";

const agent = (address, space, { status = "idle", pinned = false, tab = `tab-${address}`, tabName = "1" } = {}) => ({
  address, space, status, pinned, tab, tab_name: tabName,
});
const lead = (address, space, followers = [], state = "ready", extra = {}) => ({ address, space, name: `lead ${address}`, state, followers, ...extra });
const SPACES = [
  { id: "a", name: "A", machine: null },
  { id: "b", name: "B", machine: null },
  { id: "c", name: "C", machine: null },
  { id: "vps/d", name: "D", machine: "vps" },
];

// A row as "address", a lead as "👑address", "+" when it names its space, children in brackets.
const rowShape = (r) => {
  if (r.kind === "pending") return `⏳${r.pending.address}`;
  const own = `${r.kind === "lead" ? `👑${r.lead.address}` : r.agent.address}${r.isCross ? "+" : ""}`;
  return r.kind === "lead" && r.children.length ? [own, r.children.map(rowShape)] : own;
};
// A group as [id, title, count, rows], with its inner groups after when it has some.
const shape = (groups) => groups.map((g) => (g.groups.length ? [g.id, g.title, g.count, shape(g.groups)] : [g.id, g.title, g.count, g.rows.map(rowShape)]));

const agents = [
  agent("t1", "a", { status: "working" }),
  agent("t2", "a", { pinned: true }),
  agent("t3", "a", { status: "blocked" }),
  agent("t4", "b", { status: "done" }),
  agent("t5", "b"),
];
const group = (over) => groupAgents({ agents, leads: [], spaces: SPACES, machines: [], ...over });

test("the view is By status until someone picks another", () => {
  assert.equal(getAgentsLayout(undefined), "status");
  assert.equal(getAgentsLayout("space"), "space");
  assert.equal(getAgentsLayout("lead"), "lead");
  assert.equal(getAgentsLayout("machine"), "machine");
  assert.equal(getAgentsLayout("priority"), "status");
});

test("By status: Leads on top, Pinned, then Needs you, Done, Working, Idle; every row names its space", () => {
  assert.deepEqual(shape(group({ layout: "status", leads: [lead("t5", "b", ["t4"])] }).groups), [
    ["leads", "Leads", 1, ["👑t5+"]],
    ["pinned", "Pinned", 1, ["t2+"]],
    ["status:blocked", "Needs you", 1, ["t3+"]],
    ["status:done", "Done", 1, ["t4+"]],
    ["status:working", "Working", 1, ["t1+"]],
  ]);
});

test("By space: each lead first with the agents it follows under it, then the rest; pinned stay in their space", () => {
  assert.deepEqual(shape(group({ layout: "space", leads: [lead("t3", "a", ["t1"])] }).groups), [
    ["space:a", "A", 3, [["👑t3", ["t1"]], "t2"]],
    ["space:b", "B", 2, ["t4", "t5"]],
  ]);
});

test("a space with only a lead being started is named and sits under its own machine", () => {
  const starting = lead("pending:p1", "vps/d", [], "starting");
  assert.deepEqual(shape(group({ layout: "space", leads: [starting] }).groups).at(-1), ["space:vps/d", "D", 1, ["👑pending:p1"]]);
  const machines = [{ id: null, name: "Mac" }, { id: "vps", name: "vps" }];
  assert.deepEqual(shape(group({ layout: "machine", leads: [starting], machines }).groups).at(-1)[0], "machine:vps");
});

test("By lead: the lead is the group, its agents under it; then No lead with everyone else, naming their space", () => {
  const { groups } = group({ layout: "lead", leads: [lead("t3", "a", ["t1"]), lead("t5", "b")] });
  assert.deepEqual(shape(groups), [
    ["lead:t3", "lead t3", 1, ["t1+"]],
    ["lead:t5", "lead t5", 0, []],
    ["noLead", "No lead", 2, ["t2+", "t4+"]],
  ]);
  assert.equal(groups[0].lead?.address, "t3");
  assert.equal(groups[0].space, "a");
});

test("By machine: machine, its spaces, their agents with leads first", () => {
  const remote = [...agents, agent("vps/t7", "vps/d")];
  const machines = [{ id: null, name: "MacBook" }, { id: "vps", name: "vps" }, { id: "idle-box", name: "idle-box" }];
  assert.deepEqual(shape(group({ agents: remote, layout: "machine", leads: [lead("t3", "a", ["t1"])], machines }).groups), [
    ["machine:local", "MacBook", 5, [
      ["space:a", "A", 3, [["👑t3", ["t1"]], "t2"]],
      ["space:b", "B", 2, ["t4", "t5"]],
    ]],
    ["machine:vps", "vps", 1, [["space:vps/d", "D", 1, ["vps/t7"]]]],
  ]);
});

test("a lead being started shows with the agents it will follow, and its new tab is never a second row", () => {
  const starting = lead("pending:p1", "a", ["t1"], "starting", { terminal: "t9", knownTabs: ["tab-old"] });
  const withTab = [...agents, agent("t9", "a", { tab: "tab-t9" }), agent("t8", "a", { tab: "tab-new", tabName: "Lead · lead pending:p1" })];
  const grouped = group({ agents: withTab, layout: "space", leads: [starting] });
  assert.deepEqual(shape(grouped.groups)[0], ["space:a", "A", 4, [["👑pending:p1", ["t1"]], "t2", "t3"]]);
  assert.equal(grouped.order.includes("t9") || grouped.order.includes("t8"), false);
});

test("an older tab with the lead's name, or one next to a failed lead, is a real agent and shows", () => {
  const old = agent("t8", "a", { tab: "tab-old", tabName: "Lead · lead pending:p1" });
  const starting = lead("pending:p1", "a", [], "starting", { terminal: null, knownTabs: ["tab-old"] });
  assert.equal(group({ agents: [old], layout: "space", leads: [starting] }).order.includes("t8"), true);
  const failed = lead("pending:p1", "a", [], "failed", { terminal: "t8", knownTabs: [] });
  assert.equal(group({ agents: [old], layout: "space", leads: [failed] }).order.includes("t8"), true);
});

test("an agent follows one lead only: a lead being started takes it from the one it had", () => {
  const ready = lead("t3", "a", ["t1"]);
  const starting = lead("pending:p1", "a", ["t1"], "starting");
  const grouped = group({ layout: "space", leads: [ready, starting] });
  assert.deepEqual(shape(grouped.groups)[0][3], ["👑t3", ["👑pending:p1", ["t1"]], "t2"]);
  assert.equal(grouped.order.filter((a) => a === "t1").length, 1);
});

test("agents a failed lead would have followed are free again", () => {
  const failed = lead("pending:p1", "a", ["t1"], "failed");
  assert.deepEqual(shape(group({ agents: agents.slice(0, 1), layout: "lead", leads: [failed] }).groups), [
    ["lead:pending:p1", "lead pending:p1", 0, []],
    ["noLead", "No lead", 1, ["t1+"]],
  ]);
});

test("navigation follows what is shown, top to bottom, leads included where they show", () => {
  const leads = [lead("t3", "a", ["t1"])];
  assert.deepEqual(group({ layout: "status", leads }).order, ["t3", "t2", "t4", "t1", "t5"]);
  assert.deepEqual(group({ layout: "space", leads }).order, ["t3", "t1", "t2", "t4", "t5"]);
  assert.deepEqual(group({ layout: "lead", leads }).order, ["t3", "t1", "t2", "t4", "t5"]);
});

test("a new agent being started shows under its lead in every view with the lead's agents, and its new tab never twice", () => {
  const ready = lead("t3", "a", ["t1"]);
  const starting = { address: "pending:p2", lead: "t3", space: "a", name: "Checkout bug", state: "starting", pendingId: "p2", terminal: null, knownTabs: [] };
  const withTab = [...agents, agent("t9", "a", { tab: "tab-new", tabName: "Checkout bug" })];
  const space = group({ agents: withTab, layout: "space", leads: [ready], pendingAgents: [starting] });
  assert.deepEqual(shape(space.groups)[0], ["space:a", "A", 4, [["👑t3", ["t1", "⏳pending:p2"]], "t2"]]);
  assert.equal(space.order.includes("t9"), false);
  assert.deepEqual(shape(group({ layout: "lead", leads: [ready], pendingAgents: [starting] }).groups)[0], ["lead:t3", "lead t3", 2, ["t1+", "⏳pending:p2"]]);
  assert.deepEqual(shape(group({ layout: "status", leads: [ready], pendingAgents: [starting] }).groups)[0], ["leads", "Leads", 1, [["👑t3+", ["⏳pending:p2"]]]]);
});

test("a new agent that failed but started after all shows once, as the agent", () => {
  const ready = lead("t3", "a", ["t1"]);
  const failed = { address: "pending:p2", lead: "t3", space: "a", name: "Checkout bug", state: "failed", reason: "noAgent", pendingId: "p2", terminal: "t9", knownTabs: [] };
  const grouped = group({ agents: [...agents, agent("t9", "a")], layout: "space", leads: [ready], pendingAgents: [failed] });
  assert.deepEqual(shape(grouped.groups)[0][3], [["👑t3", ["t1"]], "t2", "t9"]);
});

test("a follower in another space stays in its own space, tagged with its lead; By lead lists it under the lead", () => {
  const ready = lead("t3", "a", ["t1", "t4"]);
  const bySpace = group({ layout: "space", leads: [ready] });
  assert.deepEqual(shape(bySpace.groups), [
    ["space:a", "A", 3, [["👑t3", ["t1"]], "t2"]],
    ["space:b", "B", 2, ["t4", "t5"]],
  ]);
  const t4 = bySpace.groups[1].rows[0];
  assert.equal(t4.kind === "agent" && t4.lead?.address, "t3");
  const leadRow = bySpace.groups[0].rows[0];
  assert.deepEqual(leadRow.kind === "lead" && leadRow.followers.map((a) => a.address), ["t1", "t4"]);
  assert.deepEqual(shape(group({ layout: "lead", leads: [ready] }).groups)[0], ["lead:t3", "lead t3", 2, ["t1+", "t4+"]]);
});

test("Move to: the agent's own space first, then its checkout's worktrees (or its checkout), then the rest", () => {
  const leads = [lead("t3", "a"), lead("t5", "b"), lead("t8", "c"), lead("t9", "vps/d")];
  const repoOf = { a: "repo1", c: "repo1", b: "repo2" };
  assert.deepEqual(getMoveTargets({ space: "a", leads, spaces: SPACES, repoOf }).map((s) => [s.space, s.leads.map((l) => l.address)]), [
    ["a", ["t3"]], ["c", ["t8"]], ["b", ["t5"]], ["vps/d", ["t9"]],
  ]);
  assert.deepEqual(getMoveTargets({ space: "c", leads, spaces: SPACES, repoOf }).map((s) => s.space), ["c", "a", "b", "vps/d"]);
  assert.deepEqual(getMoveTargets({ space: "b", leads: [lead("t5", "b", [], "starting")], spaces: SPACES, repoOf }), []);
});

test("a worktree space nests under its main space in By space, which counts its agents", () => {
  const spaces = [...SPACES, { id: "w", name: "W", machine: null, parent: "a" }];
  const grouped = group({ agents: [...agents, agent("t6", "w")], spaces, layout: "space" }).groups;
  assert.deepEqual(grouped.map((g) => g.id), ["space:a", "space:b"]);
  const a = grouped[0];
  assert.equal(a.count, 4);
  assert.deepEqual(a.groups.map((g) => [g.id, g.isWorktree, g.rows.map(rowShape)]), [["space:w", true, ["t6"]]]);
});

test("a worktree's main space shows with no agents of its own; By machine nests the same way", () => {
  const spaces = [...SPACES, { id: "w", name: "W", machine: null, parent: "c" }];
  const grouped = group({ agents: [agent("t6", "w")], spaces, layout: "machine", machines: [{ id: null, name: "Mac" }] }).groups;
  assert.deepEqual(grouped[0].groups.map((g) => [g.id, g.count, g.rows.length, g.groups.map((w) => w.id)]), [["space:c", 1, 0, ["space:w"]]]);
});

test("a parent on another machine, or missing, leaves the worktree on its own", () => {
  const spaces = [...SPACES, { id: "w", name: "W", machine: null, parent: "vps/d" }, { id: "x", name: "X", machine: null, parent: "gone" }];
  const grouped = group({ agents: [agent("t6", "w"), agent("t7", "x")], spaces, layout: "space" }).groups;
  assert.deepEqual(grouped.map((g) => g.id), ["space:w", "space:x"]);
});

test("Collapse all folds every group, nested worktree and lead with agents the view shows", () => {
  const spaces = [...SPACES, { id: "w", name: "W", machine: null, parent: "a" }];
  const { groups } = group({ agents: [...agents, agent("t6", "w")], spaces, layout: "space", leads: [lead("t3", "a", ["t1"])] });
  assert.deepEqual(getFoldIds({ groups }), ["space:a", "fold:t3", "space:w", "space:b"]);
  assert.deepEqual(getFoldIds({ groups, folded: new Set(["space:a"]) }), ["space:a", "space:b"]);
});

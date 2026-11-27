import { test } from "node:test";
import assert from "node:assert/strict";
import { getSpaceMove, getDropEdge, getWorktreeParents } from "../mods/gh44-spaces/spaceOrder.js";
import { getSpaceSummaries } from "../mods/gh44-spaces/spaceSummary.js";
import { getMachineLabel, setMachineName } from "../mods/gh44-spaces/machineNames.js";
import { HUES, getNewSpaceColor, getHueFill } from "../mods/gh44-spaces/spaceColors.js";

const spaces = [
  { id: "a", machine: null },
  { id: "b", machine: null },
  { id: "c", machine: null },
  { id: "vps/d", machine: "vps" },
];

test("dropping a space on another of its machine moves it to that place", () => {
  assert.deepEqual(getSpaceMove({ spaces, from: "a", to: "c" }), { status: "move", id: "a", index: 3 });
  assert.deepEqual(getSpaceMove({ spaces, from: "c", to: "a" }), { status: "move", id: "c", index: 1 });
});

test("a space never moves onto itself or into another machine's block", () => {
  assert.deepEqual(getSpaceMove({ spaces, from: "a", to: "a" }), { status: "none" });
  assert.deepEqual(getSpaceMove({ spaces, from: "a", to: "vps/d" }), { status: "none" });
  assert.deepEqual(getSpaceMove({ spaces, from: "gone", to: "a" }), { status: "none" });
});

test("the drop line sits below the target when moving down and above it when moving up", () => {
  assert.equal(getDropEdge({ spaces, from: "a", to: "c" }), "bottom");
  assert.equal(getDropEdge({ spaces, from: "c", to: "a" }), "top");
  assert.equal(getDropEdge({ spaces, from: "a", to: "a" }), null);
  assert.equal(getDropEdge({ spaces, from: "a", to: "vps/d" }), null);
});

const agent = (address, space, status) => ({ address, space, status });

test("a space's summary counts its agents and says when one needs you", () => {
  const summaries = getSpaceSummaries({
    agents: [agent("t1", "a", "idle"), agent("t2", "a", "working"), agent("t3", "a", "blocked"), agent("t4", "a", "working"), agent("t5", "b", "done")],
    terminals: [],
  });
  assert.deepEqual(summaries.get("a"), { total: 4, isBlocked: true, leadCount: 0 });
  assert.deepEqual(summaries.get("b"), { total: 1, isBlocked: false, leadCount: 0 });
  assert.equal(summaries.get("c"), undefined);
});

test("a space with a lead terminal counts its leads", () => {
  const summaries = getSpaceSummaries({
    agents: [agent("t1", "a", "idle"), agent("t2", "a", "working"), agent("vps/t3", "vps/d", "idle")],
    terminals: [
      { address: "t1", labels: { "omnia.role": "lead" } },
      { address: "t2", labels: {} },
      { address: "vps/t3", labels: { "omnia.role": "lead" } },
    ],
  });
  assert.equal(summaries.get("a").leadCount, 1);
  assert.equal(summaries.get("vps/d").leadCount, 1);
});

test("the edit box offers six gh44 hues, none of them the lead's lavender or the blocked red", () => {
  assert.equal(HUES.length, 6);
  assert.ok(!HUES.some((h) => h.id === "ansi5" || h.id === "ansi1"));
});

test("a new space gets the hue fewest spaces use, the first one on a tie", () => {
  assert.equal(getNewSpaceColor({ used: [] }), HUES[0].id);
  assert.equal(getNewSpaceColor({ used: [HUES[0].id, HUES[1].id] }), HUES[2].id);
  assert.equal(getNewSpaceColor({ used: HUES.map((h) => h.id).concat(HUES[0].id) }), HUES[1].id);
});

test("a hue's fill is its theme color, its own light or dark step, or a stored hex as it is", () => {
  const t = { ansi6: "#5CB8A2" };
  assert.equal(getHueFill({ color: "ansi6", t, isDark: true }), "#5CB8A2");
  assert.equal(getHueFill({ color: "#C59172", t, isDark: true }), "#C59172");
  assert.equal(getHueFill({ color: "#C59172", t, isDark: false }), "#B64309");
  assert.equal(getHueFill({ color: "#123456", t, isDark: false }), "#123456");
  assert.equal(getHueFill({ color: "ansi9", t, isDark: true }), null);
});

test("a machine is called by its own name, with its address beside a name someone gave it", () => {
  assert.deepEqual(getMachineLabel({ names: {}, machine: null }), { name: "This computer", host: null });
  assert.deepEqual(getMachineLabel({ names: {}, machine: "100.93.7.19" }), { name: "100.93.7.19", host: null });
  assert.deepEqual(getMachineLabel({ names: { "100.93.7.19": "Windows box" }, machine: "100.93.7.19" }), { name: "Windows box", host: "100.93.7.19" });
  assert.deepEqual(getMachineLabel({ names: { "": "MacBook" }, machine: null }), { name: "MacBook", host: "this computer" });
  assert.deepEqual(getMachineLabel({ names: "junk", machine: null }), { name: "This computer", host: null });
});

test("renaming a machine keeps the name trimmed; an empty one or its own address goes back to the address", () => {
  assert.deepEqual(setMachineName({ names: {}, machine: "vps", name: "  Hetzner " }), { vps: "Hetzner" });
  assert.deepEqual(setMachineName({ names: { vps: "Hetzner", "": "Mac" }, machine: "vps", name: "" }), { "": "Mac" });
  assert.deepEqual(setMachineName({ names: { vps: "Hetzner" }, machine: "vps", name: "vps" }), {});
  assert.deepEqual(setMachineName({ names: {}, machine: null, name: "MacBook" }), { "": "MacBook" });
});

test("a linked worktree's parent is its repo's main checkout space", () => {
  const parents = getWorktreeParents({ spaces: [
    { id: "main", repo: "r1", linked: false },
    { id: "wt", repo: "r1", linked: true },
    { id: "lone", repo: "r2", linked: true },
    { id: "plain", repo: null, linked: false },
  ] });
  assert.deepEqual(parents, { wt: "main" });
});

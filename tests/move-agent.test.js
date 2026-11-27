import { test } from "node:test";
import assert from "node:assert/strict";
import { planMove } from "../mods/gh44-agents/moveAgent.js";
import { getNextSelection } from "../mods/gh44-agents/selection.js";

const agents = [
  { address: "t1", space: "a" },
  { address: "t2", space: "a" },
  { address: "t3", space: "a" },
  { address: "t4", space: "b" },
  { address: "vps/t5", space: "vps/c" },
  { address: "vps/t6", space: "vps/c" },
];
const leads = [
  { address: "t1", space: "a", name: "THU sprint", state: "ready", followers: ["t2"] },
  { address: "t9", space: "a", name: "Other", state: "ready", followers: [] },
  { address: "vps/t5", space: "vps/c", name: "Remote", state: "ready", followers: [] },
  { address: "pending:p1", space: "a", name: "Soon", state: "starting", followers: [] },
];
const leadOf = new Map([["t2", "t1"]]);
const move = (addresses, to) => planMove({ agents, leads, leadOf, addresses, to });

test("moving an agent to a lead of its space labels it with that lead, and undo puts back what it had", () => {
  assert.deepEqual(move(["t3"], "t1"), {
    status: "moved", moved: ["t3"], leadName: "THU sprint",
    labels: [{ terminal: "t3", labels: ["omnia.lead=t1"] }],
    undo: [{ terminal: "t3", labels: ["omnia.lead="] }],
  });
  assert.deepEqual(move(["t2"], "t9").undo, [{ terminal: "t2", labels: ["omnia.lead=t1"] }]);
});

test("on another machine the label holds the lead's bare id", () => {
  assert.deepEqual(move(["vps/t6"], "vps/t5").labels, [{ terminal: "vps/t6", labels: ["omnia.lead=t5"] }]);
});

test("moving to No lead takes the label off", () => {
  assert.deepEqual(move(["t2"], null), {
    status: "moved", moved: ["t2"], leadName: null,
    labels: [{ terminal: "t2", labels: ["omnia.lead="] }],
    undo: [{ terminal: "t2", labels: ["omnia.lead=t1"] }],
  });
});

test("an agent of any space or machine can follow any lead", () => {
  assert.deepEqual(move(["t3", "t4"], "t1").moved, ["t3", "t4"]);
  assert.deepEqual(move(["t4"], "vps/t5").labels, [{ terminal: "t4", labels: ["omnia.lead=vps/t5"] }]);
  assert.deepEqual(move(["vps/t6"], "t1").labels, [{ terminal: "vps/t6", labels: ["omnia.lead=local/t1"] }]);
  assert.deepEqual(planMove({ agents, leads, leadOf: new Map([["vps/t6", "t1"]]), addresses: ["vps/t6"], to: null }).undo, [{ terminal: "vps/t6", labels: ["omnia.lead=local/t1"] }]);
});

test("agents already there, leads themselves and unknown agents are left out; with none left nothing moves", () => {
  assert.deepEqual(move(["t2"], "t1"), { status: "refused", reason: "noChange" });
  assert.deepEqual(move(["t1"], "t9"), { status: "refused", reason: "noChange" });
  assert.deepEqual(move(["t3"], null), { status: "refused", reason: "noChange" });
  assert.deepEqual(move(["t2", "t3"], "t1").moved, ["t3"]);
});

test("only a ready lead takes agents", () => {
  assert.deepEqual(move(["t3"], "pending:p1"), { status: "refused", reason: "noLead" });
  assert.deepEqual(move(["t3"], "t404"), { status: "refused", reason: "noLead" });
});

const shown = agents;
const select = (over) => getNextSelection({ selected: [], anchor: null, shown, address: "t2", mode: "toggle", ...over });

test("⌘-click adds an agent and takes it out again", () => {
  assert.deepEqual(select({}), { selected: ["t2"], anchor: "t2" });
  assert.deepEqual(select({ selected: ["t1"], anchor: "t1" }), { selected: ["t1", "t2"], anchor: "t2" });
  assert.deepEqual(select({ selected: ["t1", "t2"], anchor: "t2" }), { selected: ["t1"], anchor: "t2" });
});

test("a selection can span spaces", () => {
  assert.deepEqual(select({ selected: ["t1", "t2"], anchor: "t2", address: "t4" }), { selected: ["t1", "t2", "t4"], anchor: "t4" });
});

test("shift-click selects the shown agents from the last click to this one, across spaces", () => {
  assert.deepEqual(select({ selected: ["t1"], anchor: "t1", address: "t3", mode: "range" }), { selected: ["t1", "t2", "t3"], anchor: "t1" });
  assert.deepEqual(select({ selected: ["t3"], anchor: "t3", address: "t1", mode: "range" }), { selected: ["t1", "t2", "t3"], anchor: "t3" });
  assert.deepEqual(select({ selected: ["t4"], anchor: "t4", address: "t2", mode: "range" }), { selected: ["t2", "t3", "t4"], anchor: "t4" });
  assert.deepEqual(select({ selected: [], anchor: null, address: "t2", mode: "range" }), { selected: ["t2"], anchor: "t2" });
});

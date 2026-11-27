import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getLeadModel, getLeadTabName, getLeadPrompt, getStartLabels, getStopLabels, withPendingLeads, getPendingStep, getPendingTabName, getNewAgentLabels, getPendingAgents, getPromotePlan, getRelativeAddress, resolveRelativeAddress,
} from "../mods/gh44-agents/leads.js";

const agent = (address, space, title = address) => ({ address, space, title });
const terminal = (address, labels = {}) => ({ address, labels });

test("a lead is an agent whose terminal says omnia.role=lead; its name comes from omnia.lead.name", () => {
  const { leads } = getLeadModel({
    agents: [agent("t1", "a", "claude"), agent("t2", "a")],
    terminals: [terminal("t1", { "omnia.role": "lead", "omnia.lead.name": "THU sprint" }), terminal("t2")],
  });
  assert.deepEqual(leads, [{ address: "t1", space: "a", name: "THU sprint", state: "ready", followers: [] }]);
});

test("a space can have several leads; each follows the agents whose omnia.lead names it", () => {
  const { leads, leadOf } = getLeadModel({
    agents: [agent("t1", "a"), agent("t2", "a"), agent("t3", "a"), agent("t4", "a"), agent("t5", "a")],
    terminals: [
      terminal("t1", { "omnia.role": "lead", "omnia.lead.name": "One" }),
      terminal("t2", { "omnia.role": "lead", "omnia.lead.name": "Two" }),
      terminal("t3", { "omnia.lead": "t1" }),
      terminal("t4", { "omnia.lead": "t2" }),
      terminal("t5"),
    ],
  });
  assert.deepEqual(leads.map((l) => [l.name, l.followers]), [["One", ["t3"]], ["Two", ["t4"]]]);
  assert.equal(leadOf.get("t3"), "t1");
  assert.equal(leadOf.get("t4"), "t2");
  assert.equal(leadOf.has("t5"), false);
});

test("a lead follows agents in any space; an agent following a lead that is gone has no lead", () => {
  const { leads, leadOf } = getLeadModel({
    agents: [agent("t1", "a"), agent("t3", "b"), agent("t4", "a")],
    terminals: [terminal("t1", { "omnia.role": "lead" }), terminal("t3", { "omnia.lead": "t1" }), terminal("t4", { "omnia.lead": "t9" })],
  });
  assert.deepEqual(leads[0].followers, ["t3"]);
  assert.equal(leadOf.get("t3"), "t1");
  assert.equal(leadOf.has("t4"), false);
});

test("a lead follows agents on other machines: the label names the lead as seen from the follower's machine", () => {
  const { leads } = getLeadModel({
    agents: [agent("t1", "a"), agent("vps/t5", "vps/c"), agent("vps/t2", "vps/c"), agent("t6", "a")],
    terminals: [
      terminal("t1", { "omnia.role": "lead", "omnia.lead.name": "Here" }),
      terminal("vps/t2", { "omnia.role": "lead", "omnia.lead.name": "There" }),
      terminal("vps/t5", { "omnia.lead": "local/t1" }),
      terminal("t6", { "omnia.lead": "vps/t2" }),
    ],
  });
  assert.deepEqual(leads.map((l) => [l.name, l.followers]), [["Here", ["vps/t5"]], ["There", ["t6"]]]);
});

test("an address reads bare on its own machine and with its machine elsewhere, and reads back the same", () => {
  const cases = [
    { from: null, address: "t1", value: "t1" },
    { from: "vps", address: "t1", value: "local/t1" },
    { from: null, address: "vps/t2", value: "vps/t2" },
    { from: "vps", address: "vps/t2", value: "t2" },
    { from: "box", address: "vps/t2", value: "vps/t2" },
  ];
  for (const { from, address, value } of cases) {
    assert.equal(getRelativeAddress({ from, address }), value);
    assert.equal(resolveRelativeAddress({ from, value }), address);
  }
});

test("on another machine the label holds the bare id, and only that machine's lead matches", () => {
  const { leads } = getLeadModel({
    agents: [agent("vps/t1", "vps/a"), agent("vps/t2", "vps/a"), agent("t1", "a")],
    terminals: [
      terminal("vps/t1", { "omnia.role": "lead", "omnia.lead.name": "Remote" }),
      terminal("vps/t2", { "omnia.lead": "t1" }),
      terminal("t1", { "omnia.lead": "t1" }),
    ],
  });
  assert.deepEqual(leads[0].followers, ["vps/t2"]);
});

test("a lead without a name label is called by its title, and never follows a lead itself", () => {
  const { leads, leadOf } = getLeadModel({
    agents: [agent("t1", "a", "Lead · THU"), agent("t2", "a")],
    terminals: [terminal("t1", { "omnia.role": "lead", "omnia.lead": "t2" }), terminal("t2", { "omnia.role": "lead" })],
  });
  assert.equal(leads[0].name, "Lead · THU");
  assert.equal(leadOf.size, 0);
});

test("starting a lead: its tab name, the skill it runs with its followers, and the labels set after", () => {
  assert.equal(getLeadTabName("THU sprint"), "Lead · THU sprint");
  assert.equal(getLeadPrompt({ name: "THU sprint", followers: ["t3", "vps/t4"] }), '/gh44-make-lead "THU sprint" t3 vps/t4');
  assert.equal(getLeadPrompt({ name: 'say "hi"', followers: [] }), '/gh44-make-lead "say hi"');
  assert.deepEqual(getStartLabels({ lead: "vps/t1", name: "THU sprint", followers: ["vps/t3", "t4"] }), [
    { terminal: "vps/t1", labels: ["omnia.role=lead", "omnia.lead.name=THU sprint"] },
    { terminal: "vps/t3", labels: ["omnia.lead=t1"] },
    { terminal: "t4", labels: ["omnia.lead=vps/t1"] },
  ]);
  assert.equal(getLeadPrompt({ name: "THU sprint", followers: ["vps/t3", "t4"], machine: "vps" }), '/gh44-make-lead "THU sprint" t3 local/t4');
});

test("stop leading takes the labels off the lead and its followers only", () => {
  assert.deepEqual(getStopLabels({ lead: { address: "t1", followers: ["t3"] } }), [
    { terminal: "t1", labels: ["omnia.role=", "omnia.lead.name="] },
    { terminal: "t3", labels: ["omnia.lead="] },
  ]);
});

const pending = { id: "p1", name: "THU sprint", space: "a", followers: ["t3"], status: "starting", startedAt: 0, terminal: null, knownTabs: [] };

test("a lead being started shows as a starting lead until the model has it", () => {
  const ready = { address: "t1", space: "a", name: "One", state: "ready", followers: [] };
  assert.deepEqual(withPendingLeads({ leads: [ready], pending: [pending] }).map((l) => [l.address, l.state, l.followers]), [
    ["t1", "ready", []],
    ["pending:p1", "starting", ["t3"]],
  ]);
  assert.deepEqual(withPendingLeads({ leads: [ready], pending: [{ ...pending, terminal: "t1" }] }).map((l) => l.address), ["t1"]);
  assert.equal(withPendingLeads({ leads: [], pending: [{ ...pending, status: "failed", reason: "noTab" }] })[0].state, "failed");
  assert.equal(withPendingLeads({ leads: [], pending: [{ ...pending, terminal: "t9" }] })[0].terminal, "t9");
  assert.deepEqual(withPendingLeads({ leads: [], pending: [{ ...pending, knownTabs: ["tb1"] }] })[0].knownTabs, ["tb1"]);
});

const space = { id: "a", tabs: [{ id: "tb1", name: "Lead · THU sprint" }, { id: "tb2", name: "2" }] };
const step = (over) => getPendingStep({
  pending, now: 1_000, spaces: [space], panes: [{ tab: "tb1", terminal: "t9" }], leadAddresses: new Set(), ...over,
});

test("a starting lead is labeled once its tab shows, ready once it is a lead", () => {
  assert.deepEqual(step({}), { kind: "label", terminal: "t9" });
  assert.deepEqual(step({ pending: { ...pending, terminal: "t9" } }), { kind: "wait" });
  assert.deepEqual(step({ pending: { ...pending, terminal: "t9" }, leadAddresses: new Set(["t9"]) }), { kind: "ready" });
});

test("a starting lead fails when its tab never shows, its tab closes, or Claude never reports", () => {
  assert.deepEqual(step({ spaces: [{ id: "a", tabs: [] }], now: 1_000 }), { kind: "wait" });
  assert.deepEqual(step({ spaces: [{ id: "a", tabs: [] }], now: 30_000 }), { kind: "fail", reason: "noTab" });
  assert.deepEqual(step({ pending: { ...pending, terminal: "t9" }, panes: [] }), { kind: "fail", reason: "closed" });
  assert.deepEqual(step({ pending: { ...pending, terminal: "t9" }, now: 120_000 }), { kind: "fail", reason: "noAgent" });
  assert.deepEqual(step({ pending: { ...pending, status: "failed", reason: "noTab" } }), { kind: "wait" });
});

test("a tab that was there before the start is never taken for the new lead's, even with the same name", () => {
  const twoTabs = { id: "a", tabs: [{ id: "old", name: "Lead · THU sprint" }, { id: "new", name: "Lead · THU sprint" }] };
  const panes = [{ tab: "old", terminal: "t8" }, { tab: "new", terminal: "t9" }];
  assert.deepEqual(step({ spaces: [twoTabs], panes, pending: { ...pending, knownTabs: ["old"] } }), { kind: "label", terminal: "t9" });
  assert.deepEqual(step({ spaces: [{ id: "a", tabs: [twoTabs.tabs[0]] }], panes, pending: { ...pending, knownTabs: ["old"] } }), { kind: "wait" });
});

const newAgent = { ...pending, id: "p2", kind: "agent", lead: "t1", name: "Checkout bug", followers: [], knownTabs: ["tb2"] };

test("a new agent under a lead is found by its own tab name in a new tab, and is ready once it is an agent", () => {
  const space = { id: "a", tabs: [{ id: "tb2", name: "Checkout bug" }, { id: "tb3", name: "Checkout bug" }] };
  const panes = [{ tab: "tb2", terminal: "t8" }, { tab: "tb3", terminal: "t9" }];
  assert.equal(getPendingTabName(newAgent), "Checkout bug");
  assert.equal(getPendingTabName(pending), "Lead · THU sprint");
  assert.deepEqual(getPendingStep({ pending: newAgent, now: 1_000, spaces: [space], panes, leadAddresses: new Set() }), { kind: "label", terminal: "t9" });
  const labeled = { ...newAgent, terminal: "t9" };
  assert.deepEqual(getPendingStep({ pending: labeled, now: 1_000, spaces: [space], panes, leadAddresses: new Set(["t9"]) }), { kind: "wait" });
  assert.deepEqual(getPendingStep({ pending: labeled, now: 1_000, spaces: [space], panes, leadAddresses: new Set(), agentAddresses: new Set(["t9"]) }), { kind: "ready" });
});

test("a new agent's labels name its lead (bare id) and the agent", () => {
  assert.deepEqual(getNewAgentLabels({ terminal: "vps/t9", lead: "vps/t1", name: "Checkout bug" }), [
    { terminal: "vps/t9", labels: ["omnia.lead=t1", "omnia.name=Checkout bug"] },
  ]);
});

test("new agents being started are not leads; they show as starting agents under their lead", () => {
  assert.deepEqual(withPendingLeads({ leads: [], pending: [newAgent] }), []);
  assert.deepEqual(getPendingAgents({ pending: [pending, { ...newAgent, status: "failed", reason: "noTab" }] }).map((p) => [p.address, p.lead, p.name, p.state, p.reason]), [
    ["pending:p2", "t1", "Checkout bug", "failed", "noTab"],
  ]);
});

test("a failed lead or new agent that came up after all is done waiting", () => {
  const failedAgent = { ...newAgent, status: "failed", reason: "noAgent", terminal: "t9" };
  const panes = [{ tab: "tb3", terminal: "t9" }];
  assert.deepEqual(getPendingStep({ pending: failedAgent, now: 1_000, spaces: [], panes, leadAddresses: new Set(), agentAddresses: new Set(["t9"]) }), { kind: "ready" });
  assert.deepEqual(getPendingStep({ pending: failedAgent, now: 1_000, spaces: [], panes, leadAddresses: new Set(), agentAddresses: new Set() }), { kind: "wait" });
  assert.deepEqual(getPendingStep({ pending: { ...failedAgent, terminal: null }, now: 1_000, spaces: [], panes, leadAddresses: new Set(), agentAddresses: new Set(["t9"]) }), { kind: "wait" });
});

test("two starts with the same name never take the same new tab", () => {
  const space = { id: "a", tabs: [{ id: "tb3", name: "Checkout bug" }, { id: "tb4", name: "Checkout bug" }] };
  const panes = [{ tab: "tb3", terminal: "t9" }, { tab: "tb4", terminal: "t10" }];
  const at = (claimed) => getPendingStep({ pending: newAgent, now: 1_000, spaces: [space], panes, leadAddresses: new Set(), claimed });
  assert.deepEqual(at(new Set(["t9"])), { kind: "label", terminal: "t10" });
  assert.deepEqual(at(new Set(["t9", "t10"])), { kind: "wait" });
});

test("making one agent a lead labels that session itself, drops the lead it followed, and loads the skill there", () => {
  assert.deepEqual(getPromotePlan({ terminal: "vps/t7", name: "Checkout bug" }), {
    labels: [{ terminal: "vps/t7", labels: ["omnia.role=lead", "omnia.lead.name=Checkout bug", "omnia.lead="] }],
    message: '/gh44-make-lead "Checkout bug"',
  });
});

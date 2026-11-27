import { test } from "node:test";
import assert from "node:assert/strict";
import { getDisplayName, getRenameLabels } from "../mods/gh44-agents/names.js";
import { getLeadModel } from "../mods/gh44-agents/leads.js";

test("a name someone gave an agent wins over its own title; none, or a blank one, keeps the title", () => {
  assert.equal(getDisplayName({ labels: { "omnia.name": "Checkout bug" }, fallback: "#16492 address-review" }), "Checkout bug");
  assert.equal(getDisplayName({ labels: { "omnia.name": "  " }, fallback: "#16492 address-review" }), "#16492 address-review");
  assert.equal(getDisplayName({ labels: undefined, fallback: "THU-4890 implement" }), "THU-4890 implement");
});

test("renaming sets the trimmed name on the agent's terminal; an empty name takes the label off", () => {
  assert.deepEqual(getRenameLabels({ terminal: "vps/t7", name: "  Checkout bug " }), [{ terminal: "vps/t7", labels: ["omnia.name=Checkout bug"] }]);
  assert.deepEqual(getRenameLabels({ terminal: "t7", name: "" }), [{ terminal: "t7", labels: ["omnia.name="] }]);
});

test("a renamed lead is called by its new name", () => {
  const { leads } = getLeadModel({
    agents: [{ address: "t1", space: "a", title: "claude" }],
    terminals: [{ address: "t1", labels: { "omnia.role": "lead", "omnia.lead.name": "THU sprint", "omnia.name": "Sprint 12" } }],
  });
  assert.equal(leads[0].name, "Sprint 12");
});

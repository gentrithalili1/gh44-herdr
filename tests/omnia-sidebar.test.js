import { test } from "node:test";
import assert from "node:assert/strict";
import { isOmniaSidebarOn, getSidebarLayout } from "../mods/hub/omnia-sidebar.js";

test("the omnia sidebar is on until someone turns it off", () => {
  assert.equal(isOmniaSidebarOn(undefined), true);
  assert.equal(isOmniaSidebarOn(null), true);
  assert.equal(isOmniaSidebarOn(true), true);
  assert.equal(isOmniaSidebarOn(false), false);
});

const layout = {
  id: "root", type: "row", theme: "gh44",
  children: [
    { id: "sidebar", type: "column", children: [
      { id: "spaces", type: "block", content: { mod: "gh44-spaces" }, size: { weight: 1 } },
      { id: "agents", type: "block", content: { mod: "gh44-agents" }, min: 90 },
    ] },
    { id: "main", type: "block", content: { tab: "active" } },
  ],
};

test("off puts Herdr's spaces and agents in the two sidebar blocks; on puts the omnia ones back; the rest stays", () => {
  const off = getSidebarLayout({ layout, isOmnia: false });
  assert.deepEqual(off.children[0].children.map((b) => b.content.mod), ["spaces", "agents"]);
  assert.deepEqual(off.children[0].children[0].size, { weight: 1 });
  assert.equal(off.children[0].children[1].min, 90);
  assert.deepEqual(off.children[1], layout.children[1]);
  assert.equal(off.theme, "gh44");
  const on = getSidebarLayout({ layout: off, isOmnia: true });
  assert.deepEqual(on, layout);
});

test("a layout without the two blocks is left alone", () => {
  assert.equal(getSidebarLayout({ layout: { id: "root", type: "row", children: [] }, isOmnia: false }), null);
  assert.equal(getSidebarLayout({ layout: null, isOmnia: true }), null);
});

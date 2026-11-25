import { test } from "node:test";
import assert from "node:assert/strict";
import { getFilterSets, saveFilterSet, removeFilterSet, findActiveSet, getFilterChips, suggestSetName, MAX_SETS_PER_TAB } from "../mods/hub/saved-filters.js";

const defaults = { scope: "review", labels: [], checks: "any" };
const defs = [
  { title: "Label", field: "labels", isMulti: true, options: [{ value: "bug", label: "Bug" }, { value: "fe", label: "FE" }, { value: "ux", label: "UX" }] },
  { title: "CI", field: "checks", isMulti: false, options: [{ value: "any", label: "Any" }, { value: "failing", label: "Failing" }] },
];

test("a set is saved per tab, and the same name in any case replaces it in place", () => {
  let saved = saveFilterSet({ saved: null, tab: "github", name: " Failing FE ", filters: { checks: "failing" }, id: "a" });
  saved = saveFilterSet({ saved, tab: "linear", name: "Mine", filters: { mine: true }, id: "b" });
  saved = saveFilterSet({ saved, tab: "github", name: "failing fe", filters: { checks: "pending" }, id: "c" });
  assert.deepEqual(getFilterSets({ saved, tab: "github" }), [{ id: "a", name: "failing fe", filters: { checks: "pending" } }]);
  assert.equal(getFilterSets({ saved, tab: "linear" }).length, 1);
  assert.equal(saveFilterSet({ saved, tab: "github", name: "   ", filters: {}, id: "d" }), saved);
});

test("a tab keeps the newest sets, broken entries read as none, and a set can be removed", () => {
  let saved = {};
  for (let i = 0; i < MAX_SETS_PER_TAB + 2; i += 1) saved = saveFilterSet({ saved, tab: "oncall", name: `s${i}`, filters: {}, id: `id${i}` });
  const sets = getFilterSets({ saved, tab: "oncall" });
  assert.equal(sets.length, MAX_SETS_PER_TAB);
  assert.equal(sets[0].name, "s2");
  assert.deepEqual(getFilterSets({ saved: { github: [{ name: "no id" }, 3] }, tab: "github" }), []);
  assert.equal(getFilterSets({ saved: removeFilterSet({ saved, tab: "oncall", id: "id5" }), tab: "oncall" }).length, MAX_SETS_PER_TAB - 1);
});

test("the active set matches the filters in use field by field over the defaults", () => {
  const sets = [{ id: "a", name: "Failing", filters: { checks: "failing" } }, { id: "b", name: "Bugs", filters: { scope: "review", labels: ["bug"], checks: "any" } }];
  assert.equal(findActiveSet({ sets, filters: { scope: "review", labels: [], checks: "failing" }, defaults })?.id, "a");
  assert.equal(findActiveSet({ sets, filters: { ...defaults, labels: ["bug"] }, defaults })?.id, "b");
  assert.equal(findActiveSet({ sets, filters: { ...defaults, scope: "mine" }, defaults }), null);
});

test("chips show the filters in use, by label, and a long pick as any of N", () => {
  assert.deepEqual(getFilterChips({ defs, filters: defaults, defaults }), []);
  assert.deepEqual(getFilterChips({ defs, filters: { ...defaults, labels: ["bug", "fe"], checks: "failing" }, defaults }), [
    { field: "labels", title: "Label", text: "Bug, FE" },
    { field: "checks", title: "CI", text: "Failing" },
  ]);
  assert.equal(getFilterChips({ defs, filters: { ...defaults, labels: ["bug", "fe", "ux"] }, defaults })[0].text, "any of 3");
  assert.equal(suggestSetName({ scopeLabel: "Review requests", chips: [{ field: "checks", title: "CI", text: "Failing" }] }), "Review requests · Failing");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { getWorktreesRoot, slugBranch, getWorktreePath } from "../mods/hub/worktree-path.js";

test("worktrees root defaults to ~/.herdr/worktrees", () => {
  assert.equal(getWorktreesRoot({ settingsText: null, userHome: "/Users/me" }), "/Users/me/.herdr/worktrees");
  assert.equal(getWorktreesRoot({ settingsText: "{}", userHome: "/Users/me/" }), "/Users/me/.herdr/worktrees");
});

test("worktrees root reads worktrees.directory", () => {
  const settingsText = JSON.stringify({ worktrees: { directory: "~/wt/" } });
  assert.equal(getWorktreesRoot({ settingsText, userHome: "/Users/me" }), "/Users/me/wt");
  assert.equal(getWorktreesRoot({ settingsText: JSON.stringify({ worktrees: { directory: "/srv/wt" } }), userHome: "/Users/me" }), "/srv/wt");
});

test("worktrees root is null for an unusable setting", () => {
  assert.equal(getWorktreesRoot({ settingsText: "{not json", userHome: "/Users/me" }), null);
  assert.equal(getWorktreesRoot({ settingsText: JSON.stringify({ worktrees: { directory: "relative/wt" } }), userHome: "/Users/me" }), null);
  assert.equal(getWorktreesRoot({ settingsText: JSON.stringify({ worktrees: { directory: " " } }), userHome: "/Users/me" }), null);
});

test("branch slug matches Herdr's dialog", () => {
  assert.equal(slugBranch("thu-4886-level-2-category"), "thu-4886-level-2-category");
  assert.equal(slugBranch("feat/THU-1 thing"), "feat-THU-1-thing");
  assert.match(slugBranch("///"), /^branch-[0-9a-f]{8}$/);
});

test("worktree path tries the plain folder, then numbered ones", () => {
  const params = { root: "/h/.herdr/worktrees", repo: "frontend", branch: "thu-4886-x" };
  assert.equal(getWorktreePath({ ...params, attempt: 0 }), "/h/.herdr/worktrees/frontend/thu-4886-x");
  assert.equal(getWorktreePath({ ...params, attempt: 1 }), "/h/.herdr/worktrees/frontend/thu-4886-x-2");
  assert.equal(getWorktreePath({ ...params, attempt: 2 }), "/h/.herdr/worktrees/frontend/thu-4886-x-3");
});

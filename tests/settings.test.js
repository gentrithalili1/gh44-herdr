import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getSettings, getDefaultSkill, getGithubSituation, getLinearSituation, getSkillRole, getTicketSkills, getTabSkills, getKeySkills, getKeyHints,
  addSkill, removeSkill, setSkillKey, setDefaultSkill, hasNoDefaults, isValidSkillName,
  getWhereToRun, getShownTab, getGh44Setup, isUsingGh44Setup, countInstalledSkills,
} from "../mods/hub/settings.js";

const { skills } = getSettings({ saved: undefined });
const pr = ({ author, hasConflicts = false }) => ({ author, hasConflicts });
const issue = ({ stateType, state = "", isMyPullRequest = true, prUrl = null }) => ({ stateType, state, isMyPullRequest, prUrl });
const githubDefault = (params) => getDefaultSkill({ skills, tab: "github", situation: getGithubSituation(params) });
const linearDefault = (i) => getDefaultSkill({ skills, tab: "linear", situation: getLinearSituation(i) });

test("a PR row runs code-review on someone else's PR, address-review on mine, resolve-conflicts on mine with conflicts", () => {
  assert.equal(githubDefault({ pr: pr({ author: "ana" }), login: "me" }), "gh44-code-review");
  assert.equal(githubDefault({ pr: pr({ author: "ana", hasConflicts: true }), login: "me" }), "gh44-code-review");
  assert.equal(githubDefault({ pr: pr({ author: "me" }), login: null }), "gh44-code-review");
  assert.equal(githubDefault({ pr: pr({ author: "me" }), login: "me" }), "gh44-address-review");
  assert.equal(githubDefault({ pr: pr({ author: "me", hasConflicts: true }), login: "me" }), "gh44-resolve-conflicts");
});

test("a ticket row runs plan when not started, implement in progress, and a review skill by whose PR it is", () => {
  assert.equal(linearDefault(issue({ stateType: "backlog" })), "gh44-plan");
  assert.equal(linearDefault(issue({ stateType: "triage" })), "gh44-plan");
  assert.equal(linearDefault(issue({ stateType: "unstarted" })), "gh44-plan");
  assert.equal(linearDefault(issue({ stateType: "started", state: "In Progress" })), "gh44-implement");
  assert.equal(linearDefault(issue({ stateType: "started", state: "In Review", isMyPullRequest: true })), "gh44-address-review");
  assert.equal(linearDefault(issue({ stateType: "started", state: "In Review", isMyPullRequest: false })), "gh44-code-review");
});

test("review defaults get the PR URL and never ask where; work defaults move the ticket and ask where", () => {
  assert.equal(getSkillRole({ skills, skill: "gh44-address-review" }), "review");
  assert.equal(getSkillRole({ skills, skill: "gh44-code-review" }), "review");
  assert.equal(getSkillRole({ skills, skill: "gh44-plan" }), "work");
  assert.equal(getSkillRole({ skills, skill: "gh44-implement" }), "work");
  assert.equal(getSkillRole({ skills, skill: "gh44-clarify" }), "other");
});

test("a ticket's menu offers address-review on my PR only, and code-review on someone else's PR", () => {
  const started = { stateType: "started", state: "In Review" };
  assert.deepEqual(getTicketSkills({ skills, issue: { ...started, isMyPullRequest: true, prUrl: "https://github.com/o/r/pull/1" } }),
    ["gh44-clarify", "gh44-plan", "gh44-implement", "gh44-address-review"]);
  assert.deepEqual(getTicketSkills({ skills, issue: { ...started, isMyPullRequest: false, prUrl: "https://github.com/o/r/pull/1" } }),
    ["gh44-clarify", "gh44-plan", "gh44-implement", "gh44-code-review"]);
  assert.deepEqual(getTicketSkills({ skills, issue: { ...started, isMyPullRequest: false, prUrl: null } }),
    ["gh44-clarify", "gh44-plan", "gh44-implement"]);
});

test("a PR's menu lists every GitHub skill, and each skill's key starts it", () => {
  assert.deepEqual(getTabSkills({ skills, tab: "github" }), ["gh44-code-review", "gh44-address-review", "gh44-resolve-conflicts"]);
  assert.deepEqual(getKeySkills({ skills, tab: "github" }), { r: "gh44-code-review", a: "gh44-address-review", c: "gh44-resolve-conflicts" });
  assert.deepEqual(getKeySkills({ skills, tab: "linear" }), { c: "gh44-clarify", p: "gh44-plan", i: "gh44-implement", a: "gh44-address-review", r: "gh44-code-review" });
});

test("the footer lists each skill's key by its short name", () => {
  assert.equal(getKeyHints({ skills, tab: "github" }), "j/k move · ↵ run · r code-review · a address-review · c resolve-conflicts · o open · / search");
});

test("the Linear tab and the key hints show until turned off", () => {
  assert.equal(getSettings({ saved: undefined }).shouldShowLinear, true);
  assert.equal(getSettings({ saved: undefined }).shouldShowKeyHints, true);
  const saved = getSettings({ saved: { shouldShowLinear: false, shouldShowKeyHints: false } });
  assert.equal(saved.shouldShowLinear, false);
  assert.equal(saved.shouldShowKeyHints, false);
});

test("a changed default is what the row runs, also after it is saved and read back", () => {
  const next = setDefaultSkill({ skills, tab: "linear", situation: "notStarted", skill: "gh44-clarify" });
  assert.equal(getDefaultSkill({ skills: next, tab: "linear", situation: "notStarted" }), "gh44-clarify");
  const { skills: saved } = getSettings({ saved: JSON.parse(JSON.stringify({ skills: next })) });
  assert.equal(getDefaultSkill({ skills: saved, tab: "linear", situation: "notStarted" }), "gh44-clarify");
  assert.equal(getDefaultSkill({ skills: saved, tab: "github", situation: "myPullRequest" }), "gh44-address-review");
});

test("removing a skill takes it out of the menu, its key and every default it was", () => {
  const next = removeSkill({ skills, tab: "linear", skill: "gh44-code-review" });
  assert.equal(getTabSkills({ skills: next, tab: "linear" }).includes("gh44-code-review"), false);
  assert.equal(getKeySkills({ skills: next, tab: "linear" }).r, undefined);
  assert.equal(getDefaultSkill({ skills: next, tab: "linear", situation: "reviewOthers" }), null);
  assert.equal(getDefaultSkill({ skills: next, tab: "github", situation: "othersPullRequest" }), "gh44-code-review");
});

test("an added skill joins the menu once, without a key until one is set", () => {
  const next = addSkill({ skills, tab: "github", skill: " my-review " });
  assert.deepEqual(getTabSkills({ skills: next, tab: "github" }), ["gh44-code-review", "gh44-address-review", "gh44-resolve-conflicts", "my-review"]);
  assert.deepEqual(addSkill({ skills: next, tab: "github", skill: "my-review" }), next);
  assert.deepEqual(addSkill({ skills: next, tab: "github", skill: "  " }), next);
  const keyed = setSkillKey({ skills: next, tab: "github", skill: "my-review", key: "M" });
  assert.equal(getKeySkills({ skills: keyed, tab: "github" }).m, "my-review");
});

test("a key letter belongs to one skill per tab, and the panel's own keys stay free", () => {
  const moved = setSkillKey({ skills, tab: "github", skill: "gh44-address-review", key: "r" });
  assert.deepEqual(getKeySkills({ skills: moved, tab: "github" }), { r: "gh44-address-review", c: "gh44-resolve-conflicts" });
  assert.deepEqual(setSkillKey({ skills, tab: "github", skill: "gh44-address-review", key: "j" }), skills);
  const cleared = setSkillKey({ skills, tab: "github", skill: "gh44-address-review", key: null });
  assert.equal(getKeySkills({ skills: cleared, tab: "github" }).a, undefined);
});

test("a fresh install without skills offers none, so every row opens its PR or ticket", () => {
  const { skills: none } = getSettings({ saved: undefined, installedSkills: [] });
  for (const tab of ["github", "linear"]) {
    assert.deepEqual(getTabSkills({ skills: none, tab }), []);
    assert.deepEqual(getKeySkills({ skills: none, tab }), {});
    assert.equal(hasNoDefaults({ skills: none, tab }), true);
  }
  assert.equal(getDefaultSkill({ skills: none, tab: "linear", situation: "notStarted" }), null);
  assert.equal(getDefaultSkill({ skills: none, tab: "github", situation: "othersPullRequest" }), null);
});

test("a fresh install keeps the default skills that are installed and drops the rest", () => {
  const { skills: some } = getSettings({ saved: undefined, installedSkills: ["gh44-plan", "gh44-code-review", "other"] });
  assert.deepEqual(getTabSkills({ skills: some, tab: "linear" }), ["gh44-plan", "gh44-code-review"]);
  assert.equal(getDefaultSkill({ skills: some, tab: "linear", situation: "notStarted" }), "gh44-plan");
  assert.equal(getDefaultSkill({ skills: some, tab: "linear", situation: "inProgress" }), null);
  assert.equal(getDefaultSkill({ skills: some, tab: "linear", situation: "reviewOthers" }), "gh44-code-review");
  assert.equal(hasNoDefaults({ skills: some, tab: "github" }), false);
});

test("skills picked in the settings stay, installed or not, and the defaults stand until the installed list is known", () => {
  const picked = addSkill({ skills, tab: "github", skill: "team-review" });
  const { skills: saved } = getSettings({ saved: { skills: picked }, installedSkills: [] });
  assert.deepEqual(getTabSkills({ skills: saved, tab: "github" }), ["gh44-code-review", "gh44-address-review", "gh44-resolve-conflicts", "team-review"]);
  const { skills: unknown } = getSettings({ saved: undefined, installedSkills: null });
  assert.equal(getDefaultSkill({ skills: unknown, tab: "linear", situation: "inProgress" }), "gh44-implement");
});

test("a skill name is a word with letters, digits, _ : . or -, so it can't break the /prompt", () => {
  assert.equal(isValidSkillName("gh44-plan"), true);
  assert.equal(isValidSkillName("team:review.v2"), true);
  assert.equal(isValidSkillName("rm -rf"), false);
  assert.equal(isValidSkillName("a;b"), false);
  assert.deepEqual(addSkill({ skills, tab: "github", skill: "bad name" }), skills);
  const { skills: saved } = getSettings({ saved: { skills: { github: { list: [{ name: "ok-skill", key: null }, { name: "x; y", key: null }], defaults: {} } } } });
  assert.deepEqual(getTabSkills({ skills: saved, tab: "github" }), ["ok-skill"]);
});

test("address-review stays a my-PR-only review skill when the in-review default changes", () => {
  const others = { stateType: "started", state: "In Review", isMyPullRequest: false, prUrl: "https://github.com/o/r/pull/1" };
  const mine = { ...others, isMyPullRequest: true };
  for (const skill of [null, "gh44-implement"]) {
    const next = setDefaultSkill({ skills, tab: "linear", situation: "reviewMine", skill });
    assert.equal(getTicketSkills({ skills: next, issue: others }).includes("gh44-address-review"), false);
    assert.equal(getTicketSkills({ skills: next, issue: mine }).includes("gh44-address-review"), true);
    assert.equal(getSkillRole({ skills: next, skill: "gh44-address-review" }), "review");
  }
});

test("a skill saved as the someone-else's-PR default is offered only there, and gets the PR URL", () => {
  const added = addSkill({ skills, tab: "linear", skill: "team-review" });
  const next = setDefaultSkill({ skills: added, tab: "linear", situation: "reviewOthers", skill: "team-review" });
  const others = { stateType: "started", state: "In Review", isMyPullRequest: false, prUrl: "https://github.com/o/r/pull/1" };
  assert.equal(getTicketSkills({ skills: next, issue: others }).includes("team-review"), true);
  assert.equal(getTicketSkills({ skills: next, issue: { ...others, isMyPullRequest: true } }).includes("team-review"), false);
  assert.equal(getTicketSkills({ skills: next, issue: { ...others, prUrl: null } }).includes("team-review"), false);
  assert.equal(getTicketSkills({ skills: next, issue: others }).includes("gh44-code-review"), true);
  assert.equal(getSkillRole({ skills: next, skill: "team-review" }), "review");
});

test("a ticket's run asks where by default, or follows the saved choice; review skills and tickets without a branch never ask", () => {
  assert.equal(getSettings({ saved: undefined }).whereToRun, "ask");
  assert.equal(getSettings({ saved: { whereToRun: "worktree" } }).whereToRun, "worktree");
  assert.equal(getSettings({ saved: { whereToRun: "elsewhere" } }).whereToRun, "ask");
  assert.equal(getWhereToRun({ where: "ask", role: "work", hasWorktreeTarget: true }), "ask");
  assert.equal(getWhereToRun({ where: "worktree", role: "other", hasWorktreeTarget: true }), "worktree");
  assert.equal(getWhereToRun({ where: "here", role: "work", hasWorktreeTarget: true }), "here");
  assert.equal(getWhereToRun({ where: "ask", role: "review", hasWorktreeTarget: true }), "here");
  assert.equal(getWhereToRun({ where: "worktree", role: "review", hasWorktreeTarget: true }), "here");
  assert.equal(getWhereToRun({ where: "worktree", role: "work", hasWorktreeTarget: false }), "here");
  assert.equal(getWhereToRun({ where: "ask", role: "work", hasWorktreeTarget: false }), "here");
});

test("both tabs show by default, one always stays, and a hidden tab hands over to the other", () => {
  const both = getSettings({ saved: undefined });
  assert.equal(both.shouldShowGithub, true);
  const neither = getSettings({ saved: { shouldShowGithub: false, shouldShowLinear: false } });
  assert.equal(neither.shouldShowGithub || neither.shouldShowLinear, true);
  assert.equal(getShownTab({ saved: "linear", settings: both }), "linear");
  assert.equal(getShownTab({ saved: undefined, settings: both }), "github");
  assert.equal(getShownTab({ saved: "linear", settings: getSettings({ saved: { shouldShowLinear: false } }) }), "github");
  assert.equal(getShownTab({ saved: "github", settings: getSettings({ saved: { shouldShowGithub: false } }) }), "linear");
});

test("the suggested gh44 setup is today's full skill lists, keys and defaults for both tabs", () => {
  const setup = getGh44Setup();
  assert.deepEqual(getTabSkills({ skills: setup, tab: "github" }), ["gh44-code-review", "gh44-address-review", "gh44-resolve-conflicts"]);
  assert.deepEqual(getTabSkills({ skills: setup, tab: "linear" }), ["gh44-clarify", "gh44-plan", "gh44-implement", "gh44-address-review", "gh44-code-review"]);
  assert.equal(getKeySkills({ skills: setup, tab: "linear" }).p, "gh44-plan");
  assert.equal(getDefaultSkill({ skills: setup, tab: "github", situation: "myConflicts" }), "gh44-resolve-conflicts");
  setup.github.list.pop();
  assert.equal(getGh44Setup().github.list.length, 3);
});

test("the gh44 setup shows as in use once saved, and not after an edit or on a fresh install without the skills", () => {
  const { skills: saved } = getSettings({ saved: JSON.parse(JSON.stringify({ skills: getGh44Setup() })), installedSkills: [] });
  assert.equal(isUsingGh44Setup({ skills: saved }), true);
  assert.equal(isUsingGh44Setup({ skills: setSkillKey({ skills: saved, tab: "github", skill: "gh44-code-review", key: "x" }) }), false);
  assert.equal(isUsingGh44Setup({ skills: setDefaultSkill({ skills: saved, tab: "linear", situation: "inProgress", skill: null }) }), false);
  assert.equal(isUsingGh44Setup({ skills: getSettings({ saved: undefined, installedSkills: ["gh44-plan"] }).skills }), false);
});

test("the setup counts each of its 6 skills once against what is installed", () => {
  const skills = getGh44Setup();
  assert.deepEqual(countInstalledSkills({ skills, installedSkills: ["gh44-plan", "gh44-code-review", "other"] }), { installed: 2, total: 6 });
  assert.deepEqual(countInstalledSkills({ skills, installedSkills: [] }), { installed: 0, total: 6 });
});

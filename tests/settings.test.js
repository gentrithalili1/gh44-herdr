import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getSettings, getDefaultSkill, OPEN_ENTRY, getGithubSituation, getLinearSituation, getSkillRole, getTabSkills, getKeySkills,
  addSkill, removeSkill, moveCaseEntry, setSkillKey, setCaseHidden, getCaseActions, hasNoDefaults, isValidSkillName,
  getWhereToRun, getShownTab, getGh44Setup, getOncallSituation, isUsingGh44Setup, countInstalledSkills, getRunnableSkills, getAskPrompt, canRun, canRunEntry, ASK_ACTION,
  getTabOrder, moveTab, withStartCollapsed, shouldMoveIssue, getCaseRun, setCaseRun, resetCase, addCaseSkill, AFTER_DONE_NOTHING, getSkillCandidates,
  CHECKS_ENTRY, CONFLICTS_ENTRY, NUDGE_ENTRY, isLinkEntry, addCaseRule, removeCaseRule, setCaseRuleAction,
} from "../mods/hub/settings.js";
import { getTicketActions } from "../mods/hub/row-action.js";

const getTicketSkills = ({ skills: from, issue: i }) => getTicketActions({ skills: from, issue: { priority: 0, ...i } }).suggested;

// What dragging a skill (null: Open) to the top of a case and checking it does: it becomes the default.
const setDefaultSkill = ({ skills, tab, situation, skill }) => {
  const entry = skill ?? OPEN_ENTRY;
  const shown = entry === OPEN_ENTRY ? skills : setCaseHidden({ skills, tab, situation, skill: entry, isHidden: false });
  return moveCaseEntry({ skills: shown, tab, situation, entry, to: 0 });
};

const { skills } = getSettings({ saved: undefined });
const pr = ({ author, hasConflicts = false, ci = "passing", decision = null, isDraft = false }) => ({ author, hasConflicts, ci, decision, isDraft });
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

test("my PR's case is the first that fits: conflicts, failing checks, changes requested, approved, draft, then any", () => {
  const situation = (params) => getGithubSituation({ pr: pr({ author: "me", ...params }), login: "me" });
  assert.equal(situation({ hasConflicts: true, ci: "failing", decision: "CHANGES_REQUESTED", isDraft: true }), "myConflicts");
  assert.equal(situation({ ci: "failing", decision: "CHANGES_REQUESTED" }), "myChecksFailing");
  assert.equal(situation({ ci: "pending", decision: "CHANGES_REQUESTED", isDraft: true }), "myChangesRequested");
  assert.equal(situation({ decision: "APPROVED", isDraft: true }), "myApproved");
  assert.equal(situation({ decision: "REVIEW_REQUIRED", isDraft: true }), "myDraft");
  assert.equal(situation({ decision: "REVIEW_REQUIRED" }), "myPullRequest");
  assert.equal(getGithubSituation({ pr: pr({ author: "ana", hasConflicts: true, ci: "failing" }), login: "me" }), "othersPullRequest");
  assert.equal(getGithubSituation({ pr: pr({ author: "me", ci: "failing" }), login: null }), "othersPullRequest");
});

test("a ticket's case: backlog, todo, in progress with or without a PR, then in review by whose PR it is", () => {
  assert.equal(getLinearSituation(issue({ stateType: "backlog" })), "backlog");
  assert.equal(getLinearSituation(issue({ stateType: "triage" })), "backlog");
  assert.equal(getLinearSituation(issue({ stateType: "unstarted" })), "todo");
  assert.equal(getLinearSituation(issue({ stateType: "started", state: "In Progress" })), "inProgress");
  assert.equal(getLinearSituation(issue({ stateType: "started", state: "In Progress", prUrl: "https://github.com/o/r/pull/1" })), "inProgressWithPullRequest");
  assert.equal(getLinearSituation(issue({ stateType: "started", state: "In Review", isMyPullRequest: true })), "reviewMine");
  assert.equal(getLinearSituation(issue({ stateType: "started", state: "In Review", isMyPullRequest: false })), "reviewOthers");
});

test("each new PR case runs its gh44 skill by default", () => {
  const myDefault = (params) => githubDefault({ pr: pr({ author: "me", ...params }), login: "me" });
  assert.equal(myDefault({ ci: "failing" }), "gh44-address-review");
  assert.equal(myDefault({ decision: "CHANGES_REQUESTED" }), "gh44-address-review");
  assert.equal(myDefault({ decision: "APPROVED" }), "gh44-address-review");
  assert.equal(myDefault({ isDraft: true }), "gh44-address-review");
  assert.equal(linearDefault(issue({ stateType: "started", state: "In Progress", prUrl: "https://github.com/o/r/pull/1" })), "gh44-implement");
});

test("a save from before the new cases keeps its defaults on the cases that split from them", () => {
  const github = { list: [{ name: "a", key: null }, { name: "b", key: null }, { name: "c", key: null }], defaults: { othersPullRequest: "a", myPullRequest: "b", myConflicts: "c" } };
  const linear = { list: [{ name: "x", key: null }, { name: "y", key: null }, { name: "z", key: null }], defaults: { notStarted: "x", inProgress: "y", reviewOthers: "z" } };
  const { skills: saved } = getSettings({ saved: { skills: { github, linear } } });
  const defaults = (tab) => Object.fromEntries(Object.keys(saved[tab].cases).map((id) => [id, getDefaultSkill({ skills: saved, tab, situation: id })]));
  assert.deepEqual(defaults("github"), {
    myConflicts: "c", myChecksFailing: "b", myChangesRequested: "b", myApproved: "b", myDraft: "b", myPullRequest: "b", othersPullRequest: "a",
  });
  assert.deepEqual(defaults("linear"), { backlog: "x", todo: "x", inProgress: "y", inProgressWithPullRequest: "y", reviewMine: null, reviewOthers: "z" });
});

test("a skill picked for any not started or in progress case is a work skill", () => {
  for (const situation of ["backlog", "todo", "inProgress", "inProgressWithPullRequest"]) {
    const next = setDefaultSkill({ skills, tab: "linear", situation, skill: "gh44-clarify" });
    assert.equal(getSkillRole({ skills: next, skill: "gh44-clarify" }), "work");
  }
});

test("an action hidden in one case leaves that case's menu and keys, and stays in the other cases", () => {
  const next = setCaseHidden({ skills, tab: "github", situation: "myDraft", skill: "gh44-code-review", isHidden: true });
  const draftActions = getCaseActions({ skills: next, tab: "github", situation: "myDraft" });
  assert.deepEqual(draftActions, ["gh44-address-review", "gh44-resolve-conflicts", ASK_ACTION]);
  assert.equal(getKeySkills({ skills: next, tab: "github", actions: draftActions }).r, undefined);
  assert.equal(getKeySkills({ skills: next, tab: "github", actions: draftActions }).a, "gh44-address-review");
  assert.deepEqual(getCaseActions({ skills: next, tab: "github", situation: "myPullRequest" }), ["gh44-address-review", NUDGE_ENTRY, "gh44-code-review", "gh44-resolve-conflicts", ASK_ACTION]);
  const shown = setCaseHidden({ skills: next, tab: "github", situation: "myDraft", skill: "gh44-code-review", isHidden: false });
  assert.deepEqual(getCaseActions({ skills: shown, tab: "github", situation: "myDraft" }), ["gh44-address-review", "gh44-code-review", "gh44-resolve-conflicts", ASK_ACTION]);
});

test("hiding a case's default makes its next shown skill the default, and picking it again shows it", () => {
  const next = setCaseHidden({ skills, tab: "linear", situation: "todo", skill: "gh44-plan", isHidden: true });
  assert.equal(getDefaultSkill({ skills: next, tab: "linear", situation: "todo" }), "gh44-clarify");
  assert.equal(getDefaultSkill({ skills: next, tab: "linear", situation: "backlog" }), "gh44-plan");
  const picked = setDefaultSkill({ skills: next, tab: "linear", situation: "todo", skill: "gh44-plan" });
  assert.equal(getCaseActions({ skills: picked, tab: "linear", situation: "todo" }).includes("gh44-plan"), true);
});

test("a ticket's menu skips what its case hides, and the hidden list survives a save", () => {
  const next = setCaseHidden({ skills, tab: "linear", situation: "inProgress", skill: "gh44-clarify", isHidden: true });
  const { skills: saved } = getSettings({ saved: JSON.parse(JSON.stringify({ skills: next })) });
  const inProgress = { stateType: "started", state: "In Progress", isMyPullRequest: false, prUrl: null };
  assert.deepEqual(getTicketSkills({ skills: saved, issue: inProgress }), ["gh44-implement", "gh44-plan", ASK_ACTION]);
  assert.equal(getTicketSkills({ skills: saved, issue: { ...inProgress, stateType: "unstarted" } }).includes("gh44-clarify"), true);
});

test("Ask is in every case's actions by default, on key q", () => {
  for (const tab of ["github", "linear"]) {
    for (const situation of Object.keys(skills[tab].cases)) assert.equal(getCaseActions({ skills, tab, situation }).includes(ASK_ACTION), true);
    assert.equal(getKeySkills({ skills, tab, actions: getTabSkills({ skills, tab }) }).q, ASK_ACTION);
  }
});

test("Ask's prompt reads the ticket or PR and changes nothing", () => {
  assert.equal(getAskPrompt("THU-123"), "Read THU-123 and wait for my questions. Don't change any code.");
  assert.equal(getAskPrompt("https://github.com/o/r/pull/1"), "Read https://github.com/o/r/pull/1 and wait for my questions. Don't change any code.");
});

test("Ask never moves the ticket or asks where, even as a work or review default", () => {
  const asDefaults = setDefaultSkill({ skills: setDefaultSkill({ skills, tab: "linear", situation: "todo", skill: ASK_ACTION }), tab: "linear", situation: "reviewMine", skill: ASK_ACTION });
  assert.equal(getDefaultSkill({ skills: asDefaults, tab: "linear", situation: "todo" }), ASK_ACTION);
  assert.equal(getSkillRole({ skills: asDefaults, skill: ASK_ACTION }), "ask");
  assert.equal(getSkillRole({ skills, skill: ASK_ACTION }), "ask");
  assert.equal(getWhereToRun({ where: "ask", role: "ask", hasWorktreeTarget: true }), "here");
  assert.equal(getWhereToRun({ where: "worktree", role: "ask", hasWorktreeTarget: true }), "here");
});

test("Ask is built in: never removed, runnable without being installed, and can be hidden in a case", () => {
  assert.deepEqual(removeSkill({ skills, tab: "github", skill: ASK_ACTION }), skills);
  assert.equal(canRun({ skill: ASK_ACTION, installedSkills: [] }), true);
  assert.deepEqual(getTabSkills({ skills: getSettings({ saved: undefined, installedSkills: [] }).skills, tab: "linear" }), [ASK_ACTION]);
  const hidden = setCaseHidden({ skills, tab: "github", situation: "othersPullRequest", skill: ASK_ACTION, isHidden: true });
  assert.equal(getCaseActions({ skills: hidden, tab: "github", situation: "othersPullRequest" }).includes(ASK_ACTION), false);
});

test("a save from before Ask gets it at the end, on q unless another skill has q", () => {
  const github = { list: [{ name: "gh44-code-review", key: "r" }], defaults: {} };
  const linear = { list: [{ name: "gh44-plan", key: "q" }], defaults: {} };
  const { skills: saved } = getSettings({ saved: { skills: { github, linear } } });
  assert.deepEqual(saved.github.list, [{ name: "gh44-code-review", key: "r" }, { name: ASK_ACTION, key: "q" }]);
  assert.deepEqual(saved.linear.list, [{ name: "gh44-plan", key: "q" }, { name: ASK_ACTION, key: null }]);
  const oldSetup = JSON.parse(JSON.stringify(getGh44Setup()));
  for (const tab of ["github", "linear"]) oldSetup[tab].list = oldSetup[tab].list.filter((e) => e.name !== ASK_ACTION);
  assert.equal(isUsingGh44Setup({ skills: getSettings({ saved: { skills: oldSetup } }).skills }), true);
});

test("Ask as an in-review default stays Ask: other tickets keep it in their menu", () => {
  const next = setDefaultSkill({ skills, tab: "linear", situation: "reviewMine", skill: ASK_ACTION });
  assert.equal(getTicketSkills({ skills: next, issue: issue({ stateType: "unstarted", isMyPullRequest: false }) }).includes(ASK_ACTION), true);
  assert.equal(getSkillRole({ skills: next, skill: ASK_ACTION }), "ask");
});

test("a saved case whose default is also hidden keeps the default and shows it", () => {
  const list = [{ name: "gh44-plan", key: "p" }];
  const { skills: saved } = getSettings({ saved: { skills: { linear: { list, cases: { todo: { default: "gh44-plan", hidden: ["gh44-plan"] } } } } } });
  assert.equal(getDefaultSkill({ skills: saved, tab: "linear", situation: "todo" }), "gh44-plan");
  assert.equal(getCaseActions({ skills: saved, tab: "linear", situation: "todo" }).includes("gh44-plan"), true);
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
    ["gh44-address-review", "gh44-clarify", "gh44-plan", "gh44-implement", ASK_ACTION]);
  assert.deepEqual(getTicketSkills({ skills, issue: { ...started, isMyPullRequest: false, prUrl: "https://github.com/o/r/pull/1" } }),
    ["gh44-code-review", "gh44-clarify", "gh44-plan", "gh44-implement", ASK_ACTION]);
  assert.deepEqual(getTicketSkills({ skills, issue: { ...started, isMyPullRequest: false, prUrl: null } }),
    ["gh44-clarify", "gh44-plan", "gh44-implement", ASK_ACTION]);
});

test("a PR's menu lists every GitHub skill and link entry, and each one's key starts it", () => {
  assert.deepEqual(getTabSkills({ skills, tab: "github" }), ["gh44-code-review", "gh44-address-review", "gh44-resolve-conflicts", CHECKS_ENTRY, CONFLICTS_ENTRY, NUDGE_ENTRY, ASK_ACTION]);
  assert.deepEqual(getKeySkills({ skills, tab: "github", actions: getTabSkills({ skills, tab: "github" }) }), {
    r: "gh44-code-review", a: "gh44-address-review", c: "gh44-resolve-conflicts", f: CONFLICTS_ENTRY, n: NUDGE_ENTRY, q: ASK_ACTION,
  });
  assert.deepEqual(getKeySkills({ skills, tab: "linear", actions: getTabSkills({ skills, tab: "linear" }) }), { c: "gh44-clarify", p: "gh44-plan", i: "gh44-implement", a: "gh44-address-review", r: "gh44-code-review", q: ASK_ACTION });
});

test("the Linear tab shows until turned off", () => {
  assert.equal(getSettings({ saved: undefined }).shouldShowLinear, true);
  const saved = getSettings({ saved: { shouldShowLinear: false } });
  assert.equal(saved.shouldShowLinear, false);
});

test("a changed default is what the row runs, also after it is saved and read back", () => {
  const next = setDefaultSkill({ skills, tab: "linear", situation: "todo", skill: "gh44-clarify" });
  assert.equal(getDefaultSkill({ skills: next, tab: "linear", situation: "todo" }), "gh44-clarify");
  const { skills: saved } = getSettings({ saved: JSON.parse(JSON.stringify({ skills: next })) });
  assert.equal(getDefaultSkill({ skills: saved, tab: "linear", situation: "todo" }), "gh44-clarify");
  assert.equal(getDefaultSkill({ skills: saved, tab: "github", situation: "myPullRequest" }), "gh44-address-review");
});

test("a tab saved before cases, with one default per row, loads as the same defaults", () => {
  const list = [{ name: "gh44-plan", key: "p" }, { name: "gh44-clarify", key: "c" }];
  const { skills: saved } = getSettings({ saved: { skills: { linear: { list, defaults: { notStarted: "gh44-clarify", reviewMine: "gh44-plan" } } } } });
  assert.equal(getDefaultSkill({ skills: saved, tab: "linear", situation: "todo" }), "gh44-clarify");
  assert.equal(getDefaultSkill({ skills: saved, tab: "linear", situation: "reviewMine" }), "gh44-plan");
  assert.equal(getDefaultSkill({ skills: saved, tab: "linear", situation: "inProgress" }), null);
});

test("a tab saved with cases loads each case's default", () => {
  const list = [{ name: "gh44-plan", key: "p" }];
  const { skills: saved } = getSettings({ saved: { skills: { linear: { list, cases: { inProgress: { default: "gh44-plan", hidden: [] } } } } } });
  assert.equal(getDefaultSkill({ skills: saved, tab: "linear", situation: "inProgress" }), "gh44-plan");
  assert.equal(getDefaultSkill({ skills: saved, tab: "linear", situation: "todo" }), null);
});

test("removing a skill takes it out of the menu, its key and every default it was", () => {
  const next = removeSkill({ skills, tab: "linear", skill: "gh44-code-review" });
  assert.equal(getTabSkills({ skills: next, tab: "linear" }).includes("gh44-code-review"), false);
  assert.equal(getKeySkills({ skills: next, tab: "linear", actions: getTabSkills({ skills: next, tab: "linear" }) }).r, undefined);
  assert.equal(getDefaultSkill({ skills: next, tab: "linear", situation: "reviewOthers" }), null);
  assert.equal(getDefaultSkill({ skills: next, tab: "github", situation: "othersPullRequest" }), "gh44-code-review");
});

test("an added skill joins the menu once, without a key until one is set", () => {
  const next = addSkill({ skills, tab: "github", skill: " my-review " });
  assert.deepEqual(getTabSkills({ skills: next, tab: "github" }), ["gh44-code-review", "gh44-address-review", "gh44-resolve-conflicts", CHECKS_ENTRY, CONFLICTS_ENTRY, NUDGE_ENTRY, ASK_ACTION, "my-review"]);
  assert.deepEqual(addSkill({ skills: next, tab: "github", skill: "my-review" }), next);
  assert.deepEqual(addSkill({ skills: next, tab: "github", skill: "  " }), next);
  const keyed = setSkillKey({ skills: next, tab: "github", skill: "my-review", key: "M" });
  assert.equal(getKeySkills({ skills: keyed, tab: "github", actions: getTabSkills({ skills: keyed, tab: "github" }) }).m, "my-review");
});

test("a key letter belongs to one skill per tab, and the panel's own keys stay free", () => {
  const moved = setSkillKey({ skills, tab: "github", skill: "gh44-address-review", key: "r" });
  assert.deepEqual(getKeySkills({ skills: moved, tab: "github", actions: getTabSkills({ skills: moved, tab: "github" }) }), { r: "gh44-address-review", c: "gh44-resolve-conflicts", f: CONFLICTS_ENTRY, n: NUDGE_ENTRY, q: ASK_ACTION });
  assert.deepEqual(setSkillKey({ skills, tab: "github", skill: "gh44-address-review", key: "j" }), skills);
  const cleared = setSkillKey({ skills, tab: "github", skill: "gh44-address-review", key: null });
  assert.equal(getKeySkills({ skills: cleared, tab: "github", actions: getTabSkills({ skills: cleared, tab: "github" }) }).a, undefined);
});

test("a fresh install without skills offers only Ask (and GitHub's link entries), so every row opens its PR or ticket", () => {
  const { skills: none } = getSettings({ saved: undefined, installedSkills: [] });
  assert.deepEqual(getTabSkills({ skills: none, tab: "github" }), [CHECKS_ENTRY, CONFLICTS_ENTRY, NUDGE_ENTRY, ASK_ACTION]);
  assert.deepEqual(getTabSkills({ skills: none, tab: "linear" }), [ASK_ACTION]);
  for (const tab of ["github", "linear"]) assert.equal(hasNoDefaults({ skills: none, tab }), true);
  assert.equal(getDefaultSkill({ skills: none, tab: "linear", situation: "todo" }), null);
  assert.equal(getDefaultSkill({ skills: none, tab: "github", situation: "othersPullRequest" }), null);
});

test("a fresh install keeps the default skills that are installed and drops the rest", () => {
  const { skills: some } = getSettings({ saved: undefined, installedSkills: ["gh44-plan", "gh44-code-review", "other"] });
  assert.deepEqual(getTabSkills({ skills: some, tab: "linear" }), ["gh44-plan", "gh44-code-review", ASK_ACTION]);
  assert.equal(getDefaultSkill({ skills: some, tab: "linear", situation: "todo" }), "gh44-plan");
  assert.equal(getDefaultSkill({ skills: some, tab: "linear", situation: "inProgress" }), null);
  assert.equal(getDefaultSkill({ skills: some, tab: "linear", situation: "reviewOthers" }), "gh44-code-review");
  assert.equal(hasNoDefaults({ skills: some, tab: "github" }), false);
});

test("skills picked in the settings stay, installed or not, and the defaults stand until the installed list is known", () => {
  const picked = addSkill({ skills, tab: "github", skill: "team-review" });
  const { skills: saved } = getSettings({ saved: { skills: picked }, installedSkills: [] });
  assert.deepEqual(getTabSkills({ skills: saved, tab: "github" }), ["gh44-code-review", "gh44-address-review", "gh44-resolve-conflicts", CHECKS_ENTRY, CONFLICTS_ENTRY, NUDGE_ENTRY, ASK_ACTION, "team-review"]);
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
  assert.deepEqual(getTabSkills({ skills: saved, tab: "github" }), ["ok-skill", ASK_ACTION]);
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
  assert.deepEqual(getTabSkills({ skills: setup, tab: "github" }), ["gh44-code-review", "gh44-address-review", "gh44-resolve-conflicts", CHECKS_ENTRY, CONFLICTS_ENTRY, NUDGE_ENTRY, ASK_ACTION]);
  assert.deepEqual(getTabSkills({ skills: setup, tab: "linear" }), ["gh44-clarify", "gh44-plan", "gh44-implement", "gh44-address-review", "gh44-code-review", ASK_ACTION]);
  assert.equal(getKeySkills({ skills: setup, tab: "linear", actions: getTabSkills({ skills: setup, tab: "linear" }) }).p, "gh44-plan");
  assert.equal(getDefaultSkill({ skills: setup, tab: "github", situation: "myConflicts" }), "gh44-resolve-conflicts");
  setup.github.list.pop();
  assert.equal(getGh44Setup().github.list.length, 7);
});

test("the gh44 setup saved before link entries still shows as in use", () => {
  const oldSetup = JSON.parse(JSON.stringify(getGh44Setup()));
  const isOld = (name) => !isLinkEntry(name);
  oldSetup.github.list = oldSetup.github.list.filter((e) => isOld(e.name));
  for (const c of Object.values(oldSetup.github.cases)) {
    c.order = c.order.filter(isOld);
    c.hidden = c.hidden.filter(isOld);
  }
  assert.equal(isUsingGh44Setup({ skills: getSettings({ saved: { skills: oldSetup }, installedSkills: [] }).skills }), true);
});

test("the gh44 setup shows as in use once saved, and not after an edit or on a fresh install without the skills", () => {
  const { skills: saved } = getSettings({ saved: JSON.parse(JSON.stringify({ skills: getGh44Setup() })), installedSkills: [] });
  assert.equal(isUsingGh44Setup({ skills: saved }), true);
  assert.equal(isUsingGh44Setup({ skills: setSkillKey({ skills: saved, tab: "github", skill: "gh44-code-review", key: "x" }) }), false);
  assert.equal(isUsingGh44Setup({ skills: setDefaultSkill({ skills: saved, tab: "linear", situation: "inProgress", skill: null }) }), false);
  assert.equal(isUsingGh44Setup({ skills: getSettings({ saved: undefined, installedSkills: ["gh44-plan"] }).skills }), false);
});

test("the setup counts each of its 7 skills once (On-call adds gh44-debug) against what is installed", () => {
  const skills = getGh44Setup();
  assert.deepEqual(countInstalledSkills({ skills, installedSkills: ["gh44-plan", "gh44-code-review", "other"] }), { installed: 2, total: 7 });
  assert.deepEqual(countInstalledSkills({ skills, installedSkills: [] }), { installed: 0, total: 7 });
});

test("rows skip saved skills that are not installed, and keep plugin skills", () => {
  const saved = addSkill({ skills, tab: "linear", skill: "acme:plan" });
  const none = getRunnableSkills({ skills: saved, installedSkills: [] });
  assert.deepEqual(getTabSkills({ skills: none, tab: "linear" }), [ASK_ACTION, "acme:plan"]);
  assert.equal(getDefaultSkill({ skills: none, tab: "github", situation: "othersPullRequest" }), null);
  assert.equal(hasNoDefaults({ skills: none, tab: "linear" }), true);
  const some = getRunnableSkills({ skills: saved, installedSkills: ["gh44-plan"] });
  assert.equal(getDefaultSkill({ skills: some, tab: "linear", situation: "todo" }), "gh44-plan");
  assert.equal(getDefaultSkill({ skills: some, tab: "linear", situation: "inProgress" }), null);
  assert.deepEqual(getRunnableSkills({ skills: saved, installedSkills: null }), saved);
});

test("a repo skill is saved with its repo and offered only while that repo is focused", () => {
  const added = addSkill({ skills, tab: "linear", skill: "deploy-preview", repo: "acme/web" });
  assert.deepEqual(added.linear.list.at(-1), { name: "deploy-preview", key: null, repo: "acme/web" });
  const withDefault = setDefaultSkill({ skills: added, tab: "linear", situation: "inProgress", skill: "deploy-preview" });
  const { skills: saved } = getSettings({ saved: JSON.parse(JSON.stringify({ skills: withDefault })) });
  assert.equal(saved.linear.list.at(-1)?.repo, "acme/web");
  const inRepo = getRunnableSkills({ skills: saved, installedSkills: null, repo: { name: "acme/web", skills: ["deploy-preview"] } });
  assert.ok(getTabSkills({ skills: inRepo, tab: "linear" }).includes("deploy-preview"));
  assert.equal(getDefaultSkill({ skills: inRepo, tab: "linear", situation: "inProgress" }), "deploy-preview");
  const elsewhere = getRunnableSkills({ skills: saved, installedSkills: null, repo: { name: "acme/api", skills: ["deploy-preview"] } });
  assert.ok(!getTabSkills({ skills: elsewhere, tab: "linear" }).includes("deploy-preview"));
  assert.equal(getDefaultSkill({ skills: elsewhere, tab: "linear", situation: "inProgress" }), null);
  assert.ok(!getTabSkills({ skills: getRunnableSkills({ skills: saved, installedSkills: null }), tab: "linear" }).includes("deploy-preview"));
});

test("a repo skill needs its repo's .claude to still have it; an unlisted repo keeps it", () => {
  const entry = { name: "deploy-preview", key: null, repo: "acme/web" };
  assert.equal(canRunEntry({ entry, installedSkills: [], repo: { name: "acme/web", skills: [] } }), false);
  assert.equal(canRunEntry({ entry, installedSkills: [], repo: { name: "acme/web", skills: null } }), true);
  assert.equal(canRunEntry({ entry: { name: "gh44-plan", key: null }, installedSkills: ["gh44-plan"], repo: null }), true);
});

test("repo skills don't count toward the installed gh44 skills", () => {
  const added = addSkill({ skills: getGh44Setup(), tab: "github", skill: "deploy-preview", repo: "acme/web" });
  assert.deepEqual(countInstalledSkills({ skills: added, installedSkills: [] }), { installed: 0, total: 7 });
});

test("a case's order is its menu's, and its first shown entry is the default; Open first opens it", () => {
  const actions = (next) => getCaseActions({ skills: next, tab: "github", situation: "othersPullRequest" });
  const def = (next) => getDefaultSkill({ skills: next, tab: "github", situation: "othersPullRequest" });
  assert.equal(def(skills), "gh44-code-review");
  const moved = moveCaseEntry({ skills, tab: "github", situation: "othersPullRequest", entry: ASK_ACTION, to: 0 });
  assert.equal(def(moved), ASK_ACTION);
  assert.deepEqual(actions(moved), [ASK_ACTION, "gh44-code-review", "gh44-address-review", "gh44-resolve-conflicts"]);
  assert.equal(getDefaultSkill({ skills: moved, tab: "github", situation: "myDraft" }), "gh44-address-review");
  const opens = moveCaseEntry({ skills, tab: "github", situation: "othersPullRequest", entry: OPEN_ENTRY, to: 0 });
  assert.equal(def(opens), null);
  assert.equal(actions(opens).includes(OPEN_ENTRY), false);
  assert.equal(moveCaseEntry({ skills, tab: "github", situation: "othersPullRequest", entry: "gh44-code-review", to: 1 }), skills);
});

test("hiding a case's default makes its next shown entry the default, and the order survives a save", () => {
  const hidden = setCaseHidden({ skills, tab: "github", situation: "othersPullRequest", skill: "gh44-code-review", isHidden: true });
  assert.equal(getDefaultSkill({ skills: hidden, tab: "github", situation: "othersPullRequest" }), "gh44-address-review");
  const moved = moveCaseEntry({ skills: hidden, tab: "github", situation: "othersPullRequest", entry: ASK_ACTION, to: 0 });
  const { skills: saved } = getSettings({ saved: { skills: moved } });
  assert.deepEqual(saved.github.cases.othersPullRequest, moved.github.cases.othersPullRequest);
});

test("On-call rows: a case per need, Continue and Ask built in, and the report opens by default", () => {
  const { skills } = getSettings({ saved: undefined });
  assert.deepEqual(skills.oncall.list.map((e) => e.name), ["continue", "gh44-debug", "ask"]);
  assert.equal(getOncallSituation({ outcome: "reported", stage: "ai", severity: "critical", isNotified: true }), "critical");
  assert.equal(getOncallSituation({ outcome: "reported", stage: "ai", severity: "high", isNotified: true }), "high");
  assert.equal(getOncallSituation({ outcome: "reported", stage: "ai", severity: "medium", isNotified: false }), "needsYou");
  assert.equal(getOncallSituation({ outcome: "ignored", stage: "ai", severity: "low", isNotified: false }), "notForYou");
  assert.equal(getOncallSituation({ outcome: "ignored", stage: "domain", severity: null, isNotified: false }), "filtered");
  assert.equal(getOncallSituation({ outcome: "failed", stage: "failed", severity: null, isNotified: false }), "failed");
  assert.equal(getDefaultSkill({ skills, tab: "oncall", situation: "critical" }), null);
  assert.deepEqual(removeSkill({ skills, tab: "oncall", skill: "continue" }), skills);
});

test("a saved On-call list from before Continue gets it back", () => {
  const { skills } = getSettings({ saved: { skills: { oncall: { list: [{ name: "gh44-debug", key: "c" }] } } } });
  assert.deepEqual(skills.oncall.list, [{ name: "gh44-debug", key: "c" }, { name: "ask", key: "q" }, { name: "continue", key: null }]);
});

test("the header tab order keeps known tabs once, adds missing ones, and moves a dropped tab", () => {
  assert.deepEqual(getTabOrder(undefined), ["github", "linear", "oncall"]);
  assert.deepEqual(getTabOrder(["oncall", "nope", "github", "oncall"]), ["oncall", "github", "linear"]);
  const order = ["github", "linear", "oncall"];
  assert.deepEqual(moveTab({ order, tab: "oncall", to: 0 }), ["oncall", "github", "linear"]);
  assert.deepEqual(moveTab({ order, tab: "github", to: 3 }), ["linear", "oncall", "github"]);
  assert.deepEqual(moveTab({ order, tab: "linear", to: 1 }), order);
  assert.deepEqual(moveTab({ order, tab: "linear", to: 2 }), order);
});

test("clicking a row opens its details unless set to only select it", () => {
  assert.equal(getSettings({ saved: undefined }).rowClick, "details");
  assert.equal(getSettings({ saved: { rowClick: "select" } }).rowClick, "select");
  assert.equal(getSettings({ saved: { rowClick: "nonsense" } }).rowClick, "details");
});

test("an agent that needs you notifies, the ticket moves to In progress and no group starts collapsed until changed", () => {
  const fresh = getSettings({ saved: undefined });
  assert.equal(fresh.shouldNotifyBlocked, true);
  assert.equal(fresh.shouldMoveToInProgress, true);
  assert.deepEqual(fresh.startCollapsed, []);
  const saved = getSettings({ saved: { shouldNotifyBlocked: false, shouldMoveToInProgress: false, startCollapsed: ["pr-draft", 4, "ln-Done"] } });
  assert.equal(saved.shouldNotifyBlocked, false);
  assert.equal(saved.shouldMoveToInProgress, false);
  assert.deepEqual(saved.startCollapsed, ["pr-draft", "ln-Done"]);
  assert.deepEqual(getSettings({ saved: { startCollapsed: "pr-draft" } }).startCollapsed, []);
});

test("groups set to start collapsed join the ones already collapsed, once each", () => {
  assert.deepEqual(withStartCollapsed({ collapsed: ["pr-fix", "ln-Todo"], startCollapsed: ["ln-Todo", "pr-draft"] }), ["pr-fix", "ln-Todo", "pr-draft"]);
  assert.deepEqual(withStartCollapsed({ collapsed: undefined, startCollapsed: ["pr-draft"] }), ["pr-draft"]);
});

test("starting work on a not started ticket moves it only while the setting is on", () => {
  const todo = { stateType: "unstarted", state: "Todo" };
  assert.equal(shouldMoveIssue({ isOn: true, role: "work", issue: todo }), true);
  assert.equal(shouldMoveIssue({ isOn: false, role: "work", issue: todo }), false);
  assert.equal(shouldMoveIssue({ isOn: true, role: "review", issue: todo }), false);
  assert.equal(shouldMoveIssue({ isOn: true, role: "work", issue: { stateType: "started", state: "In Progress" } }), false);
  assert.equal(shouldMoveIssue({ isOn: true, role: "work", issue: null }), false);
});

test("a case runs where Where runs go says and suggests its main action after done, until set per case", () => {
  assert.deepEqual(getCaseRun({ skills, tab: "linear", situation: "todo" }), { where: "default", afterDone: null });
  const set = setCaseRun({ skills, tab: "linear", situation: "todo", run: { where: "background", afterDone: "gh44-implement" } });
  assert.deepEqual(getCaseRun({ skills: set, tab: "linear", situation: "todo" }), { where: "background", afterDone: "gh44-implement" });
  assert.deepEqual(getCaseRun({ skills: set, tab: "linear", situation: "backlog" }), { where: "default", afterDone: null });
  const { skills: saved } = getSettings({ saved: JSON.parse(JSON.stringify({ skills: set })) });
  assert.deepEqual(getCaseRun({ skills: saved, tab: "linear", situation: "todo" }), { where: "background", afterDone: "gh44-implement" });
  const nothing = setCaseRun({ skills, tab: "github", situation: "myApproved", run: { where: "default", afterDone: AFTER_DONE_NOTHING } });
  assert.equal(getCaseRun({ skills: nothing, tab: "github", situation: "myApproved" }).afterDone, AFTER_DONE_NOTHING);
});

test("a saved case run that is unknown, or names a skill gone from the tab, reads as the default", () => {
  const list = [{ name: "gh44-plan", key: "p" }];
  const { skills: saved } = getSettings({ saved: { skills: { linear: { list, cases: { todo: { order: ["gh44-plan"], hidden: [], where: "moon", afterDone: "gh44-gone" } } } } } });
  assert.deepEqual(getCaseRun({ skills: saved, tab: "linear", situation: "todo" }), { where: "default", afterDone: null });
  const removed = removeSkill({ skills: setCaseRun({ skills, tab: "linear", situation: "todo", run: { where: "here", afterDone: "gh44-clarify" } }), tab: "linear", skill: "gh44-clarify" });
  assert.deepEqual(getCaseRun({ skills: removed, tab: "linear", situation: "todo" }), { where: "here", afterDone: null });
});

test("a changed case run leaves the gh44 setup", () => {
  const setup = getGh44Setup();
  assert.equal(isUsingGh44Setup({ skills: setup }), true);
  assert.equal(isUsingGh44Setup({ skills: setCaseRun({ skills: setup, tab: "github", situation: "myDraft", run: { where: "here", afterDone: null } }) }), false);
});

test("resetting a case puts back its built-in order, shows everything and drops its run, other cases untouched", () => {
  const changed = setCaseRun({
    skills: moveCaseEntry({ skills: setCaseHidden({ skills, tab: "linear", situation: "todo", skill: "gh44-plan", isHidden: true }), tab: "linear", situation: "todo", entry: ASK_ACTION, to: 0 }),
    tab: "linear", situation: "todo", run: { where: "here", afterDone: "gh44-clarify" },
  });
  const other = setCaseHidden({ skills: changed, tab: "linear", situation: "backlog", skill: "gh44-plan", isHidden: true });
  const reset = resetCase({ skills: other, tab: "linear", situation: "todo" });
  assert.deepEqual(reset.linear.cases.todo, skills.linear.cases.todo);
  assert.deepEqual(reset.linear.cases.backlog, other.linear.cases.backlog);
});

test("an action added to one case joins the tab and shows only in that case", () => {
  const added = addCaseSkill({ skills, tab: "linear", situation: "todo", skill: "gh44-debug", repo: null });
  assert.equal(getCaseActions({ skills: added, tab: "linear", situation: "todo" }).includes("gh44-debug"), true);
  assert.equal(getCaseActions({ skills: added, tab: "linear", situation: "backlog" }).includes("gh44-debug"), false);
  assert.equal(getTabSkills({ skills: added, tab: "linear" }).includes("gh44-debug"), true);
  const again = addCaseSkill({ skills: setCaseHidden({ skills, tab: "linear", situation: "todo", skill: "gh44-clarify", isHidden: true }), tab: "linear", situation: "todo", skill: "gh44-clarify", repo: null });
  assert.equal(getCaseActions({ skills: again, tab: "linear", situation: "todo" }).includes("gh44-clarify"), true);
  assert.equal(getCaseActions({ skills: again, tab: "linear", situation: "backlog" }).includes("gh44-clarify"), true);
});

test("skills to add: the focused repo's own first, then the installed ones, without those the tab has, matching the typed text", () => {
  const repo = { name: "acme/web", skills: ["deploy-preview", "gh44-plan"] };
  const candidates = getSkillCandidates({ names: ["gh44-code-review"], installedSkills: ["gh44-code-review", "gh44-plan", "gh44-debug"], repo, typed: "" });
  assert.deepEqual(candidates, [{ name: "deploy-preview", repo: "acme/web" }, { name: "gh44-plan", repo: "acme/web" }, { name: "gh44-debug", repo: null }]);
  assert.deepEqual(getSkillCandidates({ names: [], installedSkills: null, repo: { name: null, skills: null }, typed: "DEP" }), []);
  assert.deepEqual(getSkillCandidates({ names: [], installedSkills: ["gh44-debug"], repo, typed: "DEB" }), [{ name: "gh44-debug", repo: null }]);
});

// ---------- link entries ----------

const githubActions = (situation, from = skills) => getCaseActions({ skills: from, tab: "github", situation });

test("GitHub's actions hold its link entries: checks, conflicting files with its key, nudge with its key; Linear's none", () => {
  assert.deepEqual(skills.github.list.slice(3, 6), [{ name: CHECKS_ENTRY, key: null }, { name: CONFLICTS_ENTRY, key: "f" }, { name: NUDGE_ENTRY, key: "n" }]);
  assert.equal(skills.linear.list.some((e) => isLinkEntry(e.name)), false);
});

test("by default a link entry is offered right after the skill of its case, and hidden in the others", () => {
  assert.deepEqual(githubActions("myChecksFailing").slice(0, 2), ["gh44-address-review", CHECKS_ENTRY]);
  assert.deepEqual(githubActions("myConflicts").slice(0, 2), ["gh44-resolve-conflicts", CONFLICTS_ENTRY]);
  assert.deepEqual(githubActions("myPullRequest").slice(0, 2), ["gh44-address-review", NUDGE_ENTRY]);
  assert.equal(githubDefault({ pr: pr({ author: "me" }), login: "me" }), "gh44-address-review");
  assert.deepEqual(githubActions("myChecksFailing").filter(isLinkEntry), [CHECKS_ENTRY]);
  assert.deepEqual(githubActions("othersPullRequest").filter(isLinkEntry), []);
});

test("a GitHub list saved before link entries reads as it was; one added later joins hidden in every case", () => {
  const old = { skills: { github: { list: [{ name: "gh44-code-review", key: "r" }], cases: {} } } };
  const read = getSettings({ saved: old }).skills;
  assert.deepEqual(read.github.list.map((e) => e.name), ["gh44-code-review", "ask"]);
  const added = addSkill({ skills: read, tab: "github", skill: CHECKS_ENTRY });
  assert.deepEqual(added.github.list.map((e) => e.name), ["gh44-code-review", "ask", CHECKS_ENTRY]);
  assert.deepEqual(githubActions("myChecksFailing", added).filter(isLinkEntry), []);
  assert.deepEqual(getSettings({ saved: { skills: added } }).skills.github.list.map((e) => e.name), ["gh44-code-review", "ask", CHECKS_ENTRY]);
});

test("only GitHub takes link entries, and they always run and never count as skills to install", () => {
  assert.equal(addSkill({ skills, tab: "linear", skill: CHECKS_ENTRY }), skills);
  assert.equal(canRun({ skill: NUDGE_ENTRY, installedSkills: [] }), true);
  assert.equal(countInstalledSkills({ skills, installedSkills: [] }).total, countInstalledSkills({ skills: { ...skills, github: { ...skills.github, list: skills.github.list.filter((e) => !isLinkEntry(e.name)) } }, installedSkills: [] }).total);
});

// ---------- case rules ----------

const lintRule = { when: { kind: "check", value: "lint" }, then: "gh44-code-review" };
const withRule = (rule = lintRule, from = skills, tab = "github", situation = "myChecksFailing") => addCaseRule({ skills: from, tab, situation, ...rule });
const rulesOf = (from, tab = "github", situation = "myChecksFailing") => from[tab].cases[situation].rules;

test("a case starts without rules; an added rule keeps its order and survives a save", () => {
  assert.deepEqual(rulesOf(skills), []);
  const two = withRule({ when: { kind: "size", value: "500" }, then: CHECKS_ENTRY }, withRule());
  assert.deepEqual(rulesOf(two).map((r) => [r.when.kind, r.when.value, r.then]), [["check", "lint", "gh44-code-review"], ["size", "500", CHECKS_ENTRY]]);
  assert.notEqual(rulesOf(two)[0].id, rulesOf(two)[1].id);
  assert.deepEqual(rulesOf(getSettings({ saved: JSON.parse(JSON.stringify({ skills: two })) }).skills), rulesOf(two));
});

test("a rule needs a value (a size a number above 0), a kind its tab has and an action of the tab", () => {
  assert.equal(withRule({ ...lintRule, when: { kind: "check", value: "  " } }), skills);
  assert.equal(withRule({ ...lintRule, when: { kind: "size", value: "lots" } }), skills);
  assert.equal(withRule({ ...lintRule, then: "not-a-skill" }), skills);
  assert.equal(withRule({ ...lintRule, then: OPEN_ENTRY }), skills);
  assert.equal(withRule(lintRule, skills, "linear", "todo"), skills);
  assert.deepEqual(rulesOf(withRule({ when: { kind: "priority", value: "1" }, then: "gh44-implement" }, skills, "linear", "todo"), "linear", "todo").map((r) => r.when.kind), ["priority"]);
  assert.equal(withRule({ when: { kind: "label", value: "bug" }, then: "gh44-debug" }, skills, "oncall", "critical"), skills);
});

test("a rule's action can change and the rule can go; resetting the case drops its rules", () => {
  const one = withRule();
  const id = rulesOf(one)[0].id;
  assert.equal(rulesOf(setCaseRuleAction({ skills: one, tab: "github", situation: "myChecksFailing", id, then: "ask" }))[0].then, "ask");
  assert.deepEqual(rulesOf(removeCaseRule({ skills: one, tab: "github", situation: "myChecksFailing", id })), []);
  assert.deepEqual(rulesOf(resetCase({ skills: one, tab: "github", situation: "myChecksFailing" })), []);
});

test("a new rule never reuses the id of a removed one", () => {
  const two = withRule({ when: { kind: "label", value: "bug" }, then: "ask" }, withRule());
  const removedId = rulesOf(two)[1].id;
  const removed = removeCaseRule({ skills: two, tab: "github", situation: "myChecksFailing", id: removedId });
  const ids = rulesOf(withRule({ when: { kind: "label", value: "ui" }, then: "ask" }, removed)).map((r) => r.id);
  assert.equal(ids.includes(removedId), false);
  assert.equal(new Set(ids).size, 2);
});

test("saved rules read safely: broken ones and ones whose action left the tab are dropped", () => {
  const saved = JSON.parse(JSON.stringify(withRule()));
  saved.github.cases.myChecksFailing.rules.push({ id: "x", when: { kind: "weather", value: "rain" }, then: "ask" }, { id: "y", when: null, then: "ask" }, "junk");
  assert.deepEqual(rulesOf(getSettings({ saved: { skills: saved } }).skills).map((r) => r.when.value), ["lint"]);
  const removed = removeSkill({ skills: withRule(), tab: "github", skill: "gh44-code-review" });
  assert.deepEqual(rulesOf(removed), []);
  assert.equal(isUsingGh44Setup({ skills: withRule() }), false);
});

test("a link entry added to one case from its editor shows only in that case", () => {
  const old = getSettings({ saved: { skills: { github: { list: [{ name: "gh44-code-review", key: "r" }], cases: {} } } } }).skills;
  const added = addCaseSkill({ skills: old, tab: "github", situation: "myChecksFailing", skill: CHECKS_ENTRY });
  assert.equal(githubActions("myChecksFailing", added).includes(CHECKS_ENTRY), true);
  assert.equal(githubActions("myConflicts", added).includes(CHECKS_ENTRY), false);
});

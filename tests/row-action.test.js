import { test } from "node:test";
import assert from "node:assert/strict";
import { getRowAction, getRowMenu, getPullRequestFacts, getFactParts, getFactSegments, formatClock, getRowDetails, getCaseRunPlace, getNewlyBlocked, getOncallRowAction, getOncallRowMenu, getDecisionFacts, getPullRequestLinks, getRowActions, matchCaseRule, getRuleReason, getPullRequestRuleFacts, getIssueRuleFacts } from "../mods/hub/row-action.js";
import { getSettings, moveCaseEntry, addCaseRule, isLinkEntry, AFTER_DONE_NOTHING, OPEN_ENTRY, CHECKS_ENTRY, CONFLICTS_ENTRY, NUDGE_ENTRY } from "../mods/hub/settings.js";

const githubLink = { label: "Open in GitHub", icon: "github" };
const linearLink = { label: "Open in Linear", icon: "linear" };
const facts = (params) => ({
  isPreparing: false, agent: null, spaceName: null, isMergeReady: false, skill: null,
  link: githubLink, place: "here", isBackground: false, target: { label: "#15" }, ...params,
});
const action = (params) => getRowAction(facts(params));

test("a row with a skill runs it, named without the gh44 prefix", () => {
  const main = action({ skill: "gh44-code-review", isBackground: true });
  assert.equal(main.kind, "skill");
  assert.equal(main.label, "code-review");
  assert.equal(main.icon, "play");
  assert.equal(main.tip, "/gh44-code-review in a background tab");
});

test("a ticket's skill in a worktree shows the branch icon and says which worktree", () => {
  const fresh = action({ skill: "gh44-implement", place: "worktree", link: linearLink, target: { label: "THU-1" } });
  assert.equal(fresh.icon, "branch");
  assert.equal(fresh.tip, "/gh44-implement in a new worktree");
  const existing = action({ skill: "gh44-implement", place: "worktree", target: { label: "THU-1", worktree: "/repo/.worktrees/thu-1-x" } });
  assert.equal(existing.tip, "/gh44-implement in this ticket's worktree (thu-1-x)");
  assert.equal(action({ skill: "gh44-plan", place: "ask" }).tip, "/gh44-plan: asks first, new worktree or this space");
  assert.equal(action({ skill: "gh44-plan" }).tip, "/gh44-plan in a new tab here");
});

test("a row without a skill opens its PR or ticket", () => {
  const main = action({ link: linearLink });
  assert.equal(main.kind, "link");
  assert.equal(main.label, "open");
  assert.equal(main.icon, "linear");
});

test("a space on the row's branch is resumed before a skill runs", () => {
  const main = action({ skill: "gh44-implement", spaceName: "thu-1" });
  assert.equal(main.kind, "resume");
  assert.equal(main.label, "resume");
  assert.equal(main.tip, "Go to thu-1");
});

test("a PR ready to merge opens GitHub to merge, before a space or a skill", () => {
  const main = action({ isMergeReady: true, skill: "gh44-address-review", spaceName: "pr-14" });
  assert.equal(main.kind, "merge");
  assert.equal(main.label, "merge");
  assert.equal(main.icon, "github");
});

test("an agent on the row comes before merging", () => {
  const main = action({ isMergeReady: true, skill: "gh44-address-review", agent: { status: "working", tabName: "#15 address-review", since: null } });
  assert.equal(main.kind, "agent");
});

test("a worktree being prepared shows that first, loading", () => {
  const main = action({ isPreparing: true, isMergeReady: true, agent: { status: "working", tabName: "#15 plan", since: null }, target: { label: "THU-1" } });
  assert.equal(main.kind, "preparing");
  assert.equal(main.label, "preparing");
  assert.equal(main.isLoading, true);
  assert.equal(main.tip, "Preparing the THU-1 worktree");
});

test("filled for a skill to run or a merge, outlined for a link, a space, an agent or a preparing worktree", () => {
  assert.equal(action({ skill: "gh44-code-review" }).style, "suggested");
  assert.equal(action({ isMergeReady: true }).style, "suggested");
  assert.equal(action({}).style, "quiet");
  assert.equal(action({ skill: "gh44-plan", spaceName: "thu-1" }).style, "quiet");
  assert.equal(action({ isPreparing: true }).style, "quiet");
  assert.equal(action({ agent: { status: "idle", tabName: "#15 plan", since: null } }).style, "quiet");
});

const list = [
  { name: "gh44-code-review", key: "r" },
  { name: "gh44-address-review", key: "a" },
  { name: "gh44-resolve-conflicts", key: "c" },
  { name: "ask", key: "q" },
];
const menu = (params) => getRowMenu({
  suggested: ["gh44-resolve-conflicts", "gh44-address-review"], list, links: [githubLink], hasAgent: false, reviewSkills: { mine: [], others: [] }, pullRequest: "mine", ...params,
});
const titles = (sections) => sections.map((s) => s.title);

test("a row's menu: suggested for its case, other skills, links, then Details and Edit this case", () => {
  const sections = menu({});
  assert.deepEqual(titles(sections), ["Suggested for this case", "Other skills", null, null]);
  assert.deepEqual(sections[0].items.map((i) => i.skill), ["gh44-resolve-conflicts", "gh44-address-review"]);
  assert.deepEqual(sections[1].items.map((i) => i.skill), ["gh44-code-review", "ask"]);
  assert.deepEqual(sections[2].items.map((i) => i.kind), ["link"]);
  assert.deepEqual(sections[3].items, [{ kind: "details" }, { kind: "editCase" }]);
});

test("keys show only on the suggested skills, the ones a key starts on this row", () => {
  const [suggested, other] = menu({});
  assert.deepEqual(suggested.items.map((i) => i.key), ["c", "a"]);
  assert.deepEqual(other.items.map((i) => i.key), [null, null]);
});

test("a row with an agent also links to its tab", () => {
  assert.deepEqual(menu({ hasAgent: true })[2].items.map((i) => i.kind), ["link", "agent"]);
});

test("an empty section leaves the menu", () => {
  assert.deepEqual(titles(menu({ suggested: list.map((s) => s.name) })), ["Suggested for this case", null, null]);
  assert.deepEqual(titles(menu({ suggested: [] })), ["Other skills", null, null]);
});

const NOW = Date.parse("2026-11-25T12:00:00Z");
const MINUTE = 60_000;
const agentOn = ({ status, since = null }) => action({ skill: "gh44-address-review", now: NOW, agent: { status, tabName: "#15 address-review", since } });

test("a working agent: the button says working, with how long, and goes to its tab", () => {
  const main = agentOn({ status: "working", since: NOW - 12 * MINUTE });
  assert.deepEqual(main.status, { tone: "working", text: "working", elapsed: "12m" });
  assert.equal(main.kind, "agent");
  assert.equal(main.label, "working");
  assert.equal(main.style, "quiet");
});

test("an agent that needs you: red status and an alert button to answer it", () => {
  const main = agentOn({ status: "blocked", since: NOW - 2 * 60 * MINUTE });
  assert.deepEqual(main.status, { tone: "blocked", text: "needs you", elapsed: "2h" });
  assert.equal(main.kind, "agent");
  assert.equal(main.label, "answer");
  assert.equal(main.style, "alert");
});

test("an idle agent: a quiet status and a quiet button to its tab", () => {
  const main = agentOn({ status: "idle" });
  assert.deepEqual(main.status, { tone: "idle", text: "idle", elapsed: null });
  assert.equal(main.label, "open tab");
  assert.equal(main.style, "quiet");
});

test("a done agent: done, and the button is the case's main action again", () => {
  const main = agentOn({ status: "done", since: NOW - MINUTE });
  assert.deepEqual(main.status, { tone: "done", text: "done", elapsed: null });
  assert.equal(main.kind, "skill");
  assert.equal(main.label, "address-review");
  assert.equal(main.style, "suggested");
  assert.equal(action({ isMergeReady: true, agent: { status: "done", tabName: "#14 plan", since: null } }).kind, "merge");
});

test("no start time from Herdr: no elapsed time", () => {
  assert.equal(agentOn({ status: "working" }).status.elapsed, null);
  assert.equal(action({ skill: "gh44-plan" }).status, null);
});

test("Herdr times in seconds still show a sane elapsed time", () => {
  assert.equal(agentOn({ status: "working", since: (NOW - 12 * MINUTE) / 1000 }).status.elapsed, "12m");
});

const pullRequest = (params) => ({ author: "ana", hasConflicts: false, ci: "passing", decision: null, isDraft: false, createdAt: null, additions: 44, deletions: 6, ...params });
const prFacts = (params) => getPullRequestFacts({ login: "me", ...params });

test("a PR to fix says why: conflicts, failing checks, changes requested", () => {
  const pr = pullRequest({ author: "me", hasConflicts: true, ci: "failing", decision: "CHANGES_REQUESTED" });
  assert.deepEqual(prFacts({ pr, groupId: "fix" }), ["conflicts", "checks failing", "changes requested", "+44 −6"]);
});

test("CI shows once: as the reason, or once as a bit after it", () => {
  assert.deepEqual(prFacts({ pr: pullRequest({ author: "me", ci: "pending" }), groupId: "waiting" }), ["checks running", "+44 −6"]);
  assert.deepEqual(prFacts({ pr: pullRequest({ ci: "failing" }), groupId: "review" }), ["ana", "checks failing", "+44 −6"]);
  assert.deepEqual(prFacts({ pr: pullRequest({ ci: "passing" }), groupId: "review" }), ["ana", "+44 −6"]);
});

test("each group's reason: approved, asked again, you reviewed, waiting, and a draft's author when not mine", () => {
  assert.deepEqual(prFacts({ pr: pullRequest({ author: "me", decision: "APPROVED" }), groupId: "merge" }), ["approved", "+44 −6"]);
  assert.deepEqual(prFacts({ pr: pullRequest({}), groupId: "rereview" }), ["ana", "asked again", "+44 −6"]);
  assert.deepEqual(prFacts({ pr: pullRequest({}), groupId: "reviewed" }), ["ana", "you reviewed", "+44 −6"]);
  assert.deepEqual(prFacts({ pr: pullRequest({ author: "me" }), groupId: "waiting" }), ["waiting for review", "+44 −6"]);
  assert.deepEqual(prFacts({ pr: pullRequest({ isDraft: true }), groupId: "draft" }), ["ana", "+44 −6"]);
  assert.deepEqual(prFacts({ pr: pullRequest({ author: "me", isDraft: true }), groupId: "draft" }), ["+44 −6"]);
});

test("a PR's age follows its reason, in hours or days", () => {
  const pr = pullRequest({ createdAt: new Date(NOW - 2 * 60 * MINUTE).toISOString() });
  assert.deepEqual(prFacts({ pr, groupId: "review", now: NOW }), ["ana", "2h", "+44 −6"]);
});

const reviewSkills = { mine: ["gh44-address-review"], others: ["gh44-code-review"] };
const otherSkills = (params) => menu({ suggested: ["gh44-resolve-conflicts"], reviewSkills, ...params }).find((s) => s.id === "other").items.map((i) => i.skill);

test("Other skills leave out review skills that can't apply: my-PR ones on someone else's PR, others' ones on mine", () => {
  assert.deepEqual(otherSkills({ pullRequest: "others" }), ["gh44-code-review", "ask"]);
  assert.deepEqual(otherSkills({ pullRequest: "mine" }), ["gh44-address-review", "ask"]);
  assert.deepEqual(otherSkills({ pullRequest: "none" }), ["ask"]);
});

test("Other skills keep a skill the case hides when it can apply", () => {
  assert.deepEqual(otherSkills({ pullRequest: "mine", reviewSkills: { mine: [], others: [] } }), ["gh44-code-review", "gh44-address-review", "ask"]);
});

const { skills: defaultSkills } = getSettings({ saved: undefined });
const reviewPr = (params) => ({ ...pullRequest(params), branch: "install-no-sudo", requestedUsers: [], requestedTeams: [], reviewers: [], isDraft: false, ...params });
const suggestedMenu = (items) => [{ id: "suggested", title: "Suggested for this case", items: items.map(([skill, key]) => ({ kind: "skill", skill, key })) }];
const details = (params) => getRowDetails({ skills: defaultSkills, menu: suggestedMenu([]), agent: null, worktree: null, repoMain: null, main: null, now: NOW, ...params });
const prRow = (params) => ({ kind: "pullRequest", login: "me", groupId: "fix", pr: reviewPr(params) });

test("details: the case's suggestions in order, the button's one marked main, each with its key and a reason from the row's facts", () => {
  const menu = suggestedMenu([["gh44-resolve-conflicts", "c"], ["gh44-address-review", "a"], ["ask", "q"]]);
  const d = details({ row: prRow({ author: "me", hasConflicts: true, decision: "CHANGES_REQUESTED" }), menu, main: "gh44-resolve-conflicts" });
  assert.deepEqual(d.suggested, [
    { skill: "gh44-resolve-conflicts", key: "c", reason: "conflicts", isMain: true },
    { skill: "gh44-address-review", key: "a", reason: "changes requested", isMain: false },
    { skill: "ask", key: "q", reason: "reads it, changes no code", isMain: false },
  ]);
});

test("details: only the suggestion the button runs is marked main", () => {
  const menu = suggestedMenu([["gh44-resolve-conflicts", "c"], ["gh44-address-review", "a"]]);
  const row = prRow({ author: "me", hasConflicts: true });
  const isMain = (main) => details({ row, menu, main }).suggested.map((s) => s.isMain);
  assert.deepEqual(isMain("gh44-resolve-conflicts"), [true, false]);
  assert.deepEqual(isMain("gh44-address-review"), [false, true]);
  assert.deepEqual(isMain(null), [false, false]);
});

test("details: a review on someone else's PR says why it is asked of you", () => {
  const menu = suggestedMenu([["gh44-code-review", "r"]]);
  const reason = (params, groupId = "review") => details({ row: { ...prRow(params), groupId }, menu }).suggested[0].reason;
  assert.equal(reason({ requestedUsers: ["me"] }), "review requested");
  assert.equal(reason({ requestedTeams: [{ value: "o/fe", label: "FE" }] }), "team review requested");
  assert.equal(reason({ requestedUsers: ["me"] }, "rereview"), "asked to review again");
  assert.equal(reason({}), "someone else's PR");
});

test("details: a skill no fact points to has no reason", () => {
  const menu = suggestedMenu([["gh44-code-review", "r"]]);
  assert.equal(details({ row: prRow({ author: "me" }), menu }).suggested[0].reason, null);
});

test("details: a PR's status is its merge state, checks, review decision, size and branch", () => {
  const d = details({ row: prRow({ author: "me", hasConflicts: true, ci: "failing", decision: "CHANGES_REQUESTED" }) });
  assert.equal(d.owner, "my PR");
  assert.deepEqual(d.status.map((r) => [r.label, r.value, r.tone]), [
    ["Merge", "conflicts", "danger"],
    ["Checks", "failing", "danger"],
    ["Review", "changes requested", "danger"],
    ["Size", "+44 −6", null],
    ["Branch", "install-no-sudo", null],
  ]);
  assert.equal(d.status.find((r) => r.label === "Branch").isMono, true);
  assert.deepEqual(d.status.find((r) => r.label === "Size").parts, [{ text: "+44", tone: "success" }, { text: "−6", tone: "danger" }]);
  const clean = details({ row: prRow({ ci: "passing", decision: "APPROVED" }) });
  assert.equal(clean.owner, "someone else's PR");
  assert.deepEqual(clean.status.slice(0, 3).map((r) => [r.value, r.tone]), [["no conflicts", "success"], ["passing", "success"], ["approved", "success"]]);
});

const ticket = (params) => ({
  identifier: "THU-1", state: "In Progress", stateType: "started", priority: 2, project: "Omnia", assignee: "Gentrit",
  prUrl: null, isMyPullRequest: true, branch: "thu-1-strip-bay", ...params,
});

test("details: a ticket's status is its state, priority, project, assignee, PR and branch; unknown ones leave", () => {
  const d = details({ row: { kind: "issue", issue: ticket({ prUrl: "https://github.com/o/r/pull/19" }) } });
  assert.deepEqual(d.status.map((r) => [r.label, r.value]), [
    ["State", "In Progress"], ["Priority", "High"], ["Project", "Omnia"], ["Assignee", "Gentrit"], ["PR", "#19"], ["Branch", "thu-1-strip-bay"],
  ]);
  assert.equal(d.status.find((r) => r.label === "PR").url, "https://github.com/o/r/pull/19");
  assert.equal(d.owner, "my PR");
  const bare = details({ row: { kind: "issue", issue: ticket({ project: null, assignee: null, branch: null, isMyPullRequest: false }) } });
  assert.deepEqual(bare.status.map((r) => [r.label, r.value]), [["State", "In Progress"], ["Priority", "High"], ["Assignee", "Unassigned"]]);
  assert.equal(bare.owner, null);
});

test("details: a ticket's state, priority and a missing assignee in their tones", () => {
  const tones = (issue) => details({ row: { kind: "issue", issue: ticket(issue) } }).status.filter((r) => ["State", "Priority", "Assignee"].includes(r.label)).map((r) => r.tone);
  assert.deepEqual(tones({}), ["warning", "warning", null]);
  assert.deepEqual(tones({ stateType: "completed", priority: 1, assignee: null }), ["success", "danger", "dim"]);
  assert.deepEqual(tones({ stateType: "unstarted", priority: 3 }), [null, null, null]);
});

test("details: a ticket's skill gives its Linear stage as the reason", () => {
  const menu = suggestedMenu([["gh44-implement", "i"], ["gh44-plan", "p"]]);
  const d = details({ row: { kind: "issue", issue: ticket({}) }, menu });
  assert.deepEqual(d.suggested.map((s) => s.reason), ["In Progress, no PR", null]);
  const review = details({ row: { kind: "issue", issue: ticket({ state: "In Review", prUrl: "https://github.com/o/r/pull/19" }) }, menu: suggestedMenu([["gh44-address-review", "a"]]) });
  assert.equal(review.suggested[0].reason, "In Review, your PR");
});

test("details: the agent on the row and its worktree, or no Agent section when neither is known", () => {
  const agent = { status: "working", tabName: "#19 address-review", since: NOW - 12 * MINUTE };
  const d = details({ row: prRow({ author: "me" }), agent, worktree: "/repo/.worktrees/install-no-sudo", repoMain: "/repo" });
  assert.deepEqual(d.agent.map((r) => [r.label, r.value, r.tone]), [
    ["Status", "working 12m", "working"], ["Tab", "#19 address-review", null], ["Worktree", ".worktrees/install-no-sudo", null],
  ]);
  const elsewhere = details({ row: prRow({ author: "me" }), worktree: "/elsewhere/thu-1", repoMain: "/repo" });
  assert.deepEqual(elsewhere.agent.map((r) => [r.label, r.value]), [["Worktree", "/elsewhere/thu-1"]]);
  assert.equal(details({ row: prRow({ author: "me" }) }).agent, null);
});

test("a done agent suggests the case's after done action, or keeps its tab on the button with nothing", () => {
  const next = action({ skill: "gh44-address-review", afterDone: "gh44-code-review", agent: { status: "done", tabName: "#15 address-review", since: null } });
  assert.equal(next.kind, "skill");
  assert.equal(next.label, "code-review");
  const nothing = action({ skill: "gh44-address-review", afterDone: AFTER_DONE_NOTHING, agent: { status: "done", tabName: "#15 address-review", since: null } });
  assert.equal(nothing.kind, "agent");
  assert.equal(nothing.label, "open tab");
  assert.equal(nothing.style, "quiet");
  assert.equal(action({ skill: "gh44-plan", afterDone: "gh44-code-review" }).label, "plan");
});

test("a done agent skips resuming a space on its branch: the case's action or its after done shows", () => {
  const done = { status: "done", tabName: "#15 address-review", since: null };
  const main = action({ skill: "gh44-address-review", spaceName: "pr-15", agent: done });
  assert.equal(main.kind, "skill");
  assert.equal(main.label, "address-review");
  assert.equal(action({ skill: "gh44-address-review", afterDone: "gh44-code-review", spaceName: "pr-15", agent: done }).label, "code-review");
  assert.equal(action({ skill: "gh44-address-review", spaceName: "pr-15" }).kind, "resume");
});

test("the button says which skill or link entry it runs: the after done for a done agent, none for a space or an agent", () => {
  const done = { status: "done", tabName: "#15 address-review", since: null };
  assert.equal(action({ skill: "gh44-address-review" }).skill, "gh44-address-review");
  assert.equal(action({ skill: "gh44-address-review", afterDone: "gh44-code-review", agent: done }).skill, "gh44-code-review");
  assert.equal(action({ skill: "gh44-address-review", spaceName: "pr-15" }).skill, null);
  assert.equal(action({ skill: "gh44-address-review", agent: { ...done, status: "working" } }).skill, null);
  const links = [{ entry: NUDGE_ENTRY, label: "Nudge reviewers", icon: "bell", tip: "Ask ana", url: null }];
  assert.equal(action({ skill: NUDGE_ENTRY, links }).skill, NUDGE_ENTRY);
});

test("a case's where overrides Where runs go; default keeps it, and Ask always runs in front here", () => {
  const place = (params) => getCaseRunPlace({ caseWhere: "default", where: "ask", role: "work", hasWorktreeTarget: true, hasWorktree: false, isBackgroundDefault: false, ...params });
  assert.deepEqual(place({}), { place: "ask", isBackground: false });
  assert.deepEqual(place({ isBackgroundDefault: true, hasWorktreeTarget: false }), { place: "here", isBackground: true });
  assert.deepEqual(place({ caseWhere: "worktree", where: "here" }), { place: "worktree", isBackground: false });
  assert.deepEqual(place({ caseWhere: "worktree", hasWorktreeTarget: false }), { place: "here", isBackground: false });
  assert.deepEqual(place({ caseWhere: "worktree", role: "review" }), { place: "here", isBackground: false });
  assert.deepEqual(place({ caseWhere: "here", isBackgroundDefault: true }), { place: "here", isBackground: false });
  assert.deepEqual(place({ caseWhere: "background" }), { place: "here", isBackground: true });
  assert.deepEqual(place({ caseWhere: "background", role: "ask" }), { place: "here", isBackground: false });
  assert.deepEqual(place({ hasWorktree: true }), { place: "worktree", isBackground: false });
  assert.deepEqual(place({ hasWorktree: true, caseWhere: "background" }), { place: "here", isBackground: true });
});

test("a row's agent that turns to needing you notifies once, again only after it moved on; one seen first blocked does not", () => {
  const row = (status) => ({ id: "pr-1", ref: "#15", title: "Fix CI", status });
  assert.deepEqual(getNewlyBlocked({ previous: {}, rows: [row("blocked")] }).notices, []);
  const first = getNewlyBlocked({ previous: {}, rows: [row("working")] });
  assert.deepEqual(first.notices, []);
  const blocked = getNewlyBlocked({ previous: first.next, rows: [row("blocked")] });
  assert.deepEqual(blocked.notices, [{ id: "pr-1", ref: "#15", title: "Fix CI" }]);
  assert.deepEqual(getNewlyBlocked({ previous: blocked.next, rows: [row("blocked")] }).notices, []);
  const working = getNewlyBlocked({ previous: blocked.next, rows: [row("working")] });
  assert.equal(getNewlyBlocked({ previous: working.next, rows: [row("blocked")] }).notices.length, 1);
  assert.deepEqual(getNewlyBlocked({ previous: {}, rows: [row(null)] }).next, {});
});

// ---------- On-call rows ----------

const oncallAction = (params) => getOncallRowAction({
  situation: "needsYou", isTriaging: false, agent: null, skill: null, hasReport: true, trackerName: "Sentry", now: NOW, ...params,
});

test("an On-call row with a report and no skill opens the report, filled while it needs you", () => {
  const main = oncallAction({ situation: "critical" });
  assert.equal(main.kind, "report");
  assert.equal(main.label, "report");
  assert.equal(main.style, "suggested");
  assert.equal(oncallAction({ situation: "notForYou" }).style, "quiet");
});

test("an On-call row without a report opens the issue in its tracker", () => {
  const main = oncallAction({ hasReport: false, situation: "filtered" });
  assert.equal(main.kind, "link");
  assert.equal(main.label, "open");
  assert.equal(main.tip, "Open in Sentry");
});

test("an On-call case's skill runs on the issue; Continue and Ask say what they do", () => {
  const debug = oncallAction({ skill: "gh44-debug" });
  assert.equal(debug.kind, "skill");
  assert.equal(debug.label, "debug");
  assert.equal(debug.style, "suggested");
  assert.equal(debug.tip, "/gh44-debug on this issue");
  assert.equal(oncallAction({ skill: "continue" }).tip, "Continue the triage in Claude");
  assert.equal(oncallAction({ skill: "ask" }).tip, "Ask Claude about it");
});

test("a re-run triage spins on the button before anything else", () => {
  const main = oncallAction({ isTriaging: true, skill: "gh44-debug", agent: { status: "working", tabName: "WEB-1 debug", since: null } });
  assert.equal(main.kind, "triaging");
  assert.equal(main.label, "triaging");
  assert.equal(main.isLoading, true);
});

test("an agent on the issue: answer it, go to its tab, or once done the case's after done", () => {
  const blocked = oncallAction({ skill: "gh44-debug", agent: { status: "blocked", tabName: "WEB-1 debug", since: NOW - 4 * MINUTE } });
  assert.equal(blocked.kind, "agent");
  assert.equal(blocked.style, "alert");
  assert.deepEqual(blocked.status, { tone: "blocked", text: "needs you", elapsed: "4m" });
  assert.equal(oncallAction({ agent: { status: "working", tabName: "WEB-1 debug", since: null } }).label, "working");
  const done = { status: "done", tabName: "WEB-1 debug", since: null };
  assert.equal(oncallAction({ skill: "gh44-debug", agent: done }).kind, "skill");
  assert.equal(oncallAction({ skill: "gh44-debug", agent: done, afterDone: "ask" }).label, "ask");
  assert.equal(oncallAction({ skill: "gh44-debug", agent: done, afterDone: "ask" }).skill, "ask");
  assert.equal(oncallAction({ skill: "gh44-debug" }).skill, "gh44-debug");
  assert.equal(oncallAction({}).skill, null);
  assert.equal(oncallAction({ skill: "gh44-debug", agent: done, afterDone: AFTER_DONE_NOTHING }).kind, "agent");
});

const oncallMenu = (params) => getOncallRowMenu({
  suggested: ["gh44-debug", "continue"], list: [{ name: "continue", key: "c" }, { name: "gh44-debug", key: "d" }, { name: "ask", key: "q" }],
  hasReport: true, hasSession: true, isSeen: false, trackerLink: { label: "Open in Sentry", icon: "oncall", url: "https://sentry.io/issues/42/" },
  hasAgent: false, ...params,
});

test("an On-call menu: its case's skills, other skills, then report, tracker, Continue, re-run and seen, then Details and Edit this case", () => {
  const sections = oncallMenu({});
  assert.deepEqual(sections.map((s) => s.id), ["suggested", "other", "links", "more"]);
  assert.deepEqual(sections[0].items.map((i) => [i.skill, i.key]), [["gh44-debug", "d"]]);
  assert.deepEqual(sections[1].items.map((i) => i.skill), ["ask"]);
  assert.deepEqual(sections[2].items.map((i) => (i.kind === "link" ? i.label : i.id)), ["report", "Open in Sentry", "continue", "rerun", "seen"]);
  assert.equal(sections[2].items.find((i) => i.id === "continue").key, "c");
  assert.deepEqual(sections[3].items, [{ kind: "details" }, { kind: "editCase" }]);
});

test("an On-call menu leaves out the report and Continue it can't run, and offers Mark as unseen once seen", () => {
  const links = oncallMenu({ hasReport: false, hasSession: false, isSeen: true }).find((s) => s.id === "links").items;
  assert.deepEqual(links.map((i) => (i.kind === "link" ? i.label : i.id)), ["Open in Sentry", "rerun", "unseen"]);
  const quiet = oncallMenu({ isSeen: null, hasAgent: true }).find((s) => s.id === "links").items;
  assert.deepEqual(quiet.map((i) => i.kind === "oncall" ? i.id : i.kind), ["report", "link", "continue", "rerun", "agent"]);
});

const decision = (params) => ({
  issueId: "42", shortId: "WEB-1A", title: "TypeError", project: "web", url: "https://sentry.io/issues/42/", kind: "new", priority: "high",
  count: 40, userCount: 12, lastSeen: "2026-11-25T11:00:00Z", decidedAt: new Date(NOW - 2 * 60 * MINUTE).toISOString(), trigger: "new",
  stage: "ai", outcome: "reported", severity: "high", matchedRule: "A crash in code my team owns", summary: "useJob reads a missing job", owner: "mine",
  sessionId: "s1", reportPath: "/r.md", cwd: null, costUsd: 0.12, isNotified: true, ...params,
});

// The clock in local time, as the runtime's timezone shows it.
/** @param {number} at */
const localTime = (at) => `${String(new Date(at).getHours()).padStart(2, "0")}:${String(new Date(at).getMinutes()).padStart(2, "0")}`;
const TWO_HOURS_AGO = NOW - 2 * 60 * MINUTE;

test("an On-call row's meta: new, when it was decided, project, a regression, events and users", () => {
  const decided = `${localTime(TWO_HOURS_AGO)} (2h ago)`;
  assert.deepEqual(getDecisionFacts({ decision: decision({}), isUnseen: true, now: NOW }), ["new", decided, "web", "40 events · 12 users"]);
  assert.deepEqual(getDecisionFacts({ decision: decision({ kind: "regressed", project: "", decidedAt: "x" }), isUnseen: false, now: NOW }), ["regressed", "40 events · 12 users"]);
  assert.deepEqual(getDecisionFacts({ decision: decision({ count: 1, userCount: 0 }), isUnseen: false, now: NOW }), [decided, "web", "1 event"]);
});

test("a clock time: the time alone today, with the month and day before", () => {
  const now = new Date(2026, 10, 25, 15, 4).getTime();
  assert.equal(formatClock({ at: new Date(2026, 10, 25, 9, 7).getTime(), now }), "09:07");
  assert.equal(formatClock({ at: new Date(2026, 10, 24, 23, 59).getTime(), now }), "Nov 24 23:59");
});

test("a meta fact's parts: a diff in green and red, a known status in its tone, anything else plain", () => {
  assert.deepEqual(getFactParts("+44 −6"), [{ text: "+44", tone: "success" }, { text: "−6", tone: "danger" }]);
  assert.deepEqual(getFactParts("checks failing"), [{ text: "checks failing", tone: "danger" }]);
  assert.deepEqual(getFactParts("checks running"), [{ text: "checks running", tone: "warning" }]);
  assert.deepEqual(getFactParts("approved"), [{ text: "approved", tone: "success" }]);
  assert.deepEqual(getFactParts("ana"), [{ text: "ana", tone: null }]);
});

test("a meta line's runs: plain facts side by side join, a colored one stands alone", () => {
  assert.deepEqual(getFactSegments(["checks failing", "ana", "2h", "+44 −6"]), [
    { kind: "colored", parts: [{ text: "checks failing", tone: "danger" }] },
    { kind: "plain", text: "ana · 2h" },
    { kind: "colored", parts: [{ text: "+44", tone: "success" }, { text: "−6", tone: "danger" }] },
  ]);
  assert.deepEqual(getFactSegments([]), []);
});

test("details of an On-call row: severity, owner, cause, project, counts, when, who decided and the rule it matched", () => {
  const d = details({ row: { kind: "decision", decision: decision({}) }, menu: suggestedMenu([["gh44-debug", "d"]]) });
  assert.equal(d.owner, null);
  assert.deepEqual(d.status.map((r) => [r.label, r.value, r.tone]), [
    ["Severity", "high", "warning"], ["Owner", "my team", "warning"], ["Cause", "useJob reads a missing job", null], ["Project", "web", null],
    ["Events", "40", null], ["Users", "12", null], ["Decided", localTime(TWO_HOURS_AGO), null], ["Last seen", "1h ago", null],
    ["Decided by", "AI", null], ["Rule", "A crash in code my team owns", null],
  ]);
  const filtered = details({ row: { kind: "decision", decision: decision({ stage: "priority", outcome: "ignored", severity: null, owner: null, matchedRule: null, project: "", lastSeen: "" }) } });
  assert.deepEqual(filtered.status.map((r) => r.label), ["Cause", "Events", "Users", "Decided", "Decided by"]);
  const failed = details({ row: { kind: "decision", decision: decision({ stage: "failed", outcome: "failed" }) } });
  assert.equal(failed.status.find((r) => r.label === "Decided by").tone, "danger");
});

test("details of an On-call row: a skill of its case gives the case as its reason", () => {
  const { skills } = getSettings({ saved: { skills: { oncall: { list: [{ name: "gh44-debug", key: "d" }], cases: { high: { order: ["gh44-debug"], hidden: [] } } } } } });
  const d = details({ skills, row: { kind: "decision", decision: decision({}) }, menu: suggestedMenu([["gh44-debug", "d"], ["ask", "q"]]) });
  assert.deepEqual(d.suggested.map((s) => s.reason), ["high, needs you", "reads it, changes no code"]);
});

// ---------- link entries ----------

const linkPr = (params) => ({ url: "https://github.com/o/n/pull/15", author: "me", hasConflicts: false, requestedUsers: [], ...params });
const rowLinks = (params, login = "me") => getPullRequestLinks({ pr: linkPr(params), login });

test("a PR row links to its checks, its conflicting files only with conflicts, and nudges only on my PR waiting on reviewers", () => {
  assert.deepEqual(rowLinks({}).map((l) => [l.entry, l.url]), [["(checks)", "https://github.com/o/n/pull/15/checks"]]);
  assert.deepEqual(rowLinks({ hasConflicts: true }).map((l) => [l.entry, l.url]), [
    ["(checks)", "https://github.com/o/n/pull/15/checks"],
    ["(conflicts)", "https://github.com/o/n/pull/15/conflicts"],
  ]);
  assert.deepEqual(rowLinks({ requestedUsers: ["ana", "bo"] }).map((l) => [l.entry, l.url]), [["(checks)", "https://github.com/o/n/pull/15/checks"], ["(nudge)", null]]);
  assert.deepEqual(rowLinks({ author: "ana", requestedUsers: ["me"] }).map((l) => l.entry), ["(checks)"]);
  assert.deepEqual(rowLinks({ requestedUsers: ["ana"] }, null).map((l) => l.entry), ["(checks)"]);
});

test("each link says what it opens; the nudge names who it asks again", () => {
  const [checks, conflicts, nudge] = rowLinks({ hasConflicts: true, requestedUsers: ["ana", "bo"] });
  assert.deepEqual([checks.label, conflicts.label, nudge.label], ["Open checks", "Open conflicting files", "Nudge reviewers"]);
  assert.equal(nudge.tip, "Ask ana and bo to review again");
  assert.equal(rowLinks({ requestedUsers: ["ana", "bo", "cy"] })[1].tip, "Ask ana, bo and cy to review again");
});

const caseOf = (situation, from = defaultSkills) => from.github.cases[situation];
const rowActions = ({ situation, available = [], from, facts = {} }) => getRowActions({
  caseSettings: caseOf(situation, from), facts: { failingChecks: [], labels: [], author: "me", size: 0, priority: null, ...facts },
  isAvailable: (entry) => !isLinkEntry(entry) || available.includes(entry),
});

test("a row's actions: its case's shown entries the row can run, the first one its main action", () => {
  assert.deepEqual(rowActions({ situation: "myPullRequest", available: [NUDGE_ENTRY] }), {
    main: "gh44-address-review", suggested: ["gh44-address-review", NUDGE_ENTRY, "gh44-code-review", "gh44-resolve-conflicts", "ask"], reason: null,
  });
  assert.deepEqual(rowActions({ situation: "myPullRequest" }).suggested, ["gh44-address-review", "gh44-code-review", "gh44-resolve-conflicts", "ask"]);
});

test("a link entry as main action gives way to the next one when the row can't run it", () => {
  const nudgeFirst = moveCaseEntry({ skills: defaultSkills, tab: "github", situation: "myPullRequest", entry: NUDGE_ENTRY, to: 0 });
  assert.equal(rowActions({ situation: "myPullRequest", from: nudgeFirst, available: [NUDGE_ENTRY] }).main, NUDGE_ENTRY);
  assert.equal(rowActions({ situation: "myPullRequest", from: nudgeFirst }).main, "gh44-address-review");
  const openFirst = moveCaseEntry({ skills: defaultSkills, tab: "github", situation: "myPullRequest", entry: OPEN_ENTRY, to: 0 });
  assert.equal(rowActions({ situation: "myPullRequest", from: openFirst }).main, null);
});

test("a link entry on the button opens its page, or nudges; quiet, with what it does on hover", () => {
  const links = rowLinks({ requestedUsers: ["ana"] });
  const checks = action({ skill: CHECKS_ENTRY, links });
  assert.deepEqual([checks.kind, checks.label, checks.icon, checks.style, checks.url, checks.tip], ["link", "checks", "link", "quiet", "https://github.com/o/n/pull/15/checks", "Open the PR's checks on GitHub"]);
  const nudge = action({ skill: NUDGE_ENTRY, links });
  assert.deepEqual([nudge.kind, nudge.label, nudge.url, nudge.tip], ["nudge", "nudge", null, "Ask ana to review again"]);
  assert.equal(action({ skill: CONFLICTS_ENTRY, links }).kind, "link");
  assert.equal(action({ skill: CONFLICTS_ENTRY, links }).url, null);
});

test("a menu offers a link entry of its case among the suggested, with its key; the row's other link entries go with the links", () => {
  const entryLinks = rowLinks({ hasConflicts: true, requestedUsers: ["ana"] });
  const withLinks = [...list, { name: CHECKS_ENTRY, key: null }, { name: CONFLICTS_ENTRY, key: "f" }, { name: NUDGE_ENTRY, key: "n" }];
  const [suggested, other, links] = menu({ suggested: ["gh44-resolve-conflicts", CONFLICTS_ENTRY], list: withLinks, entryLinks });
  assert.deepEqual(suggested.items.map((i) => [i.kind, i.key]), [["skill", "c"], ["linkEntry", "f"]]);
  assert.equal(suggested.items[1].url, "https://github.com/o/n/pull/15/conflicts");
  assert.deepEqual(other.items.map((i) => i.skill), ["gh44-code-review", "gh44-address-review", "ask"]);
  assert.deepEqual(links.items.map((i) => (i.kind === "linkEntry" ? i.entry : i.kind)), ["link", CHECKS_ENTRY, NUDGE_ENTRY]);
});

test("a rule's pick leads the suggested with its reason", () => {
  const [suggested] = menu({ suggested: ["gh44-address-review", "gh44-resolve-conflicts"], reason: "lint fails" });
  assert.deepEqual(suggested.items.map((i) => i.reason), ["lint fails", null]);
});

test("details: a suggested link entry and a rule's reason; the menu's links and link entries as the row's links", () => {
  const entryLinks = rowLinks({ hasConflicts: true, requestedUsers: ["ana"] });
  const rowMenu = menu({ suggested: ["gh44-resolve-conflicts", CONFLICTS_ENTRY], entryLinks, reason: "lint fails", links: [{ ...githubLink, url: "https://github.com/o/n/pull/15" }] });
  const d = details({ row: prRow({ author: "me", hasConflicts: true }), menu: rowMenu, main: "gh44-resolve-conflicts" });
  assert.deepEqual(d.suggested.map((s) => [s.skill, s.reason, s.isMain]), [["gh44-resolve-conflicts", "lint fails", true], [CONFLICTS_ENTRY, null, false]]);
  assert.deepEqual(d.links.map((l) => [l.label, l.url, l.entry]), [
    ["Open in GitHub", "https://github.com/o/n/pull/15", null],
    ["Open checks", "https://github.com/o/n/pull/15/checks", CHECKS_ENTRY],
    ["Nudge reviewers", null, NUDGE_ENTRY],
  ]);
});

// ---------- case rules ----------

const ruleFacts = { failingChecks: ["CI / lint", "test (node 22)"], labels: ["Bug"], author: "Ana", size: 520, priority: 2 };
const fits = (kind, value) => matchCaseRule({ rule: { id: "rule-1", when: { kind, value }, then: "ask" }, facts: ruleFacts });

test("a rule fits a failing check holding its value, a label or author equal to it, a size above it, a priority equal to it", () => {
  assert.deepEqual([fits("check", "lint"), fits("check", "LINT"), fits("check", "build")], [true, true, false]);
  assert.deepEqual([fits("label", "bug"), fits("label", "bugs")], [true, false]);
  assert.deepEqual([fits("author", "ana"), fits("author", "an")], [true, false]);
  assert.deepEqual([fits("size", "500"), fits("size", "520")], [true, false]);
  assert.deepEqual([fits("priority", "2"), fits("priority", "1")], [true, false]);
  assert.equal(matchCaseRule({ rule: { id: "r", when: { kind: "size", value: "1" }, then: "ask" }, facts: { ...ruleFacts, size: null } }), false);
});

test("the first rule that fits and the row can run picks the main action, first in the suggested with its reason", () => {
  const ruled = [
    { when: { kind: "label", value: "skip" }, then: "gh44-code-review" },
    { when: { kind: "check", value: "lint" }, then: NUDGE_ENTRY },
    { when: { kind: "check", value: "lint" }, then: "ask" },
    { when: { kind: "size", value: "10" }, then: "gh44-code-review" },
  ].reduce((from, rule) => addCaseRule({ skills: from, tab: "github", situation: "myChecksFailing", ...rule }), defaultSkills);
  const picked = rowActions({ situation: "myChecksFailing", from: ruled, facts: { failingChecks: ["lint"], size: 500 }, available: [CHECKS_ENTRY] });
  assert.equal(picked.main, "ask");
  assert.equal(picked.reason, "lint fails");
  assert.deepEqual(picked.suggested.slice(0, 3), ["ask", "gh44-address-review", CHECKS_ENTRY]);
  assert.equal(rowActions({ situation: "myChecksFailing", from: ruled, facts: { size: 5 }, available: [CHECKS_ENTRY] }).main, "gh44-address-review");
});

test("a rule says why it picked: a failing check, a label, an author, a size, a priority", () => {
  const reason = (kind, value) => getRuleReason({ kind, value });
  assert.deepEqual([reason("check", "lint"), reason("label", "bug"), reason("author", "ana"), reason("size", "500"), reason("priority", "1")],
    ["lint fails", "labeled bug", "by ana", "over 500 lines", "Urgent"]);
});

test("a PR's rule facts: its failing checks, labels, author and lines changed; a ticket's: its labels and priority", () => {
  assert.deepEqual(getPullRequestRuleFacts({ failingChecks: ["lint"], labels: ["bug"], author: "ana", additions: 400, deletions: 120 }),
    { failingChecks: ["lint"], labels: ["bug"], author: "ana", size: 520, priority: null });
  assert.deepEqual(getIssueRuleFacts({ labels: ["bug"], priority: 1 }), { failingChecks: [], labels: ["bug"], author: null, size: null, priority: 1 });
});

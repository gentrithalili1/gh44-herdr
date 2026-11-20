// The panel's settings: which skills each tab offers, their keys, and per kind of row (a case)
// which one it runs.
// Pure, so tests/ can load it without Herdr.

/** @typedef {"github" | "linear"} Tab */
/** @typedef {"myConflicts" | "myChecksFailing" | "myChangesRequested" | "myApproved" | "myDraft" | "myPullRequest" | "othersPullRequest"} GithubSituation */
/** @typedef {"backlog" | "todo" | "inProgress" | "inProgressWithPullRequest" | "reviewMine" | "reviewOthers"} LinearSituation */
/** @typedef {GithubSituation | LinearSituation} Situation */
/** @typedef {{ author: string, hasConflicts: boolean, ci: "passing" | "failing" | "pending" | "none", decision: string | null, isDraft: boolean }} PullRequestShape */
/** @typedef {{ name: string, key: string | null }} Skill */
// A case's default runs on the row's main button; none: the button opens the PR or ticket.
/** @typedef {{ default?: string, hidden: string[] }} CaseSettings */
/** @typedef {{ list: Skill[], cases: Partial<Record<Situation, CaseSettings>> }} TabSkills */
/** @typedef {Record<Tab, TabSkills>} Skills */
/** @typedef {"ask" | "worktree" | "here"} WhereToRun */
/** @typedef {"review" | "work" | "ask" | "other"} SkillRole */
/** @typedef {{ shouldShowGithub: boolean, shouldShowLinear: boolean, shouldShowKeyHints: boolean, whereToRun: WhereToRun, skills: Skills }} Settings */

// Ask: a built-in action, not a skill. Claude reads the PR or ticket and waits for questions.
export const ASK_ACTION = "ask";
const ASK_KEY = "q";
export const ASK_DESCRIPTION = "Ask: Claude reads it in a new tab here and waits for your questions. It changes no code.";
const ASK_ENTRY = { name: ASK_ACTION, key: ASK_KEY };

/** @type {Record<Tab, { list: Skill[], defaults: Partial<Record<Situation, string>> }>} */
const BUILT_IN_SKILLS = {
  github: {
    list: [
      { name: "gh44-code-review", key: "r" },
      { name: "gh44-address-review", key: "a" },
      { name: "gh44-resolve-conflicts", key: "c" },
      ASK_ENTRY,
    ],
    defaults: {
      myConflicts: "gh44-resolve-conflicts",
      myChecksFailing: "gh44-address-review",
      myChangesRequested: "gh44-address-review",
      myApproved: "gh44-address-review",
      myDraft: "gh44-address-review",
      myPullRequest: "gh44-address-review",
      othersPullRequest: "gh44-code-review",
    },
  },
  linear: {
    list: [
      { name: "gh44-clarify", key: "c" },
      { name: "gh44-plan", key: "p" },
      { name: "gh44-implement", key: "i" },
      { name: "gh44-address-review", key: "a" },
      { name: "gh44-code-review", key: "r" },
      ASK_ENTRY,
    ],
    defaults: {
      backlog: "gh44-plan",
      todo: "gh44-plan",
      inProgress: "gh44-implement",
      inProgressWithPullRequest: "gh44-implement",
      reviewMine: "gh44-address-review",
      reviewOthers: "gh44-code-review",
    },
  },
};

// In first-match order: a row's case is the first one that fits it.
/** @type {{ id: GithubSituation, label: string }[]} */
export const GITHUB_SITUATIONS = [
  { id: "myConflicts", label: "My PR with conflicts" },
  { id: "myChecksFailing", label: "My PR, checks failing" },
  { id: "myChangesRequested", label: "My PR, changes requested" },
  { id: "myApproved", label: "My PR, approved" },
  { id: "myDraft", label: "My draft PR" },
  { id: "myPullRequest", label: "My PR" },
  { id: "othersPullRequest", label: "Someone else's PR" },
];
/** @type {{ id: LinearSituation, label: string }[]} */
export const LINEAR_SITUATIONS = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "Todo" },
  { id: "inProgress", label: "In progress, no PR" },
  { id: "inProgressWithPullRequest", label: "In progress, PR open" },
  { id: "reviewMine", label: "In review, my PR" },
  { id: "reviewOthers", label: "In review, someone else's PR" },
];
const SITUATIONS = { github: GITHUB_SITUATIONS, linear: LINEAR_SITUATIONS };

// No default key at all without a skill, so a saved case reads the same as a fresh one. The
// default is never hidden: it wins, like setDefaultSkill.
/** @param {{ skill: unknown, hidden: string[] }} params @returns {CaseSettings} */
const toCase = ({ skill, hidden }) => (typeof skill === "string" && skill
  ? { default: skill, hidden: hidden.filter((name) => name !== skill) }
  : { hidden });

// Every case of a tab, each with its default from defaults (when it has one) and nothing hidden.
/** @param {{ tab: Tab, defaults: Partial<Record<string, unknown>> }} params @returns {TabSkills["cases"]} */
const toCases = ({ tab, defaults }) => Object.fromEntries(SITUATIONS[tab].map((sit) => [sit.id, toCase({ skill: defaults[sit.id], hidden: [] })]));

/** @type {Record<Tab, TabSkills>} */
const DEFAULT_SKILLS = {
  github: { list: BUILT_IN_SKILLS.github.list, cases: toCases({ tab: "github", defaults: BUILT_IN_SKILLS.github.defaults }) },
  linear: { list: BUILT_IN_SKILLS.linear.list, cases: toCases({ tab: "linear", defaults: BUILT_IN_SKILLS.linear.defaults }) },
};
/** @type {WhereToRun[]} */
const WHERE_TO_RUN = ["ask", "worktree", "here"];
// Taken by the panel itself: j/k move, o opens.
const RESERVED_KEYS = ["j", "k", "o"];
const KEY_LETTER = /^[a-z]$/;
// A skill name goes into the prompt as /name, so it is one word.
const SKILL_NAME = /^[\w:.-]+$/;

/** @param {string} name */
export const isValidSkillName = (name) => SKILL_NAME.test(name);

/** @param {unknown} value @returns {Record<string, any>} */
const toRecord = (value) => (value && typeof value === "object" ? Object.fromEntries(Object.entries(value)) : {});

// Saved before cases, a tab held one default per situation, and some situations split since.
/** @type {Record<string, Situation[]>} */
const SPLIT_SITUATIONS = {
  notStarted: ["backlog", "todo"],
  inProgress: ["inProgress", "inProgressWithPullRequest"],
  myPullRequest: ["myChecksFailing", "myChangesRequested", "myApproved", "myDraft", "myPullRequest"],
};

/** @param {Record<string, unknown>} defaults @returns {Record<string, unknown>} */
const splitLegacyDefaults = (defaults) => Object.fromEntries(Object.entries(defaults)
  .flatMap(([id, skill]) => (SPLIT_SITUATIONS[id] ?? [id]).map((situation) => [situation, skill])));

// A saved tab's cases, or its cases from the defaults saved before cases.
/** @param {{ saved: Record<string, any>, tab: Tab }} params @returns {TabSkills["cases"]} */
function readSavedCases({ saved, tab }) {
  if (!saved.cases) return toCases({ tab, defaults: splitLegacyDefaults(toRecord(saved.defaults)) });
  const cases = toRecord(saved.cases);
  return Object.fromEntries(SITUATIONS[tab].map((sit) => {
    const c = toRecord(cases[sit.id]);
    const hidden = Array.isArray(c.hidden) ? c.hidden.filter((name) => typeof name === "string") : [];
    return [sit.id, toCase({ skill: c.default, hidden })];
  }));
}

/** @param {{ tabSkills: TabSkills, update: (c: CaseSettings) => CaseSettings }} params @returns {TabSkills} */
const mapCases = ({ tabSkills, update }) => ({
  ...tabSkills,
  cases: Object.fromEntries(Object.entries(tabSkills.cases).map(([id, c]) => [id, update(c)])),
});

// Keeps the cases' defaults and hidden skills that pass isKept.
/** @param {{ tabSkills: TabSkills, isKept: (skill: string) => boolean }} params @returns {TabSkills} */
const keepCaseSkills = ({ tabSkills, isKept }) => mapCases({
  tabSkills,
  update: (c) => toCase({ skill: c.default && isKept(c.default) ? c.default : null, hidden: c.hidden.filter(isKept) }),
});

// A list saved before Ask gets it at the end, on its key unless another skill has it.
/** @param {Skill[]} list @returns {Skill[]} */
const withAsk = (list) => {
  if (list.some((e) => e.name === ASK_ACTION)) return list;
  return [...list, { name: ASK_ACTION, key: list.some((e) => e.key === ASK_KEY) ? null : ASK_KEY }];
};

// A saved tab's skills, read back safely: unknown entries dropped, cases only from its list.
/** @param {{ saved: unknown, tab: Tab }} params @returns {TabSkills | null} */
function readTabSkills({ saved, tab }) {
  const s = toRecord(saved);
  if (!Array.isArray(s.list)) return null;
  const list = withAsk(s.list.map(toRecord).filter((e) => typeof e.name === "string" && isValidSkillName(e.name))
    .map((e) => ({ name: String(e.name), key: typeof e.key === "string" && KEY_LETTER.test(e.key) ? e.key : null })));
  const names = list.map((e) => e.name);
  return keepCaseSkills({ tabSkills: { list, cases: readSavedCases({ saved: s, tab }) }, isKept: (name) => names.includes(name) });
}

// A tab's default skills, without the ones not installed. null: not listed yet, all of them.
/** @param {{ tab: Tab, installedSkills: string[] | null }} params @returns {TabSkills} */
function getDefaultTabSkills({ tab, installedSkills }) {
  const tabSkills = DEFAULT_SKILLS[tab];
  if (!installedSkills) return tabSkills;
  /** @param {string} skill */
  const isInstalled = (skill) => canRun({ skill, installedSkills });
  return keepCaseSkills({ tabSkills: { ...tabSkills, list: tabSkills.list.filter((e) => isInstalled(e.name)) }, isKept: isInstalled });
}

// What shared("hub.settings") holds, over the defaults. A tab's skills, once saved, are kept as is.
/** @param {{ saved: unknown, installedSkills?: string[] | null }} params @returns {Settings} */
export function getSettings({ saved, installedSkills = null }) {
  const s = toRecord(saved);
  const skills = toRecord(s.skills);
  const shouldShowLinear = s.shouldShowLinear !== false;
  return {
    // One tab always shows: with Linear hidden, GitHub stays.
    shouldShowGithub: s.shouldShowGithub !== false || !shouldShowLinear,
    shouldShowLinear,
    whereToRun: WHERE_TO_RUN.find((w) => w === s.whereToRun) ?? "ask",
    shouldShowKeyHints: s.shouldShowKeyHints !== false,
    skills: {
      github: readTabSkills({ saved: skills.github, tab: "github" }) ?? getDefaultTabSkills({ tab: "github", installedSkills }),
      linear: readTabSkills({ saved: skills.linear, tab: "linear" }) ?? getDefaultTabSkills({ tab: "linear", installedSkills }),
    },
  };
}

// The tab to show: the saved one while it is shown, else the other.
/** @param {{ saved: unknown, settings: Settings }} params @returns {Tab} */
export function getShownTab({ saved, settings }) {
  if (saved === "linear" && settings.shouldShowLinear) return "linear";
  return settings.shouldShowGithub ? "github" : "linear";
}

// Where a ticket's run goes when it has no worktree yet. Review skills and Ask never ask and run
// here, like a ticket without a branch or repo to make a worktree from (hasWorktreeTarget false).
/** @param {{ where: WhereToRun, role: SkillRole, hasWorktreeTarget: boolean }} params @returns {WhereToRun} */
export function getWhereToRun({ where, role, hasWorktreeTarget }) {
  if (role === "review" || role === "ask" || !hasWorktreeTarget) return "here";
  return where;
}

// No kind of row runs a skill: every row's button just opens it.
/** @param {{ skills: Skills, tab: Tab }} params */
export const hasNoDefaults = ({ skills, tab }) => Object.values(skills[tab].cases).every((c) => !c.default);

/** @param {{ skills: Skills, tab: Tab, tabSkills: TabSkills }} params @returns {Skills} */
const withTab = ({ skills, tab, tabSkills }) => ({ ...skills, [tab]: tabSkills });

/** @param {{ skills: Skills, tab: Tab, skill: string }} params @returns {Skills} */
export function addSkill({ skills, tab, skill }) {
  const name = skill.trim();
  const current = skills[tab];
  if (!isValidSkillName(name) || current.list.some((e) => e.name === name)) return skills;
  return withTab({ skills, tab, tabSkills: { ...current, list: [...current.list, { name, key: null }] } });
}

// Also clears it from every case, so no row runs a skill the menu no longer has. Ask stays.
/** @param {{ skills: Skills, tab: Tab, skill: string }} params @returns {Skills} */
export function removeSkill({ skills, tab, skill }) {
  if (skill === ASK_ACTION) return skills;
  const current = skills[tab];
  const tabSkills = keepCaseSkills({ tabSkills: { ...current, list: current.list.filter((e) => e.name !== skill) }, isKept: (name) => name !== skill });
  return withTab({ skills, tab, tabSkills });
}

// A letter another skill of the tab had moves to this one; a reserved letter changes nothing.
/** @param {{ skills: Skills, tab: Tab, skill: string, key: string | null }} params @returns {Skills} */
export function setSkillKey({ skills, tab, skill, key }) {
  const letter = key?.toLowerCase() ?? null;
  if (letter !== null && (!KEY_LETTER.test(letter) || RESERVED_KEYS.includes(letter))) return skills;
  const current = skills[tab];
  const list = current.list.map((e) => {
    if (e.name === skill) return { ...e, key: letter };
    return letter !== null && e.key === letter ? { ...e, key: null } : e;
  });
  return withTab({ skills, tab, tabSkills: { ...current, list } });
}

// skill null: the row gets no skill and its button opens the PR or ticket. A hidden skill picked
// as the default shows again, so the menu always has what the button runs.
/** @param {{ skills: Skills, tab: Tab, situation: Situation, skill: string | null }} params @returns {Skills} */
export function setDefaultSkill({ skills, tab, situation, skill }) {
  const current = skills[tab];
  const hidden = (current.cases[situation]?.hidden ?? []).filter((name) => name !== skill);
  return withTab({ skills, tab, tabSkills: { ...current, cases: { ...current.cases, [situation]: toCase({ skill, hidden }) } } });
}

// Hidden: the skill leaves the case's menu and keys. Hiding the case's default clears it.
/** @param {{ skills: Skills, tab: Tab, situation: Situation, skill: string, isHidden: boolean }} params @returns {Skills} */
export function setCaseHidden({ skills, tab, situation, skill, isHidden }) {
  const current = skills[tab];
  const c = current.cases[situation] ?? { hidden: [] };
  const others = c.hidden.filter((name) => name !== skill);
  const next = toCase({ skill: isHidden && c.default === skill ? null : c.default, hidden: isHidden ? [...others, skill] : others });
  return withTab({ skills, tab, tabSkills: { ...current, cases: { ...current.cases, [situation]: next } } });
}

// Where a ticket is: backlog, todo, progress or review (a started state named like "In Review").
/** @param {{ stateType: string, state: string }} issue @returns {"backlog" | "todo" | "progress" | "review"} */
export function getIssueStage(issue) {
  if (issue.stateType === "started") return /review/i.test(issue.state) ? "review" : "progress";
  if (issue.stateType === "backlog" || issue.stateType === "triage") return "backlog";
  return "todo";
}

/** @param {{ pr: PullRequestShape, login: string | null }} params @returns {GithubSituation} */
export function getGithubSituation({ pr, login }) {
  if (!login || pr.author !== login) return "othersPullRequest";
  if (pr.hasConflicts) return "myConflicts";
  if (pr.ci === "failing") return "myChecksFailing";
  if (pr.decision === "CHANGES_REQUESTED") return "myChangesRequested";
  if (pr.decision === "APPROVED") return "myApproved";
  return pr.isDraft ? "myDraft" : "myPullRequest";
}

/** @param {{ stateType: string, state: string, isMyPullRequest: boolean, prUrl: string | null }} issue @returns {LinearSituation} */
export function getLinearSituation(issue) {
  const stage = getIssueStage(issue);
  switch (stage) {
    case "backlog": return "backlog";
    case "todo": return "todo";
    case "progress": return issue.prUrl ? "inProgressWithPullRequest" : "inProgress";
    case "review": return issue.isMyPullRequest ? "reviewMine" : "reviewOthers";
    default: {
      /** @type {never} */
      const unknownStage = stage;
      return unknownStage;
    }
  }
}

// The skill a row's main button runs, or null when none is picked.
/** @param {{ skills: Skills, tab: Tab, situation: Situation }} params */
export function getDefaultSkill({ skills, tab, situation }) {
  return skills[tab].cases[situation]?.default ?? null;
}

/** @type {LinearSituation[]} */
const WORK_SITUATIONS = ["backlog", "todo", "inProgress", "inProgressWithPullRequest"];

// Review skills belong to the skill, not to today's default: a skill saved or built in as the
// review default of one side keeps that side when the default changes. Ask is never one.
/** @param {{ skills: Skills, situation: "reviewMine" | "reviewOthers" }} params */
const isReviewSkillOf = ({ skills, situation }) => {
  const names = [getDefaultSkill({ skills, tab: "linear", situation }), BUILT_IN_SKILLS.linear.defaults[situation]];
  /** @param {string} skill */
  return (skill) => skill !== ASK_ACTION && names.includes(skill);
};

// What a skill does. "review": gets the ticket's PR URL and never asks where to run.
// "work" (a not started or in progress default): moves a not started ticket to In Progress.
// Every skill but a review one asks "new worktree or this space" on a ticket without one.
// "ask": Ask, even as a work or review default. It never moves the ticket or asks where.
/** @param {{ skills: Skills, skill: string }} params @returns {SkillRole} */
export function getSkillRole({ skills, skill }) {
  if (skill === ASK_ACTION) return "ask";
  if (isReviewSkillOf({ skills, situation: "reviewMine" })(skill) || isReviewSkillOf({ skills, situation: "reviewOthers" })(skill)) return "review";
  if (WORK_SITUATIONS.some((situation) => getDefaultSkill({ skills, tab: "linear", situation }) === skill)) return "work";
  return "other";
}

/** @param {{ skills: Skills, tab: Tab }} params */
export const getTabSkills = ({ skills, tab }) => skills[tab].list.map((s) => s.name);

// What a row of this case offers in its menu and keys: the tab's skills it does not hide.
/** @param {{ skills: Skills, tab: Tab, situation: Situation }} params */
export function getCaseActions({ skills, tab, situation }) {
  const hidden = skills[tab].cases[situation]?.hidden ?? [];
  return getTabSkills({ skills, tab }).filter((name) => !hidden.includes(name));
}

// A ticket's menu (and so its keys): its case's actions, with my-PR review skills only on my PR
// and the others' ones only on someone else's PR.
/** @param {{ skills: Skills, issue: { stateType: string, state: string, isMyPullRequest: boolean, prUrl: string | null } }} params */
export function getTicketSkills({ skills, issue }) {
  const isReviewMine = isReviewSkillOf({ skills, situation: "reviewMine" });
  const isReviewOthers = isReviewSkillOf({ skills, situation: "reviewOthers" });
  const isOthersPullRequest = !issue.isMyPullRequest && Boolean(issue.prUrl);
  /** @param {string} skill */
  const isOffered = (skill) => {
    if (!isReviewMine(skill) && !isReviewOthers(skill)) return true;
    return (isReviewMine(skill) && issue.isMyPullRequest) || (isReviewOthers(skill) && isOthersPullRequest);
  };
  return getCaseActions({ skills, tab: "linear", situation: getLinearSituation(issue) }).filter(isOffered);
}

// Keys on a selected row that start a skill directly: key letter -> skill. actions: the row's
// menu, so a skill hidden there has no key either.
/** @param {{ skills: Skills, tab: Tab, actions: string[] }} params @returns {Record<string, string>} */
export const getKeySkills = ({ skills, tab, actions }) => Object.fromEntries(skills[tab].list
  .filter((s) => s.key && actions.includes(s.name)).map((s) => [s.key, s.name]));

// "gh44-plan" -> "plan"; a skill without the prefix keeps its name.
/** @param {string} skill */
export const shortSkill = (skill) => skill.replace(/^gh44-/, "");

/** @param {{ skills: Skills, tab: Tab }} params */
export function getKeyHints({ skills, tab }) {
  const keys = skills[tab].list.filter((s) => s.key).map((s) => `${s.key} ${shortSkill(s.name)}`);
  return ["j/k move", "↵ run", ...keys, "o open", "/ search"].join(" · ");
}

/** @param {TabSkills} tab @returns {TabSkills} */
const copyTab = (tab) => ({ ...mapCases({ tabSkills: tab, update: (c) => ({ ...c, hidden: [...c.hidden] }) }), list: tab.list.map((e) => ({ ...e })) });

// The suggested setup: the gh44 skills from gh44-brain on both tabs, with their keys and defaults.
// A fresh copy, so an edit never reaches the built-in one.
/** @returns {Skills} */
export const getGh44Setup = () => ({ github: copyTab(DEFAULT_SKILLS.github), linear: copyTab(DEFAULT_SKILLS.linear) });

/** @param {{ a: string[], b: string[] }} params */
const isSameList = ({ a, b }) => a.length === b.length && a.every((name, i) => name === b[i]);

/** @param {{ a?: CaseSettings, b?: CaseSettings }} params */
const isSameCase = ({ a, b }) => (a?.default ?? null) === (b?.default ?? null) && isSameList({ a: a?.hidden ?? [], b: b?.hidden ?? [] });

/** @param {{ a: TabSkills, b: TabSkills, tab: Tab }} params */
const isSameTab = ({ a, b, tab }) =>
  a.list.length === b.list.length
  && a.list.every((e, i) => e.name === b.list[i].name && e.key === b.list[i].key)
  && SITUATIONS[tab].every((sit) => isSameCase({ a: a.cases[sit.id], b: b.cases[sit.id] }));

/** @param {{ skills: Skills }} params */
export function isUsingGh44Setup({ skills }) {
  return isSameTab({ a: skills.github, b: DEFAULT_SKILLS.github, tab: "github" })
    && isSameTab({ a: skills.linear, b: DEFAULT_SKILLS.linear, tab: "linear" });
}

// How many of the skills (each counted once, across both tabs, Ask aside) are installed.
/** @param {{ skills: Skills, installedSkills: string[] }} params */
export function countInstalledSkills({ skills, installedSkills }) {
  const names = new Set([...skills.github.list, ...skills.linear.list].map((e) => e.name).filter((name) => name !== ASK_ACTION));
  return { installed: [...names].filter((name) => installedSkills.includes(name)).length, total: names.size };
}

// A skill can run when it is in ~/.claude/skills, or a plugin skill ("plugin:skill") that is not
// listed there. Ask is built in. null: not listed yet, all of them.
/** @param {{ skill: string, installedSkills: string[] | null }} params */
export const canRun = ({ skill, installedSkills }) =>
  !installedSkills || skill === ASK_ACTION || skill.includes(":") || installedSkills.includes(skill);

/** @param {string} ref The ticket ID or the PR URL. */
export const getAskPrompt = (ref) => `Read ${ref} and wait for my questions. Don't change any code.`;

// The skills rows offer and run: the saved ones without the uninstalled. A row whose skill is
// missing shows "open" instead of starting an unknown command.
/** @param {{ skills: Skills, installedSkills: string[] | null }} params @returns {Skills} */
export function getRunnableSkills({ skills, installedSkills }) {
  /** @param {string} skill */
  const isRunnable = (skill) => canRun({ skill, installedSkills });
  /** @param {TabSkills} tabSkills @returns {TabSkills} */
  const runnable = (tabSkills) => keepCaseSkills({ tabSkills: { ...tabSkills, list: tabSkills.list.filter((e) => isRunnable(e.name)) }, isKept: isRunnable });
  return { github: runnable(skills.github), linear: runnable(skills.linear) };
}

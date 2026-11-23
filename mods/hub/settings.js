// The panel's settings: which skills each tab offers, their keys, and per kind of row (a case)
// which one it runs.
// Pure, so tests/ can load it without Herdr.

/** @typedef {"github" | "linear"} Tab */
/** @typedef {"myConflicts" | "myChecksFailing" | "myChangesRequested" | "myApproved" | "myDraft" | "myPullRequest" | "othersPullRequest"} GithubSituation */
/** @typedef {"backlog" | "todo" | "inProgress" | "inProgressWithPullRequest" | "reviewMine" | "reviewOthers"} LinearSituation */
/** @typedef {GithubSituation | LinearSituation} Situation */
/** @typedef {{ author: string, hasConflicts: boolean, ci: "passing" | "failing" | "pending" | "none", decision: string | null, isDraft: boolean }} PullRequestShape */
// repo: a repo's own skill ("owner/name"), offered only while that repo is focused.
/** @typedef {{ name: string, key: string | null, repo?: string }} Skill */
// The focused repo: its name and the skills in its .claude folder. skills null: not listed yet.
/** @typedef {{ name: string | null, skills: string[] | null }} RepoSkills */
// A case's actions in its order, OPEN_ENTRY among them, and the ones its menu hides. The first
// one not hidden is the default the row's main button runs; OPEN_ENTRY there: it opens the PR or ticket.
/** @typedef {{ order: string[], hidden: string[] }} CaseSettings */
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
// In a case's order: the main button opens the PR or ticket. Not a valid skill name, so no skill clashes.
export const OPEN_ENTRY = "(open)";

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

// A case from one default (a skill, or none): it goes first and shows; the rest follow in the
// list's order, and with no default OPEN_ENTRY goes first. Also reads cases saved before order.
/** @param {{ skill: unknown, hidden: string[], names: string[] }} params @returns {CaseSettings} */
const toCase = ({ skill, hidden, names }) => {
  const isSkill = typeof skill === "string" && skill !== "" && names.includes(skill);
  const others = names.filter((name) => name !== skill);
  return {
    order: isSkill ? [String(skill), ...others, OPEN_ENTRY] : [OPEN_ENTRY, ...others],
    hidden: hidden.filter((name) => name !== skill),
  };
};

// A case fitted to the tab's list: entries not in it dropped, new skills added at the end,
// OPEN_ENTRY always in the order and never hidden.
/** @param {{ c: CaseSettings, names: string[] }} params @returns {CaseSettings} */
const fitCase = ({ c, names }) => {
  const isKnown = (/** @type {string} */ name) => name === OPEN_ENTRY || names.includes(name);
  const kept = [...new Set(c.order.filter(isKnown))];
  const missing = [...names, OPEN_ENTRY].filter((name) => !kept.includes(name));
  return { order: [...kept, ...missing], hidden: [...new Set(c.hidden.filter((name) => names.includes(name)))] };
};

// Every case of a tab fitted to its list, a missing case built with no default.
/** @param {{ tabSkills: { list: Skill[], cases: Partial<Record<string, CaseSettings>> }, tab: Tab }} params @returns {TabSkills} */
const fitCases = ({ tabSkills, tab }) => {
  const names = tabSkills.list.map((e) => e.name);
  return {
    list: tabSkills.list,
    cases: Object.fromEntries(SITUATIONS[tab].map((sit) => [sit.id, fitCase({ c: tabSkills.cases[sit.id] ?? toCase({ skill: null, hidden: [], names }), names })])),
  };
};

// A tab with only `list` left of its skills. A case whose default leaves opens the PR or ticket
// instead of falling to its next skill, so a removed or missing skill never quietly changes it.
/** @param {{ tabSkills: TabSkills, list: Skill[], tab: Tab }} params @returns {TabSkills} */
const keepSkills = ({ tabSkills, list, tab }) => {
  const names = list.map((e) => e.name);
  const cases = Object.fromEntries(Object.entries(tabSkills.cases).map(([id, c]) => {
    const first = c.order.find((name) => !c.hidden.includes(name));
    const isFirstGone = first !== undefined && first !== OPEN_ENTRY && !names.includes(first);
    return [id, isFirstGone ? { ...c, order: [OPEN_ENTRY, ...c.order.filter((name) => name !== OPEN_ENTRY)] } : c];
  }));
  return fitCases({ tabSkills: { list, cases }, tab });
};

// Every case of a tab, each with its default from defaults (when it has one) and nothing hidden.
/** @param {{ tab: Tab, defaults: Partial<Record<string, unknown>>, names: string[] }} params @returns {TabSkills["cases"]} */
const toCases = ({ tab, defaults, names }) => Object.fromEntries(SITUATIONS[tab].map((sit) => [sit.id, toCase({ skill: defaults[sit.id], hidden: [], names })]));

/** @param {Tab} tab @returns {TabSkills} */
const builtInTab = (tab) => {
  const { list, defaults } = BUILT_IN_SKILLS[tab];
  return { list, cases: toCases({ tab, defaults, names: list.map((e) => e.name) }) };
};

/** @type {Record<Tab, TabSkills>} */
const DEFAULT_SKILLS = { github: builtInTab("github"), linear: builtInTab("linear") };
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

/** @param {unknown} value @returns {string[]} */
const toNames = (value) => (Array.isArray(value) ? value.filter((name) => typeof name === "string") : []);

// A saved tab's cases: with their order, or from the one default saved before order, or from
// the defaults saved before cases.
/** @param {{ saved: Record<string, any>, tab: Tab, names: string[] }} params @returns {TabSkills["cases"]} */
function readSavedCases({ saved, tab, names }) {
  if (!saved.cases) return toCases({ tab, defaults: splitLegacyDefaults(toRecord(saved.defaults)), names });
  const cases = toRecord(saved.cases);
  return Object.fromEntries(SITUATIONS[tab].map((sit) => {
    const c = toRecord(cases[sit.id]);
    const hidden = toNames(c.hidden);
    return [sit.id, Array.isArray(c.order) ? { order: toNames(c.order), hidden } : toCase({ skill: c.default, hidden, names })];
  }));
}

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
    .map((e) => ({
      name: String(e.name), key: typeof e.key === "string" && KEY_LETTER.test(e.key) ? e.key : null,
      ...(typeof e.repo === "string" && e.repo ? { repo: e.repo } : {}),
    })));
  const cases = readSavedCases({ saved: s, tab, names: list.map((e) => e.name) });
  return keepSkills({ tabSkills: { list, cases }, list, tab });
}

// A tab's default skills, without the ones not installed. null: not listed yet, all of them.
/** @param {{ tab: Tab, installedSkills: string[] | null }} params @returns {TabSkills} */
function getDefaultTabSkills({ tab, installedSkills }) {
  const tabSkills = DEFAULT_SKILLS[tab];
  if (!installedSkills) return tabSkills;
  /** @param {string} skill */
  const isInstalled = (skill) => canRun({ skill, installedSkills });
  return keepSkills({ tabSkills, list: tabSkills.list.filter((e) => isInstalled(e.name)), tab });
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
export const hasNoDefaults = ({ skills, tab }) => SITUATIONS[tab].every((sit) => getDefaultSkill({ skills, tab, situation: sit.id }) === null);

/** @param {{ skills: Skills, tab: Tab, tabSkills: TabSkills }} params @returns {Skills} */
const withTab = ({ skills, tab, tabSkills }) => ({ ...skills, [tab]: tabSkills });

// repo: the skill is that repo's own, so rows offer it only while the repo is focused.
/** @param {{ skills: Skills, tab: Tab, skill: string, repo?: string | null }} params @returns {Skills} */
export function addSkill({ skills, tab, skill, repo = null }) {
  const name = skill.trim();
  const current = skills[tab];
  if (!isValidSkillName(name) || current.list.some((e) => e.name === name)) return skills;
  return withTab({ skills, tab, tabSkills: fitCases({ tabSkills: { ...current, list: [...current.list, { name, key: null, ...(repo ? { repo } : {}) }] }, tab }) });
}

// Also clears it from every case, so no row runs a skill the menu no longer has. Ask stays.
/** @param {{ skills: Skills, tab: Tab, skill: string }} params @returns {Skills} */
export function removeSkill({ skills, tab, skill }) {
  if (skill === ASK_ACTION) return skills;
  const current = skills[tab];
  return withTab({ skills, tab, tabSkills: keepSkills({ tabSkills: current, list: current.list.filter((e) => e.name !== skill), tab }) });
}

/** @param {{ skills: Skills, tab: Tab, situation: Situation, update: (c: CaseSettings) => CaseSettings }} params @returns {Skills} */
const withCase = ({ skills, tab, situation, update }) => {
  const current = skills[tab];
  const c = current.cases[situation];
  if (!c) return skills;
  return withTab({ skills, tab, tabSkills: { ...current, cases: { ...current.cases, [situation]: update(c) } } });
};

// Puts an entry (a skill or OPEN_ENTRY) at position `to` of a case's order (an index from
// before the move). An unknown entry or a drop on its own place changes nothing.
/** @param {{ skills: Skills, tab: Tab, situation: Situation, entry: string, to: number }} params @returns {Skills} */
export function moveCaseEntry({ skills, tab, situation, entry, to }) {
  const from = skills[tab].cases[situation]?.order.indexOf(entry) ?? -1;
  if (from === -1 || to === from || to === from + 1) return skills;
  return withCase({
    skills, tab, situation,
    update: (c) => {
      const rest = c.order.filter((name) => name !== entry);
      const at = Math.max(0, Math.min(to > from ? to - 1 : to, rest.length));
      return { ...c, order: [...rest.slice(0, at), entry, ...rest.slice(at)] };
    },
  });
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

// Hidden: the skill leaves the case's menu and keys, and the next shown entry becomes the
// default. OPEN_ENTRY is not in the menu, so it never hides.
/** @param {{ skills: Skills, tab: Tab, situation: Situation, skill: string, isHidden: boolean }} params @returns {Skills} */
export function setCaseHidden({ skills, tab, situation, skill, isHidden }) {
  if (skill === OPEN_ENTRY) return skills;
  return withCase({
    skills, tab, situation,
    update: (c) => {
      const others = c.hidden.filter((name) => name !== skill);
      return { ...c, hidden: isHidden ? [...others, skill] : others };
    },
  });
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

// The skill a row's main button runs: the case's first shown entry. null: OPEN_ENTRY is first
// (or nothing shows), so the button opens the PR or ticket.
/** @param {{ skills: Skills, tab: Tab, situation: Situation }} params @returns {string | null} */
export function getDefaultSkill({ skills, tab, situation }) {
  const c = skills[tab].cases[situation];
  const first = c?.order.find((name) => !c.hidden.includes(name));
  return first && first !== OPEN_ENTRY ? first : null;
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

// What a row of this case offers in its menu and keys, in the case's order: the skills it does not hide.
/** @param {{ skills: Skills, tab: Tab, situation: Situation }} params @returns {string[]} */
export function getCaseActions({ skills, tab, situation }) {
  const c = skills[tab].cases[situation];
  if (!c) return getTabSkills({ skills, tab });
  return c.order.filter((name) => name !== OPEN_ENTRY && !c.hidden.includes(name));
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
const copyTab = (tab) => ({
  list: tab.list.map((e) => ({ ...e })),
  cases: Object.fromEntries(Object.entries(tab.cases).map(([id, c]) => [id, { order: [...c.order], hidden: [...c.hidden] }])),
});

// The suggested setup: the gh44 skills from gh44-brain on both tabs, with their keys and defaults.
// A fresh copy, so an edit never reaches the built-in one.
/** @returns {Skills} */
export const getGh44Setup = () => ({ github: copyTab(DEFAULT_SKILLS.github), linear: copyTab(DEFAULT_SKILLS.linear) });

/** @param {{ a: string[], b: string[] }} params */
const isSameList = ({ a, b }) => a.length === b.length && a.every((name, i) => name === b[i]);

/** @param {{ a?: CaseSettings, b?: CaseSettings }} params */
const isSameCase = ({ a, b }) => isSameList({ a: a?.order ?? [], b: b?.order ?? [] }) && isSameList({ a: a?.hidden ?? [], b: b?.hidden ?? [] });

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

// How many of the skills (each counted once, across both tabs, Ask and repo skills aside) are installed.
/** @param {{ skills: Skills, installedSkills: string[] }} params */
export function countInstalledSkills({ skills, installedSkills }) {
  const names = new Set([...skills.github.list, ...skills.linear.list].filter((e) => !e.repo).map((e) => e.name).filter((name) => name !== ASK_ACTION));
  return { installed: [...names].filter((name) => installedSkills.includes(name)).length, total: names.size };
}

// A skill can run when it is in ~/.claude/skills, or a plugin skill ("plugin:skill") that is not
// listed there. Ask is built in. null: not listed yet, all of them.
/** @param {{ skill: string, installedSkills: string[] | null }} params */
export const canRun = ({ skill, installedSkills }) =>
  !installedSkills || skill === ASK_ACTION || skill.includes(":") || installedSkills.includes(skill);

// A repo skill runs only in its repo, while the repo's .claude has it. Any other entry: canRun.
/** @param {{ entry: Skill, installedSkills: string[] | null, repo: RepoSkills | null }} params */
export function canRunEntry({ entry, installedSkills, repo }) {
  if (!entry.repo) return canRun({ skill: entry.name, installedSkills });
  return entry.repo === repo?.name && (!repo.skills || repo.skills.includes(entry.name));
}

// "owner/name" -> "name", for the repo tag beside a repo skill.
/** @param {string} repo */
export const shortRepo = (repo) => repo.split("/").pop() ?? repo;

/** @param {string} ref The ticket ID or the PR URL. */
export const getAskPrompt = (ref) => `Read ${ref} and wait for my questions. Don't change any code.`;

// The skills rows offer and run: the saved ones without the uninstalled, and repo skills only in
// their repo. A row whose skill is missing shows "open" instead of starting an unknown command.
/** @param {{ skills: Skills, installedSkills: string[] | null, repo?: RepoSkills | null }} params @returns {Skills} */
export function getRunnableSkills({ skills, installedSkills, repo = null }) {
  /** @param {TabSkills} tabSkills @param {Tab} tab @returns {TabSkills} */
  const runnable = (tabSkills, tab) => keepSkills({ tabSkills, list: tabSkills.list.filter((entry) => canRunEntry({ entry, installedSkills, repo })), tab });
  return { github: runnable(skills.github, "github"), linear: runnable(skills.linear, "linear") };
}

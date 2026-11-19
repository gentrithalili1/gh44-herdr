// The panel's settings: which skills each tab offers, their keys, and which one each row runs.
// Pure, so tests/ can load it without Herdr.

/** @typedef {"github" | "linear"} Tab */
/** @typedef {"othersPullRequest" | "myPullRequest" | "myConflicts"} GithubSituation */
/** @typedef {"notStarted" | "inProgress" | "reviewMine" | "reviewOthers"} LinearSituation */
/** @typedef {GithubSituation | LinearSituation} Situation */
/** @typedef {{ name: string, key: string | null }} Skill */
/** @typedef {{ list: Skill[], defaults: Partial<Record<Situation, string>> }} TabSkills */
/** @typedef {Record<Tab, TabSkills>} Skills */
/** @typedef {"ask" | "worktree" | "here"} WhereToRun */
/** @typedef {{ shouldShowGithub: boolean, shouldShowLinear: boolean, shouldShowKeyHints: boolean, whereToRun: WhereToRun, skills: Skills }} Settings */

const DEFAULT_SKILLS = {
  github: {
    list: [
      { name: "gh44-code-review", key: "r" },
      { name: "gh44-address-review", key: "a" },
      { name: "gh44-resolve-conflicts", key: "c" },
    ],
    defaults: { othersPullRequest: "gh44-code-review", myPullRequest: "gh44-address-review", myConflicts: "gh44-resolve-conflicts" },
  },
  linear: {
    list: [
      { name: "gh44-clarify", key: "c" },
      { name: "gh44-plan", key: "p" },
      { name: "gh44-implement", key: "i" },
      { name: "gh44-address-review", key: "a" },
      { name: "gh44-code-review", key: "r" },
    ],
    defaults: { notStarted: "gh44-plan", inProgress: "gh44-implement", reviewMine: "gh44-address-review", reviewOthers: "gh44-code-review" },
  },
};

/** @type {{ id: Situation, label: string }[]} */
export const GITHUB_SITUATIONS = [
  { id: "othersPullRequest", label: "Someone else's PR" },
  { id: "myPullRequest", label: "My PR" },
  { id: "myConflicts", label: "My PR with conflicts" },
];
/** @type {{ id: Situation, label: string }[]} */
export const LINEAR_SITUATIONS = [
  { id: "notStarted", label: "Not started" },
  { id: "inProgress", label: "In progress" },
  { id: "reviewMine", label: "In review, my PR" },
  { id: "reviewOthers", label: "In review, someone else's PR" },
];
const SITUATIONS = { github: GITHUB_SITUATIONS, linear: LINEAR_SITUATIONS };
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

// A saved tab's skills, read back safely: unknown entries dropped, defaults only from its list.
/** @param {{ saved: unknown, tab: Tab }} params @returns {TabSkills | null} */
function readTabSkills({ saved, tab }) {
  const s = toRecord(saved);
  if (!Array.isArray(s.list)) return null;
  const list = s.list.map(toRecord).filter((e) => typeof e.name === "string" && isValidSkillName(e.name))
    .map((e) => ({ name: String(e.name), key: typeof e.key === "string" && KEY_LETTER.test(e.key) ? e.key : null }));
  const names = list.map((e) => e.name);
  const defaults = toRecord(s.defaults);
  return {
    list,
    defaults: Object.fromEntries(SITUATIONS[tab].filter((sit) => names.includes(defaults[sit.id])).map((sit) => [sit.id, defaults[sit.id]])),
  };
}

// A tab's default skills, without the ones not installed. null: not listed yet, all of them.
/** @param {{ tab: Tab, installedSkills: string[] | null }} params @returns {TabSkills} */
function getDefaultTabSkills({ tab, installedSkills }) {
  const defaults = DEFAULT_SKILLS[tab];
  if (!installedSkills) return defaults;
  /** @param {string} name */
  const isInstalled = (name) => installedSkills.includes(name);
  return {
    list: defaults.list.filter((e) => isInstalled(e.name)),
    defaults: Object.fromEntries(Object.entries(defaults.defaults).filter(([, name]) => isInstalled(name))),
  };
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

// Where a ticket's run goes when it has no worktree yet. Review skills never ask and run here,
// like a ticket without a branch or repo to make a worktree from (hasWorktreeTarget false).
/** @param {{ where: WhereToRun, role: "review" | "work" | "other", hasWorktreeTarget: boolean }} params @returns {WhereToRun} */
export function getWhereToRun({ where, role, hasWorktreeTarget }) {
  if (role === "review" || !hasWorktreeTarget) return "here";
  return where;
}

// No kind of row runs a skill: every row's button just opens it.
/** @param {{ skills: Skills, tab: Tab }} params */
export const hasNoDefaults = ({ skills, tab }) => Object.keys(skills[tab].defaults).length === 0;

/** @param {{ skills: Skills, tab: Tab, tabSkills: TabSkills }} params @returns {Skills} */
const withTab = ({ skills, tab, tabSkills }) => ({ ...skills, [tab]: tabSkills });

/** @param {{ skills: Skills, tab: Tab, skill: string }} params @returns {Skills} */
export function addSkill({ skills, tab, skill }) {
  const name = skill.trim();
  const current = skills[tab];
  if (!isValidSkillName(name) || current.list.some((e) => e.name === name)) return skills;
  return withTab({ skills, tab, tabSkills: { ...current, list: [...current.list, { name, key: null }] } });
}

// Also clears it as a default, so no row runs a skill the menu no longer has.
/** @param {{ skills: Skills, tab: Tab, skill: string }} params @returns {Skills} */
export function removeSkill({ skills, tab, skill }) {
  const current = skills[tab];
  return withTab({
    skills, tab,
    tabSkills: {
      list: current.list.filter((e) => e.name !== skill),
      defaults: Object.fromEntries(Object.entries(current.defaults).filter(([, name]) => name !== skill)),
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

// skill null: the row gets no skill and its button opens the PR or ticket.
/** @param {{ skills: Skills, tab: Tab, situation: Situation, skill: string | null }} params @returns {Skills} */
export function setDefaultSkill({ skills, tab, situation, skill }) {
  const current = skills[tab];
  const defaults = Object.fromEntries(Object.entries(current.defaults).filter(([id]) => id !== situation));
  return withTab({ skills, tab, tabSkills: { ...current, defaults: skill ? { ...defaults, [situation]: skill } : defaults } });
}

// Where a ticket is: backlog, todo, progress or review (a started state named like "In Review").
/** @param {{ stateType: string, state: string }} issue */
export function getIssueStage(issue) {
  if (issue.stateType === "started") return /review/i.test(issue.state) ? "review" : "progress";
  if (issue.stateType === "backlog" || issue.stateType === "triage") return "backlog";
  return "todo";
}

/** @param {{ pr: { author: string, hasConflicts: boolean }, login: string | null }} params @returns {GithubSituation} */
export function getGithubSituation({ pr, login }) {
  if (!login || pr.author !== login) return "othersPullRequest";
  return pr.hasConflicts ? "myConflicts" : "myPullRequest";
}

/** @param {{ stateType: string, state: string, isMyPullRequest: boolean }} issue @returns {LinearSituation} */
export function getLinearSituation(issue) {
  const stage = getIssueStage(issue);
  if (stage === "review") return issue.isMyPullRequest ? "reviewMine" : "reviewOthers";
  return stage === "progress" ? "inProgress" : "notStarted";
}

// The skill a row's main button runs, or null when none is picked.
/** @param {{ skills: Skills, tab: Tab, situation: Situation }} params */
export function getDefaultSkill({ skills, tab, situation }) {
  return skills[tab].defaults[situation] ?? null;
}

/** @type {LinearSituation[]} */
const WORK_SITUATIONS = ["notStarted", "inProgress"];

// Review skills belong to the skill, not to today's default: a skill saved or built in as the
// review default of one side keeps that side when the default changes.
/** @param {{ skills: Skills, situation: "reviewMine" | "reviewOthers" }} params */
const isReviewSkillOf = ({ skills, situation }) => {
  const names = [skills.linear.defaults[situation], DEFAULT_SKILLS.linear.defaults[situation]];
  /** @param {string} skill */
  return (skill) => names.includes(skill);
};

// What a skill does. "review": gets the ticket's PR URL and never asks where to run.
// "work" (the not started and in progress defaults): moves a not started ticket to In Progress.
// Every skill but a review one asks "new worktree or this space" on a ticket without one.
/** @param {{ skills: Skills, skill: string }} params @returns {"review" | "work" | "other"} */
export function getSkillRole({ skills, skill }) {
  if (isReviewSkillOf({ skills, situation: "reviewMine" })(skill) || isReviewSkillOf({ skills, situation: "reviewOthers" })(skill)) return "review";
  const defaults = skills.linear.defaults;
  if (WORK_SITUATIONS.some((s) => defaults[s] === skill)) return "work";
  return "other";
}

/** @param {{ skills: Skills, tab: Tab }} params */
export const getTabSkills = ({ skills, tab }) => skills[tab].list.map((s) => s.name);

// A ticket's menu (and so its keys): my-PR review skills only on my PR, the others' ones only
// on someone else's PR.
/** @param {{ skills: Skills, issue: { isMyPullRequest: boolean, prUrl: string | null } }} params */
export function getTicketSkills({ skills, issue }) {
  const isReviewMine = isReviewSkillOf({ skills, situation: "reviewMine" });
  const isReviewOthers = isReviewSkillOf({ skills, situation: "reviewOthers" });
  const isOthersPullRequest = !issue.isMyPullRequest && Boolean(issue.prUrl);
  /** @param {string} skill */
  const isOffered = (skill) => {
    if (!isReviewMine(skill) && !isReviewOthers(skill)) return true;
    return (isReviewMine(skill) && issue.isMyPullRequest) || (isReviewOthers(skill) && isOthersPullRequest);
  };
  return getTabSkills({ skills, tab: "linear" }).filter(isOffered);
}

// Keys on a selected row that start a skill directly: key letter -> skill.
/** @param {{ skills: Skills, tab: Tab }} params @returns {Record<string, string>} */
export const getKeySkills = ({ skills, tab }) => Object.fromEntries(skills[tab].list.filter((s) => s.key).map((s) => [s.key, s.name]));

// "gh44-plan" -> "plan"; a skill without the prefix keeps its name.
/** @param {string} skill */
export const shortSkill = (skill) => skill.replace(/^gh44-/, "");

/** @param {{ skills: Skills, tab: Tab }} params */
export function getKeyHints({ skills, tab }) {
  const keys = skills[tab].list.filter((s) => s.key).map((s) => `${s.key} ${shortSkill(s.name)}`);
  return ["j/k move", "↵ run", ...keys, "o open", "/ search"].join(" · ");
}

/** @param {TabSkills} tab @returns {TabSkills} */
const copyTab = (tab) => ({ list: tab.list.map((e) => ({ ...e })), defaults: { ...tab.defaults } });

// The suggested setup: the gh44 skills from gh44-brain on both tabs, with their keys and defaults.
// A fresh copy, so an edit never reaches the built-in one.
/** @returns {Skills} */
export const getGh44Setup = () => ({ github: copyTab(DEFAULT_SKILLS.github), linear: copyTab(DEFAULT_SKILLS.linear) });

/** @param {{ a: TabSkills, b: TabSkills, situations: { id: Situation }[] }} params */
const isSameTab = ({ a, b, situations }) =>
  a.list.length === b.list.length
  && a.list.every((e, i) => e.name === b.list[i].name && e.key === b.list[i].key)
  && situations.every((sit) => (a.defaults[sit.id] ?? null) === (b.defaults[sit.id] ?? null));

/** @param {{ skills: Skills }} params */
export function isUsingGh44Setup({ skills }) {
  return isSameTab({ a: skills.github, b: DEFAULT_SKILLS.github, situations: GITHUB_SITUATIONS })
    && isSameTab({ a: skills.linear, b: DEFAULT_SKILLS.linear, situations: LINEAR_SITUATIONS });
}

// How many of the skills (each counted once, across both tabs) are installed.
/** @param {{ skills: Skills, installedSkills: string[] }} params */
export function countInstalledSkills({ skills, installedSkills }) {
  const names = new Set([...skills.github.list, ...skills.linear.list].map((e) => e.name));
  return { installed: [...names].filter((name) => installedSkills.includes(name)).length, total: names.size };
}

// A skill can run when it is in ~/.claude/skills, or a plugin skill ("plugin:skill") that is not
// listed there. null: not listed yet, all of them.
/** @param {{ skill: string, installedSkills: string[] | null }} params */
export const canRun = ({ skill, installedSkills }) => !installedSkills || skill.includes(":") || installedSkills.includes(skill);

// The skills rows offer and run: the saved ones without the uninstalled. A row whose skill is
// missing shows "open" instead of starting an unknown command.
/** @param {{ skills: Skills, installedSkills: string[] | null }} params @returns {Skills} */
export function getRunnableSkills({ skills, installedSkills }) {
  /** @param {TabSkills} tabSkills @returns {TabSkills} */
  const runnable = (tabSkills) => ({
    list: tabSkills.list.filter((e) => canRun({ skill: e.name, installedSkills })),
    defaults: Object.fromEntries(Object.entries(tabSkills.defaults).filter(([, name]) => name && canRun({ skill: name, installedSkills }))),
  });
  return { github: runnable(skills.github), linear: runnable(skills.linear) };
}

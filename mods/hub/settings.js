// The panel's settings: which skills each tab offers, their keys, and per kind of row (a case)
// which one it runs.
// Pure, so tests/ can load it without Herdr.

/** @typedef {"github" | "linear" | "oncall"} Tab */
/** @typedef {"myConflicts" | "myChecksFailing" | "myChangesRequested" | "myApproved" | "myDraft" | "myPullRequest" | "othersPullRequest"} GithubSituation */
/** @typedef {"backlog" | "todo" | "inProgress" | "inProgressWithPullRequest" | "reviewMine" | "reviewOthers"} LinearSituation */
/** @typedef {"critical" | "high" | "needsYou" | "notForYou" | "filtered" | "failed"} OncallSituation */
/** @typedef {GithubSituation | LinearSituation | OncallSituation} Situation */
/** @typedef {{ author: string, hasConflicts: boolean, ci: "passing" | "failing" | "pending" | "none", decision: string | null, isDraft: boolean }} PullRequestShape */
// repo: a repo's own skill ("owner/name"), offered only while that repo is focused.
/** @typedef {{ name: string, key: string | null, repo?: string }} Skill */
// The focused repo: its name and the skills in its .claude folder. skills null: not listed yet.
/** @typedef {{ name: string | null, skills: string[] | null }} RepoSkills */
// Where a case's skills run: "default" follows Where runs go (GitHub: a background tab).
/** @typedef {"default" | "worktree" | "here" | "background"} CaseWhere */
// What a row suggests once its agent is done: null, the case's main action; a skill; or AFTER_DONE_NOTHING.
/** @typedef {string | null} AfterDone */
/** @typedef {{ where: CaseWhere, afterDone: AfterDone }} CaseRun */
// A case rule: when a row of the case fits it, its action is the row's main one. check: a failing
// check's name holds the value; label, author: equal to it; size: more lines changed than it; priority: a
// Linear priority (its number).
/** @typedef {"check" | "label" | "author" | "size" | "priority"} RuleKind */
/** @typedef {{ id: string, when: { kind: RuleKind, value: string }, then: string }} CaseRule */
// A case's actions in its order, OPEN_ENTRY among them, and the ones its menu hides. The first
// one not hidden is the default the row's main button runs; OPEN_ENTRY there: it opens the PR or ticket.
// rules: in order; the first that fits a row picks its main action instead.
/** @typedef {{ order: string[], hidden: string[], rules: CaseRule[] } & CaseRun} CaseSettings */
/** @typedef {{ list: Skill[], cases: Partial<Record<Situation, CaseSettings>> }} TabSkills */
/** @typedef {Record<Tab, TabSkills>} Skills */
/** @typedef {"ask" | "worktree" | "here"} WhereToRun */
/** @typedef {"review" | "work" | "ask" | "other"} SkillRole */
// What clicking a row does: open its details, or only select it.
/** @typedef {"details" | "select"} RowClick */
// startCollapsed: list group ids ("pr-draft", "ln-Todo") that start collapsed when the panel loads.
/**
 * @typedef {{ shouldShowGithub: boolean, shouldShowLinear: boolean, shouldShowOncall: boolean, shouldShowFilterChips: boolean, whereToRun: WhereToRun,
 *   rowClick: RowClick, shouldNotifyBlocked: boolean, startCollapsed: string[], shouldMoveToInProgress: boolean, skills: Skills }} Settings
 */
/** @typedef {Tab} PanelTab */

// Ask: a built-in action, not a skill. Claude reads the PR or ticket and waits for questions.
export const ASK_ACTION = "ask";
const ASK_KEY = "q";
export const ASK_DESCRIPTION = "Ask: Claude reads it in a new tab here and waits for your questions. It changes no code.";
const ASK_ENTRY = { name: ASK_ACTION, key: ASK_KEY };
// Continue: a built-in On-call action. Claude picks up the triage's own session in a new tab.
export const CONTINUE_ACTION = "continue";
const CONTINUE_KEY = "c";
export const CONTINUE_DESCRIPTION = "Continue: the AI triage's Claude session, picked up in a new tab with everything it found.";
const CONTINUE_ENTRY = { name: CONTINUE_ACTION, key: CONTINUE_KEY };
const BUILT_IN_ACTIONS = [ASK_ACTION, CONTINUE_ACTION];
// In a case's order: the main button opens the PR or ticket. Not a valid skill name, so no skill clashes.
export const OPEN_ENTRY = "(open)";
// A case's after done: suggest nothing, the done agent's tab stays on the button. Not a valid skill name.
export const AFTER_DONE_NOTHING = "(nothing)";
// A PR row's link actions, entries a GitHub tab's list and cases hold beside skills: open its
// checks, its conflicting files, or ask its pending reviewers again. Not valid skill names either.
export const CHECKS_ENTRY = "(checks)";
export const CONFLICTS_ENTRY = "(conflicts)";
export const NUDGE_ENTRY = "(nudge)";
/** @typedef {"open" | "checks" | "conflicts" | "nudge"} LinkEntryId */
/** @type {{ id: LinkEntryId, name: string, label: string, short: string, icon: string }[]} */
export const LINK_ENTRIES = [
  { id: "open", name: OPEN_ENTRY, label: "Open in GitHub", short: "GitHub", icon: "github" },
  { id: "checks", name: CHECKS_ENTRY, label: "Open checks", short: "checks", icon: "link" },
  { id: "conflicts", name: CONFLICTS_ENTRY, label: "Open conflicting files", short: "conflicts", icon: "link" },
  { id: "nudge", name: NUDGE_ENTRY, label: "Nudge reviewers", short: "nudge", icon: "link" },
];
// The link entries a GitHub tab's list can add; Open is in every case already.
const ADDABLE_LINKS = LINK_ENTRIES.filter((e) => e.name !== OPEN_ENTRY).map((e) => e.name);

/** @param {string} name */
export const isLinkEntry = (name) => ADDABLE_LINKS.includes(name);
/** @param {string} name */
export const getLinkEntry = (name) => LINK_ENTRIES.find((e) => e.name === name) ?? null;
/** @type {CaseWhere[]} */
const CASE_WHERES = ["default", "worktree", "here", "background"];
/** @type {CaseRun} */
const DEFAULT_CASE_RUN = { where: "default", afterDone: null };
// The rules each tab's rows can be told apart by. On-call rows have none of these facts.
/** @type {Record<Tab, RuleKind[]>} */
export const RULE_KINDS = { github: ["check", "label", "author", "size"], linear: ["label", "priority"], oncall: [] };

// links: the link entries a case offers right after its default; every other case hides them.
/** @type {Record<Tab, { list: Skill[], defaults: Partial<Record<Situation, string>>, links?: Partial<Record<Situation, string[]>> }>} */
const BUILT_IN_SKILLS = {
  github: {
    list: [
      { name: "gh44-code-review", key: "r" },
      { name: "gh44-address-review", key: "a" },
      { name: "gh44-resolve-conflicts", key: "c" },
      { name: CHECKS_ENTRY, key: null },
      { name: CONFLICTS_ENTRY, key: "f" },
      { name: NUDGE_ENTRY, key: "n" },
      ASK_ENTRY,
    ],
    links: { myChecksFailing: [CHECKS_ENTRY], myConflicts: [CONFLICTS_ENTRY], myPullRequest: [NUDGE_ENTRY] },
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
  // On-call rows open the AI's report by default; Continue and the skills are a key or a click away.
  oncall: {
    list: [CONTINUE_ENTRY, { name: "gh44-debug", key: "d" }, ASK_ENTRY],
    defaults: {},
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
/** @type {{ id: OncallSituation, label: string }[]} */
export const ONCALL_SITUATIONS = [
  { id: "critical", label: "Critical, needs you" },
  { id: "high", label: "High, needs you" },
  { id: "needsYou", label: "Needs you, medium or low" },
  { id: "notForYou", label: "AI: not for you" },
  { id: "filtered", label: "Filtered without the AI" },
  { id: "failed", label: "Triage failed" },
];
const SITUATIONS = { github: GITHUB_SITUATIONS, linear: LINEAR_SITUATIONS, oncall: ONCALL_SITUATIONS };

// A case from one default (a skill, or none): it goes first and shows, then its links; the rest
// follow in the list's order, and with no default OPEN_ENTRY goes first. Link entries other than
// its links are hidden. Also reads cases saved before order.
/** @param {{ skill: unknown, hidden: string[], names: string[], links?: string[] }} params @returns {CaseSettings} */
const toCase = ({ skill, hidden, names, links = [] }) => {
  const isSkill = typeof skill === "string" && skill !== "" && names.includes(skill);
  const caseLinks = links.filter((name) => names.includes(name));
  const others = names.filter((name) => name !== skill && !caseLinks.includes(name));
  const otherLinks = others.filter(isLinkEntry);
  return {
    order: isSkill ? [String(skill), ...caseLinks, ...others, OPEN_ENTRY] : [OPEN_ENTRY, ...caseLinks, ...others],
    hidden: [...new Set([...hidden.filter((name) => name !== skill), ...otherLinks])],
    rules: [],
    ...DEFAULT_CASE_RUN,
  };
};

// A case fitted to the tab's list: entries not in it dropped, new skills added at the end (a new
// link entry hidden), OPEN_ENTRY always in the order and never hidden. An after done skill gone
// from the list: the default; a rule whose action left it: dropped.
/** @param {{ c: CaseSettings, names: string[] }} params @returns {CaseSettings} */
const fitCase = ({ c, names }) => {
  const isKnown = (/** @type {string} */ name) => name === OPEN_ENTRY || names.includes(name);
  const kept = [...new Set(c.order.filter(isKnown))];
  const missing = [...names, OPEN_ENTRY].filter((name) => !kept.includes(name));
  const isAfterDoneKnown = c.afterDone === AFTER_DONE_NOTHING || (c.afterDone !== null && names.includes(c.afterDone));
  return {
    order: [...kept, ...missing], hidden: [...new Set([...c.hidden.filter((name) => names.includes(name)), ...missing.filter(isLinkEntry)])],
    rules: c.rules.filter((rule) => names.includes(rule.then)), where: c.where, afterDone: isAfterDoneKnown ? c.afterDone : null,
  };
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
/** @param {{ tab: Tab, defaults: Partial<Record<string, unknown>>, names: string[], links?: Partial<Record<string, string[]>> }} params @returns {TabSkills["cases"]} */
const toCases = ({ tab, defaults, names, links = {} }) => Object.fromEntries(SITUATIONS[tab].map((sit) => [
  sit.id, toCase({ skill: defaults[sit.id], hidden: [], names, links: links[sit.id] ?? [] }),
]));

/** @param {Tab} tab @returns {TabSkills} */
const builtInTab = (tab) => {
  const { list, defaults, links } = BUILT_IN_SKILLS[tab];
  return { list, cases: toCases({ tab, defaults, names: list.map((e) => e.name), links }) };
};

/** @type {Record<Tab, TabSkills>} */
const DEFAULT_SKILLS = { github: builtInTab("github"), linear: builtInTab("linear"), oncall: builtInTab("oncall") };
/** @type {WhereToRun[]} */
const WHERE_TO_RUN = ["ask", "worktree", "here"];
/** @type {RowClick[]} */
const ROW_CLICKS = ["details", "select"];
// Taken by the panel itself: j/k move, o opens.
const RESERVED_KEYS = ["j", "k", "o"];
const KEY_LETTER = /^[a-z]$/;
// A skill name goes into the prompt as /name, so it is one word.
const SKILL_NAME = /^[\w:.-]+$/;

/** @param {string} name */
export const isValidSkillName = (name) => SKILL_NAME.test(name);
// A name a tab's list can hold: a skill, or on GitHub a link entry.
/** @param {{ name: string, tab: Tab }} params */
const isListName = ({ name, tab }) => isValidSkillName(name) || (tab === "github" && isLinkEntry(name));

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

// A size rule's value: a whole number of changed lines above 0.
const SIZE_VALUE = /^[1-9]\d*$/;

// A rule as saved, or null when it is not one this tab's rows can use.
/** @param {{ value: unknown, tab: Tab }} params @returns {CaseRule | null} */
const toRule = ({ value, tab }) => {
  const r = toRecord(value);
  const when = toRecord(r.when);
  const kind = RULE_KINDS[tab].find((k) => k === when.kind);
  const text = typeof when.value === "string" ? when.value.trim() : "";
  const isValue = kind === "size" ? SIZE_VALUE.test(text) : text !== "";
  if (!kind || !isValue || typeof r.id !== "string" || typeof r.then !== "string") return null;
  return { id: r.id, when: { kind, value: text }, then: r.then };
};

/** @param {{ value: unknown, tab: Tab }} params @returns {CaseRule[]} */
const toRules = ({ value, tab }) => (Array.isArray(value) ? value.map((rule) => toRule({ value: rule, tab })).filter((rule) => rule !== null) : []);

// A saved tab's cases: with their order, or from the one default saved before order, or from
// the defaults saved before cases.
/** @param {{ saved: Record<string, any>, tab: Tab, names: string[] }} params @returns {TabSkills["cases"]} */
function readSavedCases({ saved, tab, names }) {
  if (!saved.cases) return toCases({ tab, defaults: splitLegacyDefaults(toRecord(saved.defaults)), names });
  const cases = toRecord(saved.cases);
  return Object.fromEntries(SITUATIONS[tab].map((sit) => {
    const c = toRecord(cases[sit.id]);
    const hidden = toNames(c.hidden);
    const run = { where: CASE_WHERES.find((w) => w === c.where) ?? "default", afterDone: typeof c.afterDone === "string" ? c.afterDone : null };
    const order = Array.isArray(c.order) ? { order: toNames(c.order), hidden } : toCase({ skill: c.default, hidden, names });
    return [sit.id, { ...order, rules: toRules({ value: c.rules, tab }), ...run }];
  }));
}

// A list saved before a built-in action gets it at the end, on its key unless another skill has it.
/** @param {{ list: Skill[], name: string, key: string }} params @returns {Skill[]} */
const withBuiltIn = ({ list, name, key }) => {
  if (list.some((e) => e.name === name)) return list;
  return [...list, { name, key: list.some((e) => e.key === key) ? null : key }];
};
/** @param {Skill[]} list */
const withAsk = (list) => withBuiltIn({ list, name: ASK_ACTION, key: ASK_KEY });

// A saved tab's skills, read back safely: unknown entries dropped, cases only from its list.
/** @param {{ saved: unknown, tab: Tab }} params @returns {TabSkills | null} */
function readTabSkills({ saved, tab }) {
  const s = toRecord(saved);
  if (!Array.isArray(s.list)) return null;
  const read = withAsk(s.list.map(toRecord).filter((e) => typeof e.name === "string" && isListName({ name: e.name, tab }))
    .map((e) => ({
      name: String(e.name), key: typeof e.key === "string" && KEY_LETTER.test(e.key) ? e.key : null,
      ...(typeof e.repo === "string" && e.repo ? { repo: e.repo } : {}),
    })));
  const list = tab === "oncall" ? withBuiltIn({ list: read, name: CONTINUE_ACTION, key: CONTINUE_KEY }) : read;
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
    shouldShowOncall: s.shouldShowOncall !== false,
    whereToRun: WHERE_TO_RUN.find((w) => w === s.whereToRun) ?? "ask",
    rowClick: ROW_CLICKS.find((c) => c === s.rowClick) ?? "details",
    shouldShowFilterChips: s.shouldShowFilterChips !== false,
    shouldNotifyBlocked: s.shouldNotifyBlocked !== false,
    startCollapsed: toNames(s.startCollapsed),
    shouldMoveToInProgress: s.shouldMoveToInProgress !== false,
    skills: {
      github: readTabSkills({ saved: skills.github, tab: "github" }) ?? getDefaultTabSkills({ tab: "github", installedSkills }),
      linear: readTabSkills({ saved: skills.linear, tab: "linear" }) ?? getDefaultTabSkills({ tab: "linear", installedSkills }),
      oncall: readTabSkills({ saved: skills.oncall, tab: "oncall" }) ?? getDefaultTabSkills({ tab: "oncall", installedSkills }),
    },
  };
}

// The tab to show: the saved one while it is shown, else the other.
/** @param {{ saved: unknown, settings: Settings }} params @returns {PanelTab} */
export function getShownTab({ saved, settings }) {
  if (saved === "linear" && settings.shouldShowLinear) return "linear";
  if (saved === "oncall" && settings.shouldShowOncall) return "oncall";
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
  if (!isListName({ name, tab }) || current.list.some((e) => e.name === name)) return skills;
  return withTab({ skills, tab, tabSkills: fitCases({ tabSkills: { ...current, list: [...current.list, { name, key: null, ...(repo ? { repo } : {}) }] }, tab }) });
}

// Also clears it from every case, so no row runs a skill the menu no longer has. Built-in actions stay.
/** @param {{ skills: Skills, tab: Tab, skill: string }} params @returns {Skills} */
export function removeSkill({ skills, tab, skill }) {
  if (BUILT_IN_ACTIONS.includes(skill)) return skills;
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

// The case's run, or the default one for a case the tab lacks.
/** @param {{ skills: Skills, tab: Tab, situation: Situation }} params @returns {CaseRun} */
export function getCaseRun({ skills, tab, situation }) {
  const c = skills[tab].cases[situation];
  return c ? { where: c.where, afterDone: c.afterDone } : DEFAULT_CASE_RUN;
}

/** @param {{ skills: Skills, tab: Tab, situation: Situation, run: CaseRun }} params @returns {Skills} */
export const setCaseRun = ({ skills, tab, situation, run }) => withCase({ skills, tab, situation, update: (c) => ({ ...c, ...run }) });

// The case as built in: its default first, everything shown, the default run. Only the tab's
// current skills, so a skill removed from the tab stays removed.
/** @param {{ skills: Skills, tab: Tab, situation: Situation }} params @returns {Skills} */
export function resetCase({ skills, tab, situation }) {
  const names = skills[tab].list.map((e) => e.name);
  const builtIn = toCase({ skill: BUILT_IN_SKILLS[tab].defaults[situation], hidden: [], names, links: BUILT_IN_SKILLS[tab].links?.[situation] ?? [] });
  return withCase({ skills, tab, situation, update: () => fitCase({ c: builtIn, names }) });
}

// A skill for one case: a new one joins the tab hidden in its other cases; one the tab has shows in this case.
/** @param {{ skills: Skills, tab: Tab, situation: Situation, skill: string, repo?: string | null }} params @returns {Skills} */
export function addCaseSkill({ skills, tab, situation, skill, repo = null }) {
  const name = skill.trim();
  if (skills[tab].list.some((e) => e.name === name)) return setCaseHidden({ skills, tab, situation, skill: name, isHidden: false });
  const added = addSkill({ skills, tab, skill: name, repo });
  if (added === skills) return skills;
  return SITUATIONS[tab].reduce((next, sit) => setCaseHidden({ skills: next, tab, situation: sit.id, skill: name, isHidden: sit.id !== situation }), added);
}

const ID_RADIX = 36;
const ID_RANDOM_LENGTH = 6;
// A rule's id: unique, never one a removed rule had, so nothing keyed by it (its action select) carries over.
const newRuleId = () => `rule-${Date.now().toString(ID_RADIX)}-${Math.random().toString(ID_RADIX).slice(2, 2 + ID_RANDOM_LENGTH)}`;

// A rule for a case, last in its order. Refused: a kind its tab has not, an empty value (a size
// not a number above 0), or an action the tab has not.
/** @param {{ skills: Skills, tab: Tab, situation: Situation, when: CaseRule["when"], then: string }} params @returns {Skills} */
export function addCaseRule({ skills, tab, situation, when, then }) {
  const id = newRuleId();
  const rule = toRule({ value: { id, when, then }, tab });
  if (!rule || !skills[tab].list.some((e) => e.name === then)) return skills;
  return withCase({ skills, tab, situation, update: (c) => ({ ...c, rules: [...c.rules, rule] }) });
}

/** @param {{ skills: Skills, tab: Tab, situation: Situation, id: string }} params @returns {Skills} */
export const removeCaseRule = ({ skills, tab, situation, id }) => withCase({ skills, tab, situation, update: (c) => ({ ...c, rules: c.rules.filter((r) => r.id !== id) }) });

/** @param {{ skills: Skills, tab: Tab, situation: Situation, id: string, then: string }} params @returns {Skills} */
export function setCaseRuleAction({ skills, tab, situation, id, then }) {
  if (!skills[tab].list.some((e) => e.name === then)) return skills;
  return withCase({ skills, tab, situation, update: (c) => ({ ...c, rules: c.rules.map((r) => (r.id === id ? { ...r, then } : r)) }) });
}

// The collapsed groups once the panel loads: the ones left collapsed, plus those set to start collapsed.
/** @param {{ collapsed: unknown, startCollapsed: string[] }} params @returns {string[]} */
export const withStartCollapsed = ({ collapsed, startCollapsed }) => [...new Set([...toNames(collapsed), ...startCollapsed])];

// Starting work on a ticket that is not started yet moves it to In Progress, while the setting is on.
const NOT_STARTED_STAGES = ["backlog", "todo"];

/** @param {{ isOn: boolean, role: SkillRole, issue: { stateType: string, state: string } | null | undefined }} params */
export const shouldMoveIssue = ({ isOn, role, issue }) => isOn && role === "work" && Boolean(issue) && NOT_STARTED_STAGES.includes(getIssueStage(issue));

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

// An On-call row's case: how much it needs you, from the service's decision.
/** @param {{ outcome: string, stage: string, severity: string | null, isNotified: boolean }} decision @returns {OncallSituation} */
export function getOncallSituation(decision) {
  if (decision.outcome === "failed") return "failed";
  if (decision.outcome === "reported" && decision.isNotified) {
    if (decision.severity === "critical") return "critical";
    return decision.severity === "high" ? "high" : "needsYou";
  }
  if (decision.outcome === "reported") return "needsYou";
  return decision.stage === "ai" ? "notForYou" : "filtered";
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

// A case's skills that belong to it: today's default and the built-in one, so a skill keeps its
// case when the default changes.
/** @param {{ skills: Skills, tab: Tab, situation: Situation }} params @returns {string[]} */
export const getSituationSkills = ({ skills, tab, situation }) => [getDefaultSkill({ skills, tab, situation }), BUILT_IN_SKILLS[tab].defaults[situation]]
  .filter((name) => typeof name === "string");

/** @param {{ skills: Skills, situation: "reviewMine" | "reviewOthers" }} params */
const isReviewSkillOf = ({ skills, situation }) => {
  const names = getSituationSkills({ skills, tab: "linear", situation });
  /** @param {string} skill */
  return (skill) => skill !== ASK_ACTION && names.includes(skill);
};

// Whose PR a row is about. none: a ticket without one.
/** @typedef {"mine" | "others" | "none"} PullRequestOwner */
/** @typedef {{ mine: string[], others: string[] }} ReviewSkills */

// The review skills of a tab's PRs: mine (address-review) and someone else's (code-review). Ask is never one.
/** @param {{ skills: Skills, tab: Tab }} params @returns {ReviewSkills} */
export function getReviewSkills({ skills, tab }) {
  /** @param {Situation} situation */
  const of = (situation) => getSituationSkills({ skills, tab, situation }).filter((name) => name !== ASK_ACTION);
  switch (tab) {
    case "github": return { mine: of("myPullRequest"), others: of("othersPullRequest") };
    case "linear": return { mine: of("reviewMine"), others: of("reviewOthers") };
    case "oncall": return { mine: [], others: [] };
    default: {
      /** @type {never} */
      const unknownTab = tab;
      return unknownTab;
    }
  }
}

// A review skill applies only to its side's PR; any other skill applies everywhere.
/** @param {{ skill: string, reviewSkills: ReviewSkills, pullRequest: PullRequestOwner }} params */
export function isSkillOffered({ skill, reviewSkills, pullRequest }) {
  const isMine = reviewSkills.mine.includes(skill);
  const isOthers = reviewSkills.others.includes(skill);
  if (!isMine && !isOthers) return true;
  return (isMine && pullRequest === "mine") || (isOthers && pullRequest === "others");
}

/** @param {{ isMyPullRequest: boolean, prUrl: string | null }} issue @returns {PullRequestOwner} */
export const getTicketPullRequest = (issue) => {
  if (issue.isMyPullRequest) return "mine";
  return issue.prUrl ? "others" : "none";
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

// Keys on a selected row that start a skill directly: key letter -> skill. actions: the row's
// suggested skills; the menu's other skills have no key on the row.
/** @param {{ skills: Skills, tab: Tab, actions: string[] }} params @returns {Record<string, string>} */
export const getKeySkills = ({ skills, tab, actions }) => Object.fromEntries(skills[tab].list
  .filter((s) => s.key && actions.includes(s.name)).map((s) => [s.key, s.name]));

// "gh44-plan" -> "plan"; a skill without the prefix keeps its name.
/** @param {string} skill */
export const shortSkill = (skill) => skill.replace(/^gh44-/, "");

/** @param {TabSkills} tab @returns {TabSkills} */
const copyTab = (tab) => ({
  list: tab.list.map((e) => ({ ...e })),
  cases: Object.fromEntries(Object.entries(tab.cases).map(([id, c]) => [id, { ...c, order: [...c.order], hidden: [...c.hidden], rules: c.rules.map((r) => ({ ...r, when: { ...r.when } })) }])),
});

// The suggested setup: the gh44 skills from gh44-brain on both tabs, with their keys and defaults.
// A fresh copy, so an edit never reaches the built-in one.
/** @returns {Skills} */
export const getGh44Setup = () => ({ github: copyTab(DEFAULT_SKILLS.github), linear: copyTab(DEFAULT_SKILLS.linear), oncall: copyTab(DEFAULT_SKILLS.oncall) });

// Link entries leave the comparison, so a gh44 setup saved before them still reads as in use.
/** @param {{ a: string[], b: string[] }} params */
const isSameList = ({ a, b }) => {
  const [left, right] = [a.filter((name) => !isLinkEntry(name)), b.filter((name) => !isLinkEntry(name))];
  return left.length === right.length && left.every((name, i) => name === right[i]);
};

/** @param {{ a?: CaseSettings, b?: CaseSettings }} params */
const isSameCase = ({ a, b }) => isSameList({ a: a?.order ?? [], b: b?.order ?? [] }) && isSameList({ a: a?.hidden ?? [], b: b?.hidden ?? [] })
  && a?.where === b?.where && a?.afterDone === b?.afterDone && JSON.stringify(a?.rules ?? []) === JSON.stringify(b?.rules ?? []);

/** @param {{ a: TabSkills, b: TabSkills, tab: Tab }} params */
const isSameTab = ({ a, b, tab }) => {
  const [left, right] = [a.list.filter((e) => !isLinkEntry(e.name)), b.list.filter((e) => !isLinkEntry(e.name))];
  return left.length === right.length
    && left.every((e, i) => e.name === right[i].name && e.key === right[i].key)
    && SITUATIONS[tab].every((sit) => isSameCase({ a: a.cases[sit.id], b: b.cases[sit.id] }));
};

/** @param {{ skills: Skills }} params */
export function isUsingGh44Setup({ skills }) {
  return isSameTab({ a: skills.github, b: DEFAULT_SKILLS.github, tab: "github" })
    && isSameTab({ a: skills.linear, b: DEFAULT_SKILLS.linear, tab: "linear" })
    && isSameTab({ a: skills.oncall, b: DEFAULT_SKILLS.oncall, tab: "oncall" });
}

// How many of the skills (each counted once, across both tabs, Ask and repo skills aside) are installed.
/** @param {{ skills: Skills, installedSkills: string[] }} params */
export function countInstalledSkills({ skills, installedSkills }) {
  const names = new Set([...skills.github.list, ...skills.linear.list, ...skills.oncall.list].filter((e) => !e.repo).map((e) => e.name).filter((name) => !BUILT_IN_ACTIONS.includes(name) && !isLinkEntry(name)));
  return { installed: [...names].filter((name) => installedSkills.includes(name)).length, total: names.size };
}

// A skill can run when it is in ~/.claude/skills, or a plugin skill ("plugin:skill") that is not
// listed there. Ask and link entries are built in. null: not listed yet, all of them.
/** @param {{ skill: string, installedSkills: string[] | null }} params */
export const canRun = ({ skill, installedSkills }) =>
  !installedSkills || BUILT_IN_ACTIONS.includes(skill) || isLinkEntry(skill) || skill.includes(":") || installedSkills.includes(skill);

// A repo skill runs only in its repo, while the repo's .claude has it. Any other entry: canRun.
/** @param {{ entry: Skill, installedSkills: string[] | null, repo: RepoSkills | null }} params */
export function canRunEntry({ entry, installedSkills, repo }) {
  if (!entry.repo) return canRun({ skill: entry.name, installedSkills });
  return entry.repo === repo?.name && (!repo.skills || repo.skills.includes(entry.name));
}

// An installed skill to add: not a repo's own.
/** @param {string} name @returns {{ name: string, repo: string | null }} */
const toInstalledCandidate = (name) => ({ name, repo: null });

// Skills a tab can add: the focused repo's own, then the installed ones, without the tab's names
// and only those holding the typed text.
/**
 * @param {{ names: string[], installedSkills: string[] | null, repo: RepoSkills, typed: string }} params
 * @returns {{ name: string, repo: string | null }[]}
 */
export function getSkillCandidates({ names, installedSkills, repo, typed }) {
  const text = typed.trim().toLowerCase();
  const repoSkills = repo.name ? (repo.skills ?? []).map((name) => ({ name, repo: repo.name })) : [];
  const installed = (installedSkills ?? []).filter((name) => !repo.skills?.includes(name)).map(toInstalledCandidate);
  return [...repoSkills, ...installed].filter((c) => !names.includes(c.name) && c.name.toLowerCase().includes(text));
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
  return { github: runnable(skills.github, "github"), linear: runnable(skills.linear, "linear"), oncall: runnable(skills.oncall, "oncall") };
}

/** @type {PanelTab[]} */
const PANEL_TABS = ["github", "linear", "oncall"];

// The header's tab order: the saved one, without unknown or repeated tabs, then any it lacks.
/** @param {unknown} saved @returns {PanelTab[]} */
export function getTabOrder(saved) {
  const listed = Array.isArray(saved) ? PANEL_TABS.filter((tab) => saved.includes(tab)).sort((a, b) => saved.indexOf(a) - saved.indexOf(b)) : [];
  return [...listed, ...PANEL_TABS.filter((tab) => !listed.includes(tab))];
}

// A tab dropped at an index of the order (before the tab there; the length: last).
/** @param {{ order: PanelTab[], tab: PanelTab, to: number }} params @returns {PanelTab[]} */
export function moveTab({ order, tab, to }) {
  const from = order.indexOf(tab);
  if (from === -1 || to === from || to === from + 1) return order;
  const rest = order.filter((t) => t !== tab);
  const at = Math.max(0, Math.min(to > from ? to - 1 : to, rest.length));
  return [...rest.slice(0, at), tab, ...rest.slice(at)];
}

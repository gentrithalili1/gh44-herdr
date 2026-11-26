// What a row offers: its split button's main action for its case and agent, its ▾ menu and its details.
// Pure, so tests/ can load it without Herdr; main.js wires each kind to its run.
import {
  shortSkill, isSkillOffered, getSituationSkills, getLinearSituation, getOncallSituation, getWhereToRun, getLinkEntry, isLinkEntry, getGithubSituation, getReviewSkills, getTicketPullRequest, ASK_ACTION, ASK_DESCRIPTION, AFTER_DONE_NOTHING, CONTINUE_ACTION, OPEN_ENTRY, CHECKS_ENTRY, CONFLICTS_ENTRY, NUDGE_ENTRY,
} from "./settings.js";
import { isMyPullRequest, PRIORITY_OPTIONS, UNASSIGNED } from "./filters.js";
import { getDecidedBy } from "./oncall/decisions.js";

/** @typedef {import("herdr").Status} AgentStatus */
/** @typedef {{ status: AgentStatus, tabName: string, since: number | null }} RowAgent */
/** @typedef {{ label: string, icon: string }} RowLink */
/** @typedef {import("./settings.js").WhereToRun} RunPlace */
/** @typedef {"preparing" | "agent" | "merge" | "resume" | "link" | "nudge" | "skill"} RowActionKind */
// An On-call row's: a re-run triaging, an agent, the case's skill, the AI's report, the issue in its tracker.
/** @typedef {"triaging" | "agent" | "skill" | "report" | "link"} OncallActionKind */
// suggested: filled, a step to take (a skill, a merge). quiet: outlined (an agent, a link, a space).
// alert: an agent that needs you.
/** @typedef {"suggested" | "quiet" | "alert"} RowActionStyle */
// The line above the button while an agent is on the row. elapsed: null when Herdr gives no start time.
/** @typedef {{ tone: AgentStatus, text: string, elapsed: string | null }} RowStatus */
// url: the page a link opens; null for the row's own link (its PR or ticket).
/**
 * @typedef {{ kind: RowActionKind, label: string, icon: string, tip: string, style: RowActionStyle, isLoading: boolean,
 *   status: RowStatus | null, url: string | null }} RowAction
 */

const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
// Herdr's typings give no unit for a tab's working_since and changed_at. Below this they can only
// be seconds since the epoch (ms passed it in 2001), so a wrong unit never shows a huge time.
const EPOCH_MS_FLOOR = 1e12;

/** @param {number} time */
const toEpochMs = (time) => (time < EPOCH_MS_FLOOR ? time * SECOND_MS : time);

// "12m", "2h", "3d".
/** @param {number} ms */
const formatElapsed = (ms) => {
  const minutes = Math.max(1, Math.floor(ms / MINUTE_MS));
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  return hours < HOURS_PER_DAY ? `${hours}h` : `${Math.floor(hours / HOURS_PER_DAY)}d`;
};

/** @param {{ agent: RowAgent, now: number }} params @returns {RowStatus} */
const getAgentStatus = ({ agent, now }) => {
  const elapsed = agent.since === null ? null : formatElapsed(now - toEpochMs(agent.since));
  switch (agent.status) {
    case "working": return { tone: "working", text: "working", elapsed };
    case "blocked": return { tone: "blocked", text: "needs you", elapsed };
    case "idle": return { tone: "idle", text: "idle", elapsed: null };
    case "done": return { tone: "done", text: "done", elapsed: null };
    default: {
      /** @type {never} */
      const unknownStatus = agent.status;
      return unknownStatus;
    }
  }
};

// What the main button does with its skill, on hover.
/** @param {{ skill: string, target: { worktree?: string }, place: RunPlace, isBackground: boolean }} params */
const getSkillTip = ({ skill, target, place, isBackground }) => {
  if (skill === ASK_ACTION) return ASK_DESCRIPTION;
  if (place === "worktree") return target.worktree ? `/${skill} in this ticket's worktree (${target.worktree.split("/").pop()})` : `/${skill} in a new worktree`;
  if (place === "ask") return `/${skill}: asks first, new worktree or this space`;
  return isBackground ? `/${skill} in a background tab` : `/${skill} in a new tab here`;
};

// skill: what the button runs (kind "skill"), else null.
/** @typedef {Omit<RowAction, "kind"> & { kind: OncallActionKind, skill: string | null }} OncallRowAction */

/**
 * @template {string} Kind
 * @param {{ kind: Kind, label: string, icon: string, tip: string } & Partial<Omit<RowAction, "kind">>} action
 * @returns {Omit<RowAction, "kind"> & { kind: Kind }}
 */
const toAction = (action) => ({ isLoading: false, status: null, style: "quiet", url: null, ...action });

// A done agent hands the button to its case's after done: a skill, or AFTER_DONE_NOTHING to keep its tab.
/** @param {{ agent: RowAgent | null, afterDone: import("./settings.js").AfterDone, skill: string | null }} params */
const getNextStep = ({ agent, afterDone, skill }) => {
  const isDone = agent?.status === "done";
  return {
    skill: isDone && afterDone !== null && afterDone !== AFTER_DONE_NOTHING ? afterDone : skill,
    isKeepingAgent: isDone && afterDone === AFTER_DONE_NOTHING,
  };
};

// An agent that needs you, one at work (the button says so), or one still on the row (a done one
// only when its tab stays on the button). Each goes to the agent's tab.
/** @param {{ agent: RowAgent | null, isKeepingAgent: boolean }} params */
const getAgentAction = ({ agent, isKeepingAgent }) => {
  if (agent?.status === "blocked") return toAction({ kind: "agent", label: "answer", icon: "resume", style: "alert", tip: `Answer ${agent.tabName}` });
  if (agent?.status === "working") return toAction({ kind: "agent", label: "working", icon: "resume", tip: `${agent.tabName} is working. Go to its tab` });
  if (agent && (agent.status !== "done" || isKeepingAgent)) return toAction({ kind: "agent", label: "open tab", icon: "resume", tip: `Go to ${agent.tabName}` });
  return null;
};

// First that fits: a worktree being prepared, an agent on it (not done), a PR ready to merge, a space
// on its branch, no skill for its case (open the PR or ticket), a link entry the row has (its page,
// or the nudge), then the case's skill. A done agent leaves the button to the case's after done
// (afterDone: its main action when null, AFTER_DONE_NOTHING keeps the agent's tab), skips the space
// and shows in the status line.
// skill: a skill or a link entry. links: the row's link entries (getPullRequestLinks).
// Returns, as skill, the skill or link entry the button runs (kind skill, link or nudge), else null.
/**
 * @param {{
 *   isPreparing: boolean, agent: RowAgent | null, spaceName: string | null, isMergeReady: boolean, skill: string | null,
 *   link: RowLink, place: RunPlace, isBackground: boolean, target: { label: string, worktree?: string }, now?: number,
 *   afterDone?: import("./settings.js").AfterDone, links?: RowLinkEntry[],
 * }} params
 * @returns {RowAction & { skill: string | null }}
 */
export function getRowAction({ agent, now = Date.now(), afterDone = null, ...facts }) {
  const status = agent ? getAgentStatus({ agent, now }) : null;
  const next = getNextStep({ agent, afterDone, skill: facts.skill });
  const main = getMainAction({ agent, ...facts, ...next });
  const isRunningEntry = main.kind === "skill" || main.kind === "nudge" || (main.kind === "link" && next.skill !== null && main.url !== null);
  return { ...main, status, skill: isRunningEntry ? next.skill : null };
}

/** @param {Omit<Parameters<typeof getRowAction>[0], "now" | "afterDone"> & { isKeepingAgent: boolean }} params @returns {RowAction} */
function getMainAction({ isPreparing, agent, spaceName, isMergeReady, skill, link, place, isBackground, target, isKeepingAgent, links = [] }) {
  if (isPreparing) return toAction({ kind: "preparing", label: "preparing", icon: "branch", isLoading: true, tip: `Preparing the ${target.label} worktree` });
  const agentAction = getAgentAction({ agent, isKeepingAgent });
  if (agentAction) return agentAction;
  if (isMergeReady) return toAction({ kind: "merge", label: "merge", icon: "github", style: "suggested", tip: "Open on GitHub to merge" });
  if (spaceName && agent?.status !== "done") return toAction({ kind: "resume", label: "resume", icon: "resume", tip: `Go to ${spaceName}` });
  const linkLook = skill ? getLinkEntry(skill) : null;
  const linkEntry = linkLook ? links.find((l) => l.entry === skill) : undefined;
  if (!skill || (linkLook && !linkEntry)) return toAction({ kind: "link", label: "open", icon: link.icon, tip: `${link.label} (no skill picked for this row in ⚙ settings)` });
  if (linkLook && linkEntry) return toAction({ kind: linkEntry.url ? "link" : "nudge", label: linkLook.short, icon: linkEntry.icon, tip: linkEntry.tip, url: linkEntry.url });
  return toAction({
    kind: "skill", label: shortSkill(skill), icon: place === "worktree" ? "branch" : "play", style: "suggested",
    tip: getSkillTip({ skill, target, place, isBackground }),
  });
}

// ---------- On-call rows ----------

/** @type {import("./settings.js").Situation[]} */
const NEEDS_YOU_SITUATIONS = ["critical", "high", "needsYou"];

/** @param {string} skill */
const getOncallSkillTip = (skill) => {
  if (skill === CONTINUE_ACTION) return "Continue the triage in Claude";
  if (skill === ASK_ACTION) return "Ask Claude about it";
  return `/${skill} on this issue`;
};

// An On-call row's main action, first that fits: a re-run triaging, an agent on the issue, the case's
// skill (or its after done once the agent is done), the AI's report (filled while it needs you), the issue.
/**
 * @param {{ situation: import("./settings.js").Situation, isTriaging: boolean, agent: RowAgent | null, skill: string | null,
 *   hasReport: boolean, trackerName: string, afterDone?: import("./settings.js").AfterDone, now?: number }} params
 * @returns {OncallRowAction}
 */
export function getOncallRowAction({ situation, isTriaging, agent, skill, hasReport, trackerName, afterDone = null, now = Date.now() }) {
  const status = agent ? getAgentStatus({ agent, now }) : null;
  /** @returns {Omit<OncallRowAction, "skill">} */
  const getMain = () => {
    if (isTriaging) return toAction({ kind: "triaging", label: "triaging", icon: "refresh", isLoading: true, tip: "Re-running the triage" });
    const next = getNextStep({ agent, afterDone, skill });
    const agentAction = getAgentAction({ agent, isKeepingAgent: next.isKeepingAgent });
    if (agentAction) return agentAction;
    if (next.skill) return toAction({ kind: "skill", label: shortSkill(next.skill), icon: "play", style: "suggested", tip: getOncallSkillTip(next.skill) });
    if (hasReport) {
      return toAction({
        kind: "report", label: "report", icon: "resume", style: NEEDS_YOU_SITUATIONS.includes(situation) ? "suggested" : "quiet",
        tip: "Open the AI's report beside your terminal",
      });
    }
    return toAction({ kind: "link", label: "open", icon: "oncall", tip: `Open in ${trackerName}` });
  };
  const main = getMain();
  return { ...main, status, skill: main.kind === "skill" ? getNextStep({ agent, afterDone, skill }).skill : null };
}

// Where a case's skill runs and whether its tab opens in the background. An existing worktree
// takes the default and New worktree picks; Ask always reads in front, here; a review skill and a
// row without a branch to branch from never make a worktree.
/**
 * @param {{ caseWhere: import("./settings.js").CaseWhere, where: import("./settings.js").WhereToRun, role: import("./settings.js").SkillRole,
 *   hasWorktreeTarget: boolean, hasWorktree: boolean, isBackgroundDefault: boolean }} params
 * @returns {{ place: RunPlace, isBackground: boolean }}
 */
export function getCaseRunPlace({ caseWhere, where, role, hasWorktreeTarget, hasWorktree, isBackgroundDefault }) {
  if (role === "ask") return { place: "here", isBackground: false };
  const isWorktreeRun = caseWhere === "default" || caseWhere === "worktree";
  if (hasWorktree && isWorktreeRun) return { place: "worktree", isBackground: false };
  switch (caseWhere) {
    case "default": return { place: getWhereToRun({ where, role, hasWorktreeTarget }), isBackground: isBackgroundDefault };
    case "worktree": return { place: getWhereToRun({ where: "worktree", role, hasWorktreeTarget }), isBackground: false };
    case "here": return { place: "here", isBackground: false };
    case "background": return { place: "here", isBackground: true };
    default: {
      /** @type {never} */
      const unknownWhere = caseWhere;
      return unknownWhere;
    }
  }
}

// ---------- agents that need you ----------

/** @typedef {{ id: string, ref: string, title: string, status: AgentStatus | null }} WatchedRow */
/** @typedef {{ id: string, ref: string, title: string }} BlockedNotice */

// The rows whose agent just turned to needing you, and each row's agent status for the next call.
// A row first seen already blocked (the panel just loaded) does not count.
/** @param {{ previous: Record<string, AgentStatus>, rows: WatchedRow[] }} params @returns {{ notices: BlockedNotice[], next: Record<string, AgentStatus> }} */
export function getNewlyBlocked({ previous, rows }) {
  const watched = rows.flatMap((row) => (row.status ? [{ ...row, status: row.status }] : []));
  const notices = watched.filter((row) => row.status === "blocked" && previous[row.id] !== undefined && previous[row.id] !== "blocked")
    .map(({ id, ref, title }) => ({ id, ref, title }));
  return { notices, next: Object.fromEntries(watched.map((row) => [row.id, row.status])) };
}

// An On-call row's own actions: open the AI's report, continue its Claude session, re-run the
// triage, mark it seen or unseen.
/** @typedef {"report" | "continue" | "rerun" | "seen" | "unseen"} OncallMenuId */
// reason: why a case rule picked it (the first suggested only).
/**
 * @typedef {{ kind: "skill", skill: string, key: string | null, reason?: string | null }
 *   | ({ kind: "link" } & RowLink & { url: string })
 *   | ({ kind: "linkEntry", key: string | null, reason: string | null } & RowLinkEntry)
 *   | { kind: "oncall", id: OncallMenuId, key: string | null }
 *   | { kind: "agent" }
 *   | { kind: "details" }
 *   | { kind: "editCase" }
 *   | { kind: "command", id: string, label: string, icon: string, command: string }} RowMenuItem
 */
/** @typedef {{ id: "suggested" | "other" | "links" | "more", title: string | null, items: RowMenuItem[] }} RowMenuSection */

// A row's ▾ menu, in sections: the case's actions (with the keys that start them on this row, the
// first with a rule's reason), the tab's other skills (also those the case hides, but no review
// skill that can't apply to the row's PR), its links and link entries the case does not suggest
// (and extras, a tab's own actions), then Details and Edit this case. Empty ones leave.
/**
 * @param {{ suggested: string[], list: { name: string, key: string | null }[], links: (RowLink & { url: string })[], hasAgent: boolean,
 *   reviewSkills: import("./settings.js").ReviewSkills, pullRequest: import("./settings.js").PullRequestOwner, extras?: RowMenuItem[],
 *   entryLinks?: RowLinkEntry[], reason?: string | null }} params
 * @returns {RowMenuSection[]}
 */
export function getRowMenu({ suggested, list, links, hasAgent, reviewSkills, pullRequest, extras = [], entryLinks = [], reason = null }) {
  /** @param {{ skill: string, key: string | null, reason?: string | null }} params @returns {RowMenuItem} */
  const skillItem = ({ skill, key, reason: why = null }) => {
    const entryLink = entryLinks.find((l) => l.entry === skill);
    return entryLink ? { kind: "linkEntry", ...entryLink, key, reason: why } : { kind: "skill", skill, key, reason: why };
  };
  /** @param {RowLink & { url: string }} link @returns {RowMenuItem} */
  const linkItem = (link) => ({ kind: "link", ...link });
  /** @type {RowMenuItem[]} */
  const agentItems = hasAgent ? [{ kind: "agent" }] : [];
  /** @param {string} skill */
  const keyOf = (skill) => list.find((s) => s.name === skill)?.key ?? null;
  /** @type {RowMenuSection[]} */
  const sections = [
    { id: "suggested", title: "Suggested for this case", items: suggested.map((skill, index) => skillItem({ skill, key: keyOf(skill), reason: index === 0 ? reason : null })) },
    {
      id: "other", title: "Other skills",
      items: list.filter((s) => !suggested.includes(s.name) && !isLinkEntry(s.name) && isSkillOffered({ skill: s.name, reviewSkills, pullRequest }))
        .map((s) => skillItem({ skill: s.name, key: null })),
    },
    {
      id: "links", title: null,
      items: [...links.map(linkItem), ...entryLinks.filter((l) => !suggested.includes(l.entry)).map((l) => skillItem({ skill: l.entry, key: null })), ...extras, ...agentItems],
    },
    { id: "more", title: null, items: [{ kind: "details" }, { kind: "editCase" }] },
  ];
  return sections.filter((section) => section.items.length > 0);
}

// An On-call row's ▾ menu: its case's skills and the other skills like any row; Continue in Claude
// (when the AI left a session) goes with the report, the issue's tracker, re-run and seen.
// isSeen: null for a row that never needed you.
/**
 * @param {{ suggested: string[], list: { name: string, key: string | null }[], hasReport: boolean, hasSession: boolean, isSeen: boolean | null,
 *   trackerLink: RowLink & { url: string }, hasAgent: boolean }} params
 * @returns {RowMenuSection[]}
 */
export function getOncallRowMenu({ suggested, list, hasReport, hasSession, isSeen, trackerLink, hasAgent }) {
  /** @param {OncallMenuId} id @returns {RowMenuItem} */
  const item = (id) => ({ kind: "oncall", id, key: id === "continue" ? list.find((s) => s.name === CONTINUE_ACTION)?.key ?? null : null });
  /** @type {RowMenuItem[]} */
  const extras = [
    ...(hasReport ? [item("report")] : []),
    { kind: "link", ...trackerLink },
    ...(hasSession ? [item("continue")] : []),
    item("rerun"),
    ...(isSeen === null ? [] : [item(isSeen ? "unseen" : "seen")]),
  ];
  return getRowMenu({
    suggested: suggested.filter((skill) => skill !== CONTINUE_ACTION), list: list.filter((s) => s.name !== CONTINUE_ACTION), links: [], hasAgent,
    reviewSkills: { mine: [], others: [] }, pullRequest: "none", extras,
  });
}

/** @typedef {import("./oncall/decisions.js").Decision} Decision */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** @param {number} n */
const twoDigits = (n) => String(n).padStart(2, "0");

// When something happened, in local time: "14:32" today, "Nov 24 14:32" before. Herdr's runtime has no Intl.
/** @param {{ at: number, now: number }} params */
export const formatClock = ({ at, now }) => {
  const date = new Date(at);
  const time = `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
  return date.toDateString() === new Date(now).toDateString() ? time : `${MONTHS[date.getMonth()]} ${date.getDate()} ${time}`;
};

/** @param {{ count: number, word: string }} params */
const plural = ({ count, word }) => `${count} ${word}${count === 1 ? "" : "s"}`;

// An On-call row's meta facts, only those it has: new (unseen), when it was decided ("14:32 (2h ago)"),
// its project, a regression, events and users.
/** @param {{ decision: Decision, isUnseen: boolean, now?: number }} params @returns {string[]} */
export function getDecisionFacts({ decision: d, isUnseen, now = Date.now() }) {
  const isRegression = d.kind === "regressed" || d.kind === "escalating";
  const impact = [d.count > 0 ? plural({ count: d.count, word: "event" }) : null, d.userCount > 0 ? plural({ count: d.userCount, word: "user" }) : null]
    .filter((part) => part !== null).join(" · ");
  const decidedAt = Date.parse(d.decidedAt);
  const time = Number.isFinite(decidedAt) ? `${formatClock({ at: decidedAt, now })} (${formatElapsed(now - decidedAt)} ago)` : null;
  const facts = [isUnseen ? "new" : null, time, d.project || null, isRegression ? d.kind : null, impact || null];
  return facts.filter((fact) => fact !== null);
}

/** @type {Record<string, string>} */
const CI_FACT = { passing: "checks passing", failing: "checks failing", pending: "checks running" };

/** @typedef {"fix" | "merge" | "rereview" | "review" | "waiting" | "reviewed" | "draft"} PullRequestGroupId */
/**
 * @typedef {{ author: string, hasConflicts: boolean, ci: string, decision: string | null, createdAt: string | null,
 *   additions: number, deletions: number }} PullRequestFactsShape
 */

// "2h", "3d": how old a PR is. null: no or a bad date.
/** @param {{ iso: string | null, now: number }} params */
const formatAge = ({ iso, now }) => {
  const ms = iso ? now - Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms)) return null;
  return ms < DAY_MS ? `${Math.max(1, Math.round(ms / HOUR_MS))}h` : `${Math.round(ms / DAY_MS)}d`;
};

// Why a PR is in its group, then the bits worth a glance: "conflicts · checks failing", "ana · 2h · +44 −6".
// CI shows once, as the reason or as a bit after it.
/**
 * @param {{ pr: PullRequestFactsShape, groupId: PullRequestGroupId, login: string | null, now?: number }} params
 * @returns {string[]}
 */
export function getPullRequestFacts({ pr, groupId, login, now = Date.now() }) {
  const checks = CI_FACT[pr.ci] ?? null;
  /** @returns {(string | null)[]} */
  const getReasons = () => {
    switch (groupId) {
      case "fix": return [pr.hasConflicts ? "conflicts" : null, pr.ci === "failing" ? checks : null, pr.decision === "CHANGES_REQUESTED" ? "changes requested" : null];
      case "merge": return ["approved"];
      case "waiting": return [pr.ci === "pending" ? checks : "waiting for review"];
      case "rereview": return [pr.author, "asked again"];
      case "reviewed": return [pr.author, "you reviewed"];
      case "review": return [pr.author];
      case "draft": return [isMyPullRequest({ pr, login }) ? null : pr.author];
      default: {
        /** @type {never} */
        const unknownGroup = groupId;
        return unknownGroup;
      }
    }
  };
  const reasons = getReasons().filter((r) => typeof r === "string" && r !== "");
  const ci = checks && pr.ci !== "passing" && !reasons.includes(checks) ? [checks] : [];
  const age = formatAge({ iso: pr.createdAt, now });
  return [...reasons, ...ci, ...(age ? [age] : []), `+${pr.additions} −${pr.deletions}`];
}

// The status facts a strip colors: trouble red, waiting amber, good green.
/** @type {Record<string, FactTone>} */
const FACT_TONE = {
  conflicts: "danger", "checks failing": "danger", "changes requested": "danger", "triage failed": "danger",
  "checks running": "warning", regressed: "warning", escalating: "warning",
  approved: "success", "checks passing": "success",
};
const DIFF_FACT = /^\+(\d+) −(\d+)$/;

// A meta fact in colored parts: a diff ("+44 −6") green and red, a known status in its tone, else plain.
/** @param {string} fact @returns {FactPart[]} */
export function getFactParts(fact) {
  const diff = DIFF_FACT.exec(fact);
  if (diff) return [{ text: `+${diff[1]}`, tone: "success" }, { text: `−${diff[2]}`, tone: "danger" }];
  return [{ text: fact, tone: FACT_TONE[fact] ?? null }];
}

// A meta line's facts as runs: plain facts next to each other join into one text, a colored fact
// stands alone in its parts.
/** @typedef {{ kind: "plain", text: string } | { kind: "colored", parts: FactPart[] }} FactSegment */
/** @param {string[]} facts @returns {FactSegment[]} */
export function getFactSegments(facts) {
  return facts.reduce((/** @type {FactSegment[]} */ segments, fact) => {
    const parts = getFactParts(fact);
    const last = segments[segments.length - 1];
    if (parts.some((part) => part.tone !== null)) return [...segments, { kind: "colored", parts }];
    if (last?.kind === "plain") return [...segments.slice(0, -1), { kind: "plain", text: `${last.text} · ${fact}` }];
    return [...segments, { kind: "plain", text: fact }];
  }, []);
}

// ---------- link entries ----------

// A row's link action: what it opens (url), or null for the nudge, which runs gh.
/** @typedef {{ entry: string, label: string, icon: string, tip: string, url: string | null }} RowLinkEntry */

// "ana", "ana and bo", "ana, bo and cy". Herdr's runtime has no Intl.
/** @param {string[]} names */
export const formatNames = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** @param {{ name: string, tip: string, url: string | null }} params @returns {RowLinkEntry[]} */
const toLinkEntry = ({ name, tip, url }) => {
  const look = getLinkEntry(name);
  return look ? [{ entry: name, label: look.label, icon: look.icon, tip, url }] : [];
};

// A PR row's link actions: its checks, its conflicting files while it has conflicts, and the nudge
// on my PR while reviewers it asked have not reviewed yet.
/**
 * @param {{ pr: { url: string, author: string, hasConflicts: boolean, requestedUsers: string[] }, login: string | null }} params
 * @returns {RowLinkEntry[]}
 */
export function getPullRequestLinks({ pr, login }) {
  const canNudge = isMyPullRequest({ pr, login }) && pr.requestedUsers.length > 0;
  return [
    ...toLinkEntry({ name: CHECKS_ENTRY, tip: "Open the PR's checks on GitHub", url: `${pr.url}/checks` }),
    ...(pr.hasConflicts ? toLinkEntry({ name: CONFLICTS_ENTRY, tip: "Open the conflicting files on GitHub", url: `${pr.url}/conflicts` }) : []),
    ...(canNudge ? toLinkEntry({ name: NUDGE_ENTRY, tip: `Ask ${formatNames(pr.requestedUsers)} to review again`, url: null }) : []),
  ];
}

// ---------- a row's actions ----------

// What case rules read about a row. null: the row's tab has no such fact.
/**
 * @typedef {{ failingChecks: string[], labels: string[], author: string | null, size: number | null, priority: number | null }} RuleFacts
 */
// main: the entry the row's button runs, null to open the PR or ticket. reason: why a rule picked it.
/** @typedef {{ main: string | null, suggested: string[], reason: string | null }} RowActions */

/** @param {{ failingChecks?: string[], labels: string[], author: string, additions: number, deletions: number }} pr @returns {RuleFacts} */
export const getPullRequestRuleFacts = (pr) => ({
  failingChecks: pr.failingChecks ?? [], labels: pr.labels, author: pr.author, size: pr.additions + pr.deletions, priority: null,
});

/** @param {{ labels?: string[], priority: number }} issue @returns {RuleFacts} */
export const getIssueRuleFacts = (issue) => ({ failingChecks: [], labels: issue.labels ?? [], author: null, size: null, priority: issue.priority });

/** @param {string} text */
const toKey = (text) => text.trim().toLowerCase();

// Whether a row fits a case rule. Names compare without case, as GitHub's do.
/** @param {{ rule: import("./settings.js").CaseRule, facts: RuleFacts }} params */
export function matchCaseRule({ rule, facts }) {
  const value = toKey(rule.when.value);
  switch (rule.when.kind) {
    case "check": return facts.failingChecks.some((name) => toKey(name).includes(value));
    case "label": return facts.labels.some((label) => toKey(label) === value);
    case "author": return facts.author !== null && toKey(facts.author) === value;
    case "size": return facts.size !== null && facts.size > Number(value);
    case "priority": return facts.priority !== null && facts.priority === Number(value);
    default: {
      /** @type {never} */
      const unknownKind = rule.when.kind;
      return unknownKind;
    }
  }
}

// Why a rule picked a row's main action: "lint fails", "labeled bug", "over 500 lines".
/** @param {import("./settings.js").CaseRule["when"]} when */
export function getRuleReason(when) {
  switch (when.kind) {
    case "check": return `${when.value} fails`;
    case "label": return `labeled ${when.value}`;
    case "author": return `by ${when.value}`;
    case "size": return `over ${when.value} lines`;
    case "priority": return PRIORITY_OPTIONS.find((p) => p.value === Number(when.value))?.label ?? `priority ${when.value}`;
    default: {
      /** @type {never} */
      const unknownKind = when.kind;
      return unknownKind;
    }
  }
}

// A row's actions: its case's shown entries it can run, in order, the first its main action
// (OPEN_ENTRY there: it opens the PR or ticket). The first rule that fits the row and whose action
// it can run puts that action first instead, with the rule's reason.
/**
 * @param {{ caseSettings: import("./settings.js").CaseSettings | undefined, facts: RuleFacts, isAvailable: (entry: string) => boolean }} params
 * @returns {RowActions}
 */
export function getRowActions({ caseSettings, facts, isAvailable }) {
  if (!caseSettings) return { main: null, suggested: [], reason: null };
  const shown = caseSettings.order.filter((entry) => !caseSettings.hidden.includes(entry) && (entry === OPEN_ENTRY || isAvailable(entry)));
  const rule = caseSettings.rules.find((r) => isAvailable(r.then) && matchCaseRule({ rule: r, facts }));
  const first = rule?.then ?? shown[0] ?? OPEN_ENTRY;
  const suggested = [...(rule ? [rule.then] : []), ...shown.filter((entry) => entry !== OPEN_ENTRY && entry !== rule?.then)];
  return { main: first === OPEN_ENTRY ? null : first, suggested, reason: rule ? getRuleReason(rule.when) : null };
}

// A PR row's actions: its case's, with only the link entries it has (getPullRequestLinks).
/**
 * @param {{ skills: import("./settings.js").Skills, pr: Parameters<typeof getPullRequestRuleFacts>[0] & import("./settings.js").PullRequestShape,
 *   login: string | null, links: RowLinkEntry[] }} params
 */
export const getPullRequestActions = ({ skills, pr, login, links }) => getRowActions({
  caseSettings: skills.github.cases[getGithubSituation({ pr, login })], facts: getPullRequestRuleFacts(pr),
  isAvailable: (entry) => !isLinkEntry(entry) || links.some((l) => l.entry === entry),
});

// A ticket's actions (its menu and keys): its case's, with my-PR review skills only on my PR and
// the others' ones only on someone else's PR.
/**
 * @param {{ skills: import("./settings.js").Skills, issue: { stateType: string, state: string, isMyPullRequest: boolean, prUrl: string | null,
 *   labels?: string[], priority: number } }} params
 */
export function getTicketActions({ skills, issue }) {
  const reviewSkills = getReviewSkills({ skills, tab: "linear" });
  const pullRequest = getTicketPullRequest(issue);
  return getRowActions({
    caseSettings: skills.linear.cases[getLinearSituation(issue)], facts: getIssueRuleFacts(issue),
    isAvailable: (entry) => isSkillOffered({ skill: entry, reviewSkills, pullRequest }),
  });
}

// ---------- row details ----------

/** @typedef {"success" | "danger" | "warning" | "dim"} FactTone */
// A piece of a fact in its own color: "+44" green, "−6" red.
/** @typedef {{ text: string, tone: FactTone | null }} FactPart */
// tone: a palette tone or an agent status; null: plain text. parts: the value in colored pieces, in place of value's tone.
/** @typedef {{ label: string, value: string, tone: FactTone | AgentStatus | null, isMono: boolean, url: string | null, parts: FactPart[] | null }} DetailRow */
/** @typedef {{ skill: string, key: string | null, reason: string | null, isMain: boolean }} DetailSuggestion */
// A link of the row: a page to open, or (url null) a link entry the panel runs on the row.
/** @typedef {{ label: string, icon: string, url: string | null, entry: string | null }} DetailLink */
// owner: whose PR it is ("my PR"), null for a ticket without one. agent: null when no agent or worktree is known.
/** @typedef {{ owner: string | null, suggested: DetailSuggestion[], links: DetailLink[], status: DetailRow[], agent: DetailRow[] | null }} RowDetails */
/**
 * @typedef {PullRequestFactsShape & { branch: string, isDraft: boolean, requestedUsers: string[], requestedTeams: unknown[] }} DetailPullRequest
 * @typedef {{ state: string, stateType: string, priority: number, project: string | null, assignee: string | null, prUrl: string | null,
 *   isMyPullRequest: boolean, branch: string | null }} DetailIssue
 * @typedef {{ kind: "pullRequest", pr: DetailPullRequest, groupId: PullRequestGroupId, login: string | null } | { kind: "issue", issue: DetailIssue }
 *   | { kind: "decision", decision: Decision }} DetailRowSource
 */
// A fact about the row that a case's skill is for: the skill's reason when it is that case's skill.
/** @typedef {{ situation: import("./settings.js").Situation, text: string }} CaseFact */

const ASK_REASON = "reads it, changes no code";

/** @param {{ text: string, value?: string, tone?: DetailRow["tone"], isMono?: boolean, url?: string | null, parts?: FactPart[] | null }} params @returns {DetailRow} */
const toRow = ({ text, value = "", tone = null, isMono = false, url = null, parts = null }) => ({ label: text, value, tone, isMono, url, parts });

// Why someone else's PR is on your list.
/** @param {{ pr: DetailPullRequest, groupId: PullRequestGroupId, login: string | null }} params */
const getReviewAsk = ({ pr, groupId, login }) => {
  if (groupId === "rereview") return "asked to review again";
  if (groupId === "reviewed") return "you reviewed it";
  if (login && pr.requestedUsers.includes(login)) return "review requested";
  return pr.requestedTeams.length > 0 ? "team review requested" : "someone else's PR";
};

// The facts behind a PR's cases, most pressing first.
/** @param {{ pr: DetailPullRequest, groupId: PullRequestGroupId, login: string | null }} params @returns {CaseFact[]} */
const getPullRequestCaseFacts = ({ pr, groupId, login }) => {
  if (!isMyPullRequest({ pr, login })) return [{ situation: "othersPullRequest", text: getReviewAsk({ pr, groupId, login }) }];
  /** @type {(CaseFact | null)[]} */
  const facts = [
    pr.hasConflicts ? { situation: "myConflicts", text: "conflicts" } : null,
    pr.ci === "failing" ? { situation: "myChecksFailing", text: "checks failing" } : null,
    pr.decision === "CHANGES_REQUESTED" ? { situation: "myChangesRequested", text: "changes requested" } : null,
    pr.decision === "APPROVED" ? { situation: "myApproved", text: "approved" } : null,
    pr.isDraft ? { situation: "myDraft", text: "draft" } : null,
    { situation: "myPullRequest", text: "your PR" },
  ];
  return facts.filter((fact) => fact !== null);
};

// A ticket's facts: its stage, and its PR's side when it has one.
/** @param {DetailIssue} issue @returns {CaseFact[]} */
const getIssueCaseFacts = (issue) => {
  const situation = getLinearSituation(issue);
  /** @returns {string} */
  const getStageText = () => {
    switch (situation) {
      case "backlog":
      case "todo": return issue.state;
      case "inProgress": return `${issue.state}, no PR`;
      case "inProgressWithPullRequest": return `${issue.state}, PR open`;
      case "reviewMine": return `${issue.state}, your PR`;
      case "reviewOthers": return `${issue.state}, someone else's PR`;
      default: {
        /** @type {never} */
        const unknownSituation = situation;
        return unknownSituation;
      }
    }
  };
  /** @type {CaseFact[]} */
  const pullRequest = issue.prUrl ? [issue.isMyPullRequest ? { situation: "reviewMine", text: "your PR is open" } : { situation: "reviewOthers", text: "someone else's PR" }] : [];
  return [{ situation, text: getStageText() }, ...pullRequest];
};

/** @type {Record<string, { value: string, tone: FactTone | null }>} */
const CHECKS_STATUS = { passing: { value: "passing", tone: "success" }, failing: { value: "failing", tone: "danger" }, pending: { value: "running", tone: "warning" } };
/** @type {{ value: string, tone: FactTone }} */
const NO_CHECKS = { value: "none", tone: "dim" };
/** @type {Record<string, { value: string, tone: FactTone | null }>} */
const REVIEW_STATUS = {
  APPROVED: { value: "approved", tone: "success" },
  CHANGES_REQUESTED: { value: "changes requested", tone: "danger" },
  REVIEW_REQUIRED: { value: "review required", tone: "warning" },
};

/** @param {DetailPullRequest} pr @returns {DetailRow[]} */
const getPullRequestStatus = (pr) => [
  toRow({ text: "Merge", value: pr.hasConflicts ? "conflicts" : "no conflicts", tone: pr.hasConflicts ? "danger" : "success" }),
  toRow({ text: "Checks", ...(CHECKS_STATUS[pr.ci] ?? NO_CHECKS) }),
  toRow({ text: "Review", ...((pr.decision ? REVIEW_STATUS[pr.decision] : null) ?? { value: "no decision", tone: "dim" }) }),
  toRow({ text: "Size", value: `+${pr.additions} −${pr.deletions}`, parts: getFactParts(`+${pr.additions} −${pr.deletions}`) }),
  ...(pr.branch ? [toRow({ text: "Branch", value: pr.branch, isMono: true })] : []),
];

// A Linear state's tone by its type: started amber, done green, canceled dim, the rest plain.
/** @type {Record<string, FactTone>} */
const STATE_TONE = { started: "warning", completed: "success", canceled: "dim" };
// Urgent red, high amber, no priority dim.
/** @type {Record<number, FactTone>} */
const PRIORITY_TONE = { 0: "dim", 1: "danger", 2: "warning" };

/** @param {DetailIssue} issue @returns {DetailRow[]} */
const getIssueStatus = (issue) => {
  const priority = PRIORITY_OPTIONS.find((p) => p.value === issue.priority);
  return [
    toRow({ text: "State", value: issue.state, tone: STATE_TONE[issue.stateType] ?? null }),
    ...(priority ? [toRow({ text: "Priority", value: priority.label, tone: PRIORITY_TONE[priority.value] ?? null })] : []),
    ...(issue.project ? [toRow({ text: "Project", value: issue.project })] : []),
    toRow({ text: "Assignee", value: issue.assignee ?? UNASSIGNED, tone: issue.assignee ? null : "dim" }),
    ...(issue.prUrl ? [toRow({ text: "PR", value: `#${issue.prUrl.split("/").pop()}`, isMono: true, url: issue.prUrl })] : []),
    ...(issue.branch ? [toRow({ text: "Branch", value: issue.branch, isMono: true })] : []),
  ];
};

/** @type {Record<string, FactTone>} */
const SEVERITY_TONE = { critical: "danger", high: "warning" };
/** @type {Record<string, string>} */
const OWNER_TEXT = { mine: "my team", other: "another team", unclear: "unclear" };
/** @type {Record<string, FactTone>} */
const OWNER_TONE = { mine: "warning", other: "dim" };

// An On-call row's case, as the reason a skill of that case is suggested.
/** @param {Decision} d @returns {CaseFact[]} */
const getDecisionCaseFacts = (d) => {
  const situation = getOncallSituation(d);
  /** @returns {string} */
  const getText = () => {
    switch (situation) {
      case "critical": return "critical, needs you";
      case "high": return "high, needs you";
      case "needsYou": return "needs you";
      case "notForYou": return "AI: not for you";
      case "filtered": return "filtered without the AI";
      case "failed": return "triage failed";
      default: {
        /** @type {never} */
        const unknownSituation = situation;
        return unknownSituation;
      }
    }
  };
  return [{ situation, text: getText() }];
};

// What the decision knows about the issue: the AI's severity, whose code it is and the cause it
// found, the project, counts, when it was decided and last seen, who decided and the rule it matched.
// Unknown ones leave.
/** @param {{ decision: Decision, now: number }} params @returns {DetailRow[]} */
const getDecisionStatus = ({ decision: d, now }) => [
  ...(d.severity ? [toRow({ text: "Severity", value: d.severity, tone: SEVERITY_TONE[d.severity] ?? null })] : []),
  ...(d.owner ? [toRow({ text: "Owner", value: OWNER_TEXT[d.owner] ?? d.owner, tone: OWNER_TONE[d.owner] ?? null })] : []),
  ...(d.summary ? [toRow({ text: "Cause", value: d.summary })] : []),
  ...(d.project ? [toRow({ text: "Project", value: d.project })] : []),
  toRow({ text: "Events", value: String(d.count) }),
  toRow({ text: "Users", value: String(d.userCount) }),
  ...(Number.isFinite(Date.parse(d.decidedAt)) ? [toRow({ text: "Decided", value: formatClock({ at: Date.parse(d.decidedAt), now }) })] : []),
  ...(Number.isFinite(Date.parse(d.lastSeen)) ? [toRow({ text: "Last seen", value: `${formatElapsed(now - Date.parse(d.lastSeen))} ago` })] : []),
  toRow({ text: "Decided by", value: getDecidedBy(d), tone: d.outcome === "failed" ? "danger" : null }),
  ...(d.matchedRule ? [toRow({ text: "Rule", value: d.matchedRule })] : []),
];

// A worktree inside the repo's main checkout shows from there (".worktrees/thu-1"); else its full path.
/** @param {{ path: string, repoMain: string | null }} params */
const formatWorktree = ({ path, repoMain }) => (repoMain && path.startsWith(`${repoMain}/`) ? path.slice(repoMain.length + 1) : path);

/** @param {{ agent: RowAgent | null, worktree: string | null, repoMain: string | null, now: number }} params @returns {DetailRow[] | null} */
const getAgentRows = ({ agent, worktree, repoMain, now }) => {
  const status = agent ? getAgentStatus({ agent, now }) : null;
  const rows = [
    ...(agent && status ? [
      toRow({ text: "Status", value: status.elapsed ? `${status.text} ${status.elapsed}` : status.text, tone: status.tone }),
      toRow({ text: "Tab", value: agent.tabName }),
    ] : []),
    ...(worktree ? [toRow({ text: "Worktree", value: formatWorktree({ path: worktree, repoMain }), isMono: true })] : []),
  ];
  return rows.length > 0 ? rows : null;
};

/**
 * @param {{ row: DetailRowSource, now: number }} params
 * @returns {{ tab: import("./settings.js").Tab, facts: CaseFact[], status: DetailRow[], owner: string | null }}
 */
const getRowFacts = ({ row, now }) => {
  switch (row.kind) {
    case "pullRequest": return {
      tab: /** @type {const} */ ("github"),
      facts: getPullRequestCaseFacts(row),
      status: getPullRequestStatus(row.pr),
      owner: isMyPullRequest({ pr: row.pr, login: row.login }) ? "my PR" : "someone else's PR",
    };
    case "issue": return {
      tab: /** @type {const} */ ("linear"),
      facts: getIssueCaseFacts(row.issue),
      status: getIssueStatus(row.issue),
      owner: row.issue.prUrl ? (row.issue.isMyPullRequest ? "my PR" : "someone else's PR") : null,
    };
    case "decision": return {
      tab: /** @type {const} */ ("oncall"),
      facts: getDecisionCaseFacts(row.decision),
      status: getDecisionStatus({ decision: row.decision, now }),
      owner: null,
    };
    default: {
      /** @type {never} */
      const unknownRow = row;
      return unknownRow;
    }
  }
};

// What a row's details dialog shows: the menu's suggested skills and link entries, each with a rule's
// reason or the first fact whose case it is the skill of (none when no fact points to it), main on
// the one the row's button runs (main: its skill or link entry, getRowAction), the menu's links, the
// row's status, and its agent and worktree.
/**
 * @param {{ row: DetailRowSource, skills: import("./settings.js").Skills, menu: RowMenuSection[], agent: RowAgent | null,
 *   worktree: string | null, repoMain: string | null, main: string | null, now?: number }} params
 * @returns {RowDetails}
 */
export function getRowDetails({ row, skills, menu, agent, worktree, repoMain, main, now = Date.now() }) {
  const { tab, facts, status, owner } = getRowFacts({ row, now });
  /** @param {string} skill */
  const getReason = (skill) => {
    if (skill === ASK_ACTION) return ASK_REASON;
    return facts.find((fact) => getSituationSkills({ skills, tab, situation: fact.situation }).includes(skill))?.text ?? null;
  };
  const items = menu.find((section) => section.id === "suggested")?.items ?? [];
  const suggested = items.flatMap((item) => {
    if (item.kind === "skill") return [{ skill: item.skill, key: item.key, reason: item.reason ?? getReason(item.skill) }];
    return item.kind === "linkEntry" ? [{ skill: item.entry, key: item.key, reason: item.reason }] : [];
  }).map((item) => ({ ...item, isMain: item.skill === main }));
  const linkItems = menu.find((section) => section.id === "links")?.items ?? [];
  /** @type {DetailLink[]} */
  const links = linkItems.flatMap((item) => {
    if (item.kind === "link") return [{ label: item.label, icon: item.icon, url: item.url, entry: null }];
    return item.kind === "linkEntry" ? [{ label: item.label, icon: item.icon, url: item.url, entry: item.entry }] : [];
  });
  return { owner, suggested, links, status, agent: getAgentRows({ agent, worktree, repoMain, now }) };
}

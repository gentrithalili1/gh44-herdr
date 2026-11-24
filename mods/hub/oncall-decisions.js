// The On-call tab's view of the service's decisions: today's numbers, what needs you, search.
// Pure, so tests/ can load it without Herdr.

/** @typedef {import("./oncall-service/triage.mjs").Decision} Decision */
/** @typedef {"attention" | "all" | "filtered"} OncallViewId */
/** @typedef {{ triaged: number, filtered: number, investigated: number, unseen: number, costUsd: number }} TodayStats */

/** @type {{ id: OncallViewId, label: string }[]} */
export const ONCALL_VIEWS = [
  { id: "attention", label: "Needs you" },
  { id: "all", label: "All" },
  { id: "filtered", label: "Filtered" },
];
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, ignore: 4 };

// The tab's filters, kept in shared(ONCALL_FILTERS_STORE) like the GitHub and Linear tabs' ones.
/** @typedef {"any" | "1h" | "24h" | "7d"} OncallTime */
/** @typedef {"any" | "unseen" | "seen"} OncallSeen */
/** @typedef {{ view: OncallViewId, severities: string[], projects: string[], decidedBy: string[], time: OncallTime, seen: OncallSeen }} OncallFilters */
export const ONCALL_FILTERS_STORE = "hub.oncall.filters";
// Whether the tab shows today's numbers (false hides them; unset shows them).
export const ONCALL_SHOW_TODAY_STORE = "hub.oncall.showToday";
/** @param {unknown} saved */
export const isTodayShown = (saved) => saved !== false;
/** @type {OncallFilters} */
export const ONCALL_DEFAULTS = { view: "attention", severities: [], projects: [], decidedBy: [], time: "any", seen: "any" };
export const SEVERITY_OPTIONS = ["critical", "high", "medium", "low", "ignore"].map((value) => ({ value, label: `${value[0].toUpperCase()}${value.slice(1)}` }));
export const DECIDED_BY_OPTIONS = ["AI", "AI · other team", "Domain check", "Priority filter", "Waiting for impact", "Triage failed"].map((value) => ({ value, label: value }));
/** @type {{ value: OncallTime, label: string }[]} */
export const TIME_OPTIONS = [
  { value: "any", label: "Any time" },
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
];
/** @type {{ value: OncallSeen, label: string }[]} */
export const SEEN_OPTIONS = [
  { value: "any", label: "Seen or not" },
  { value: "unseen", label: "Unseen" },
  { value: "seen", label: "Seen" },
];
/** @type {Record<OncallTime, number>} */
const TIME_WINDOW_MS = { any: Number.POSITIVE_INFINITY, "1h": 3_600_000, "24h": 86_400_000, "7d": 7 * 86_400_000 };

/** @param {unknown} saved @returns {Decision[]} */
export function readDecisions(saved) {
  const items = saved && typeof saved === "object" && "items" in saved ? /** @type {any} */ (saved).items : null;
  if (!items || typeof items !== "object") return [];
  return Object.values(items).filter((d) => d && typeof d.issueId === "string" && typeof d.decidedAt === "string")
    .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
}

// Reported by the AI and nudged: what the "Needs you" view and the tab's count show.
/** @param {Decision} d */
export const needsAttention = (d) => d.outcome === "reported" && d.isNotified;
/** @param {Decision} d */
const isFiltered = (d) => d.stage === "priority" || d.stage === "impact" || d.stage === "domain";

/** @param {{ decisions: Decision[], seen: string[] }} params */
export const countUnseen = ({ decisions, seen }) => decisions.filter((d) => needsAttention(d) && !seen.includes(seenKey(d))).length;

// Seen is per decision, so a re-run or a regression shows up as new again.
/** @param {Decision} d */
export const seenKey = (d) => `${d.issueId}@${d.decidedAt}`;

/** @param {{ decisions: Decision[], seen: string[], now: Date }} params @returns {TodayStats} */
export function getTodayStats({ decisions, seen, now }) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = decisions.filter((d) => Date.parse(d.decidedAt) >= start.getTime());
  return {
    triaged: today.length,
    filtered: today.filter(isFiltered).length,
    investigated: today.filter((d) => d.stage === "ai" || d.stage === "failed").length,
    unseen: countUnseen({ decisions, seen }),
    costUsd: today.reduce((sum, d) => sum + (d.costUsd ?? 0), 0),
  };
}

/** @param {{ d: Decision, view: OncallViewId }} params */
const isInView = ({ d, view }) => {
  switch (view) {
    case "attention": return needsAttention(d);
    case "filtered": return isFiltered(d);
    case "all": return true;
    default: {
      /** @type {never} */
      const unknownView = view;
      return unknownView;
    }
  }
};

// One view with the filters, searched by short id, title, project or summary; the most severe
// first in Needs you. seen: the seen keys, for the Seen filter (only rows that need you count).
/** @param {{ decisions: Decision[], filters?: Partial<OncallFilters>, search: string, seen?: string[], now?: number }} params @returns {Decision[]} */
export function filterDecisions({ decisions, filters = {}, search, seen = [], now = Date.now() }) {
  const f = { ...ONCALL_DEFAULTS, ...filters };
  const typed = search.trim().toLowerCase();
  const window = TIME_WINDOW_MS[f.time] ?? TIME_WINDOW_MS.any;
  /** @param {Decision} d */
  const isUnseen = (d) => needsAttention(d) && !seen.includes(seenKey(d));
  const found = decisions.filter((d) => isInView({ d, view: f.view })
    && (f.severities.length === 0 || f.severities.includes(d.severity ?? ""))
    && (f.projects.length === 0 || f.projects.includes(d.project))
    && (f.decidedBy.length === 0 || f.decidedBy.includes(getDecidedBy(d)))
    && now - Date.parse(d.decidedAt) <= window
    && (f.seen === "any" || (f.seen === "unseen") === isUnseen(d))
    && (!typed || [d.shortId, d.title, d.project, d.summary].some((text) => String(text ?? "").toLowerCase().includes(typed))));
  if (f.view !== "attention") return found;
  return [...found].sort((a, b) => (SEVERITY_RANK[a.severity ?? "ignore"] ?? 9) - (SEVERITY_RANK[b.severity ?? "ignore"] ?? 9) || b.decidedAt.localeCompare(a.decidedAt));
}

// Decisions nudged after a time: what still needs a toast.
/** @param {{ decisions: Decision[], since: string | null }} params */
export const getNewNudges = ({ decisions, since }) => decisions.filter((d) => d.isNotified && (!since || d.decidedAt > since));

/** @param {number} usd */
export const formatCost = (usd) => `$${usd.toFixed(2)}`;

// Who decided a row, for its "Decided by" label: a free filter, the domain check or the AI.
/** @param {Decision} d @returns {string} */
export function getDecidedBy(d) {
  switch (d.stage) {
    case "priority": return "Priority filter";
    case "impact": return "Waiting for impact";
    case "domain": return "Domain check";
    case "ai": return d.owner === "other" ? "AI · other team" : "AI";
    case "failed": return "Triage failed";
    default: {
      /** @type {never} */
      const unknownStage = d.stage;
      return unknownStage;
    }
  }
}

// A re-run asked for is pending until a newer decision lands, or for at most RERUN_TIMEOUT_MS.
const RERUN_TIMEOUT_MS = 15 * 60_000;
/** @param {{ decision: Decision, requestedAt: string | undefined, now: number }} params */
export const isRerunPending = ({ decision, requestedAt, now }) =>
  Boolean(requestedAt) && decision.decidedAt < String(requestedAt) && now - Date.parse(String(requestedAt)) < RERUN_TIMEOUT_MS;

// The countdown ring's icon (icons/countdown-00..24.svg): full right after a check, empty when
// the next one is due.
export const COUNTDOWN_STEPS = 24;
/** @param {{ msLeft: number, periodMs: number }} params */
export function getCountdownIcon({ msLeft, periodMs }) {
  const fraction = periodMs > 0 ? Math.min(1, Math.max(0, msLeft / periodMs)) : 0;
  return `countdown-${String(Math.ceil(fraction * COUNTDOWN_STEPS)).padStart(2, "0")}`;
}

// A Check now runs until the service writes its next check time (it does once the check, AI
// triage included, is done), or for at most CHECK_TIMEOUT_MS.
const CHECK_TIMEOUT_MS = 15 * 60_000;
/** @param {{ request: { at: number, nextPollAt: string | null } | null, nextPollAt: string | null, now: number }} params */
export const isCheckPending = ({ request, nextPollAt, now }) =>
  Boolean(request) && nextPollAt === request?.nextPollAt && now - (request?.at ?? 0) < CHECK_TIMEOUT_MS;

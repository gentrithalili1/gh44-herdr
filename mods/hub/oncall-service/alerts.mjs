// Sentry issues and events as On-call alerts, and the query that lists them. Pure, so tests/ can load it.

// Errors only: Sentry also files metric alerts, performance and uptime issues with level:error.
const ISSUE_QUERY = "is:unresolved issue.category:error";
const ISSUE_LIMIT = "100";
const MAX_FRAMES = 12;
// Tags that help the AI tell where and for whom it broke.
const PROMPT_TAGS = ["url", "transaction", "browser", "os", "release", "environment", "lang"];

/** @typedef {"new" | "regressed" | "escalating" | "ongoing" | "other"} AlertKind */
/**
 * @typedef {{
 *   id: string, shortId: string, title: string, culprit: string, level: string, priority: string | null,
 *   project: string, url: string, kind: AlertKind, firstSeen: string, lastSeen: string,
 *   count: number, userCount: number, isUnhandled: boolean,
 * }} Alert
 */
/** @typedef {{ fn: string, file: string, line: number | null, isInApp: boolean }} Frame */
/** @typedef {{ message: string, frames: Frame[], tags: Record<string, string> }} EventContext */

/** @param {unknown} value @returns {Record<string, any>} */
const toRecord = (value) => (value && typeof value === "object" && !Array.isArray(value) ? /** @type {Record<string, any>} */ (value) : {});
/** @param {unknown} value */
const toText = (value) => (typeof value === "string" ? value : "");
/** @param {unknown} value */
const toCount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const KINDS = ["new", "regressed", "escalating", "ongoing"];

/** @param {unknown} substatus @returns {AlertKind} */
const toKind = (substatus) => (KINDS.includes(/** @type {string} */ (substatus)) ? /** @type {AlertKind} */ (substatus) : "other");

// One issue from Sentry's issues list; null when it lacks an id or title.
/** @param {unknown} raw @returns {Alert | null} */
export function toAlert(raw) {
  const issue = toRecord(raw);
  const id = toText(issue.id);
  const title = toText(issue.title);
  if (!id || !title) return null;
  return {
    id,
    shortId: toText(issue.shortId) || id,
    title,
    culprit: toText(issue.culprit),
    level: toText(issue.level) || "error",
    priority: toText(issue.priority) || null,
    project: toText(toRecord(issue.project).slug),
    url: toText(issue.permalink),
    kind: toKind(issue.substatus),
    firstSeen: toText(issue.firstSeen),
    lastSeen: toText(issue.lastSeen),
    count: toCount(issue.count),
    userCount: toCount(issue.userCount),
    isUnhandled: issue.isUnhandled === true,
  };
}

/** @param {unknown} body @returns {Alert[]} */
export const toAlerts = (body) => (Array.isArray(body) ? body.map(toAlert).filter((a) => a !== null) : []);

// Unresolved errors of the picked projects and environments seen in the last hours, newest first.
/** @param {{ org: string, projectIds: string[], environments: string[], hours: number }} params */
export function buildIssuesPath({ org, projectIds, environments, hours }) {
  const params = new URLSearchParams({ query: `${ISSUE_QUERY} lastSeen:-${hours}h`, statsPeriod: "24h", sort: "date", limit: ISSUE_LIMIT });
  for (const id of projectIds) params.append("project", id);
  for (const environment of environments) params.append("environment", environment);
  return `/organizations/${encodeURIComponent(org)}/issues/?${params}`;
}

// The latest event's message, stack (most recent call first, ours before libraries) and useful tags.
/** @param {unknown} raw @returns {EventContext} */
export function toEventContext(raw) {
  const event = toRecord(raw);
  const entries = Array.isArray(event.entries) ? event.entries.map(toRecord) : [];
  const values = entries.filter((e) => e.type === "exception").flatMap((e) => toRecord(e.data).values ?? []);
  const frames = values.flatMap((v) => toRecord(toRecord(v).stacktrace).frames ?? []).map(toRecord).reverse()
    .map((f) => ({ fn: toText(f.function) || "<anonymous>", file: toText(f.filename) || toText(f.absPath) || "<unknown>", line: Number.isFinite(f.lineNo) ? f.lineNo : null, isInApp: f.inApp === true }));
  const ordered = [...frames.filter((f) => f.isInApp), ...frames.filter((f) => !f.isInApp)].slice(0, MAX_FRAMES);
  const tags = Object.fromEntries((Array.isArray(event.tags) ? event.tags : []).map(toRecord)
    .filter((t) => PROMPT_TAGS.includes(t.key) && isFilled(t.value)).map((t) => [t.key, String(t.value)]));
  const firstValue = toRecord(values[0]);
  const message = [toText(firstValue.type), toText(firstValue.value)].filter(Boolean).join(": ") || toText(event.message) || toText(event.title);
  return { message, frames: ordered, tags };
}

/** @param {unknown} value */
const isFilled = (value) => value !== null && value !== undefined && value !== "";

// Orgs from Sentry's organizations list, with the region host their API lives on.
/** @param {unknown} body @returns {{ slug: string, name: string, regionUrl: string }[]} */
export function toOrgs(body) {
  if (!Array.isArray(body)) return [];
  return body.map(toRecord).filter((o) => toText(o.slug)).map((o) => ({
    slug: o.slug,
    name: toText(o.name) || o.slug,
    regionUrl: toText(toRecord(o.links).regionUrl) || "https://sentry.io",
  })).sort((a, b) => a.name.localeCompare(b.name));
}

/** @param {unknown} body @returns {{ id: string, slug: string }[]} */
export function toProjects(body) {
  if (!Array.isArray(body)) return [];
  return body.map(toRecord).filter((p) => toText(p.id) && toText(p.slug))
    .map((p) => ({ id: p.id, slug: p.slug }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

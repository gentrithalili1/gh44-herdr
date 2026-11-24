// The On-call setup the panel saves and the background service reads: which Sentry org and
// projects to watch, which events count, your rules for the AI, and whether you are on call.
// Pure, so tests/ and the Node service can load it without Herdr.

/** @typedef {{ slug: string, name: string, regionUrl: string }} SentryOrg */
/** @typedef {{ id: string, slug: string }} SentryProject */
/** @typedef {"critical" | "high" | "medium" | "low" | "ignore"} Severity */
/** @typedef {"high" | "medium" | "low"} SentryPriority */
/** @typedef {"haiku" | "sonnet" | "opus"} Model */
/** @typedef {{ id: string, text: string, isOn: boolean }} Rule */
/** @typedef {"nudgeRules" | "neverRules"} RuleList */
// What the setup scan learned about the repo: CODEOWNERS and the Sentry noise rules as code read
// them, and the AI's short summary, which the engineer can edit.
/**
 * @typedef {{
 *   folder: string, scannedAt: string, codeowners: string, sentryFiles: string[],
 *   ignoreErrors: string[], denyUrls: string[], summary: string, costUsd: number | null,
 * }} RepoProfile
 */
/** @typedef {"token" | "org" | "projects" | "repo" | "domain"} SetupStep */
/**
 * @typedef {{
 *   isOn: boolean,
 *   org: SentryOrg | null,
 *   projects: SentryProject[],
 *   projectsByOrg: Record<string, SentryProject[]>,
 *   environments: string[],
 *   pollMinutes: number,
 *   catchUpHours: number,
 *   notifySeverities: Severity[],
 *   aiPriorities: SentryPriority[],
 *   model: Model,
 *   domain: string,
 *   nudgeRules: Rule[],
 *   neverRules: Rule[],
 *   codeFolder: string | null,
 *   repoProfile: RepoProfile | null,
 *   triageSkill: string,
 *   isSoundOn: boolean,
 *   nodePath: string | null,
 *   claudePath: string | null,
 * }} OncallConfig
 */

export const POLL_MINUTES = [1, 2, 5, 10];
export const CATCH_UP_HOURS = [1, 6, 12, 24];
/** @type {Severity[]} */
export const SEVERITIES = ["critical", "high", "medium", "low", "ignore"];
/** @type {Severity[]} */
export const NOTIFY_SEVERITY_OPTIONS = ["critical", "high", "medium", "low"];
/** @type {SentryPriority[]} */
export const SENTRY_PRIORITIES = ["high", "medium", "low"];
/** @type {{ id: Model, label: string, description: string }[]} */
export const MODELS = [
  { id: "haiku", label: "Haiku", description: "fastest and cheapest" },
  { id: "sonnet", label: "Sonnet", description: "balanced" },
  { id: "opus", label: "Opus", description: "most thorough, slowest" },
];
export const SENTRY_URL = "https://sentry.io";
// The name hc knows the service by: one per machine.
export const SERVICE_NAME = "gh44-oncall";
const DEFAULT_POLL_MINUTES = 2;
const DEFAULT_CATCH_UP_HOURS = 12;
const DEFAULT_ENVIRONMENTS = ["production"];
/** @type {Severity[]} */
const DEFAULT_NOTIFY = ["critical", "high"];
/** @type {SentryPriority[]} */
const DEFAULT_AI_PRIORITIES = ["high", "medium"];
/** @type {Model} */
const DEFAULT_MODEL = "sonnet";
const MAX_RULE_LENGTH = 300;
// Room for a team's CODEOWNERS lines.
export const MAX_DOMAIN_LENGTH = 8_000;
// The "is this mine?" check is a quick yes or no: the cheapest model does it.
/** @type {Model} */
export const DOMAIN_MODEL = "haiku";
// The triage skill bundled with the service (oncall/skills/oncall-triage), the default.
export const BUILT_IN_TRIAGE_SKILL = "oncall-triage";

// Rules a new setup starts with: the noise join-oncall learned to skip.
/** @type {Rule[]} */
const DEFAULT_NEVER_RULES = [
  { id: "never-extensions", text: "Errors thrown by browser extensions, injected or third-party scripts", isOn: true },
  { id: "never-bots", text: "Errors only bots, crawlers or e2e tests run into", isOn: true },
];

export const NUDGE_SUGGESTIONS = [
  "A crash in code my team owns",
  "Login, signup or checkout broken for many users",
  "A regression right after a release",
];
export const NEVER_SUGGESTIONS = [
  "Validation or permission errors users cause themselves",
  "Network timeouts and aborted requests",
  "An error only one user has seen",
];

/** @param {unknown} value @returns {Record<string, any>} */
const toRecord = (value) => (value && typeof value === "object" && !Array.isArray(value) ? /** @type {Record<string, any>} */ (value) : {});
/** @param {unknown} value @returns {value is string} */
const isText = (value) => typeof value === "string" && value.length > 0;

/** @param {unknown} value @returns {SentryOrg | null} */
function readOrg(value) {
  const o = toRecord(value);
  if (!isText(o.slug)) return null;
  return { slug: o.slug, name: isText(o.name) ? o.name : o.slug, regionUrl: isText(o.regionUrl) ? o.regionUrl : SENTRY_URL };
}

/** @param {unknown} value @returns {SentryProject[]} */
function readProjects(value) {
  if (!Array.isArray(value)) return [];
  return value.map(toRecord).filter((p) => isText(p.id) && isText(p.slug)).map((p) => ({ id: p.id, slug: p.slug }));
}

// Each org's picked projects, kept for switching back to it.
/** @param {unknown} value @returns {Record<string, SentryProject[]>} */
function readProjectsByOrg(value) {
  return Object.fromEntries(Object.entries(toRecord(value)).filter(([slug]) => isText(slug)).map(([slug, list]) => [slug, readProjects(list)]));
}

// The values of a saved list that are among the options; the fallback when none are.
/** @template T @param {{ value: unknown, options: readonly T[], fallback: T[] }} params @returns {T[]} */
function readPicks({ value, options, fallback }) {
  if (!Array.isArray(value)) return fallback;
  const picked = options.filter((o) => value.includes(o));
  return picked.length > 0 ? picked : fallback;
}

/** @param {{ value: unknown, fallback: Rule[] }} params @returns {Rule[]} */
function readRules({ value, fallback }) {
  if (!Array.isArray(value)) return fallback;
  return value.map(toRecord).filter((r) => isText(r.id) && isText(r.text))
    .map((r) => ({ id: r.id, text: r.text.slice(0, MAX_RULE_LENGTH), isOn: r.isOn !== false }));
}

/** @param {unknown} value @returns {string[]} */
const readEnvironments = (value) => {
  if (!Array.isArray(value)) return DEFAULT_ENVIRONMENTS;
  return [...new Set(value.filter(isText).map((e) => e.trim()).filter(Boolean))];
};

const MAX_PROFILE_SUMMARY = 8_000;
const MAX_PROFILE_CODEOWNERS = 30_000;

/** @param {unknown} value @returns {string[]} */
const readTexts = (value) => (Array.isArray(value) ? value.filter(isText) : []);

/** @param {unknown} value @returns {RepoProfile | null} */
function readRepoProfile(value) {
  const p = toRecord(value);
  if (!isText(p.folder) || !isText(p.scannedAt)) return null;
  return {
    folder: p.folder,
    scannedAt: p.scannedAt,
    codeowners: typeof p.codeowners === "string" ? p.codeowners.slice(0, MAX_PROFILE_CODEOWNERS) : "",
    sentryFiles: readTexts(p.sentryFiles),
    ignoreErrors: readTexts(p.ignoreErrors),
    denyUrls: readTexts(p.denyUrls),
    summary: typeof p.summary === "string" ? p.summary.slice(0, MAX_PROFILE_SUMMARY) : "",
    costUsd: typeof p.costUsd === "number" ? p.costUsd : null,
  };
}

// A saved config read back safely: unknown or broken fields fall back to their defaults.
/** @param {unknown} saved @returns {OncallConfig} */
export function readOncallConfig(saved) {
  const s = toRecord(saved);
  return {
    isOn: s.isOn === true,
    org: readOrg(s.org),
    projects: readProjects(s.projects),
    projectsByOrg: readProjectsByOrg(s.projectsByOrg),
    environments: readEnvironments(s.environments),
    pollMinutes: POLL_MINUTES.includes(s.pollMinutes) ? s.pollMinutes : DEFAULT_POLL_MINUTES,
    catchUpHours: CATCH_UP_HOURS.includes(s.catchUpHours) ? s.catchUpHours : DEFAULT_CATCH_UP_HOURS,
    notifySeverities: readPicks({ value: s.notifySeverities, options: NOTIFY_SEVERITY_OPTIONS, fallback: DEFAULT_NOTIFY }),
    aiPriorities: readPicks({ value: s.aiPriorities, options: SENTRY_PRIORITIES, fallback: DEFAULT_AI_PRIORITIES }),
    model: MODELS.find((m) => m.id === s.model)?.id ?? DEFAULT_MODEL,
    domain: typeof s.domain === "string" ? s.domain.trim().slice(0, MAX_DOMAIN_LENGTH) : "",
    nudgeRules: readRules({ value: s.nudgeRules, fallback: [] }),
    neverRules: readRules({ value: s.neverRules, fallback: DEFAULT_NEVER_RULES }),
    codeFolder: isText(s.codeFolder) ? s.codeFolder : null,
    repoProfile: readRepoProfile(s.repoProfile),
    triageSkill: isText(s.triageSkill) && /^[\w:.-]+$/.test(s.triageSkill) ? s.triageSkill : BUILT_IN_TRIAGE_SKILL,
    isSoundOn: s.isSoundOn !== false,
    nodePath: isText(s.nodePath) ? s.nodePath : null,
    claudePath: isText(s.claudePath) ? s.claudePath : null,
  };
}

// What is still missing before the service can start; null when nothing is.
/** @param {{ config: OncallConfig, hasToken: boolean }} params @returns {SetupStep | null} */
export function getMissingSetup({ config, hasToken }) {
  if (!hasToken) return "token";
  if (!config.org) return "org";
  if (config.projects.length === 0) return "projects";
  if (!config.codeFolder) return "repo";
  if (!config.domain) return "domain";
  return null;
}

// Picking another org keeps the old org's projects aside and brings back the ones picked in the
// new org before, if any.
/** @param {{ config: OncallConfig, org: SentryOrg }} params @returns {OncallConfig} */
export function setOrg({ config, org }) {
  if (config.org?.slug === org.slug) return config;
  const projectsByOrg = config.org ? { ...config.projectsByOrg, [config.org.slug]: config.projects } : config.projectsByOrg;
  return { ...config, org, projects: projectsByOrg[org.slug] ?? [], projectsByOrg };
}

// The projects whose ids were picked, in the org's order.
/** @param {{ config: OncallConfig, ids: string[], projects: SentryProject[] }} params @returns {OncallConfig} */
export const pickProjects = ({ config, ids, projects }) => ({ ...config, projects: projects.filter((p) => ids.includes(p.id)) });

// A multi-choice setting's picks in the options' order; null when none of them is an option,
// since the setting never goes empty.
/** @template T @param {{ picked: unknown[], order: readonly T[] }} params @returns {T[] | null} */
export function pickSome({ picked, order }) {
  const values = picked.map(String);
  const next = order.filter((o) => values.includes(String(o)));
  return next.length ? next : null;
}

// "production, staging" -> ["production", "staging"]; empty means every environment.
/** @param {string} text */
export const parseEnvironments = (text) => [...new Set(text.split(/[\s,]+/).map((e) => e.trim()).filter(Boolean))];

/** @param {{ config: OncallConfig, list: RuleList, text: string, id: string }} params @returns {OncallConfig} */
export function addRule({ config, list, text, id }) {
  const value = text.trim().slice(0, MAX_RULE_LENGTH);
  if (!value || config[list].some((r) => r.text.toLowerCase() === value.toLowerCase())) return config;
  return { ...config, [list]: [...config[list], { id, text: value, isOn: true }] };
}

/** @param {{ config: OncallConfig, list: RuleList, id: string }} params @returns {OncallConfig} */
export const toggleRule = ({ config, list, id }) => ({ ...config, [list]: config[list].map((r) => (r.id === id ? { ...r, isOn: !r.isOn } : r)) });

/** @param {{ config: OncallConfig, list: RuleList, id: string }} params @returns {OncallConfig} */
export const removeRule = ({ config, list, id }) => ({ ...config, [list]: config[list].filter((r) => r.id !== id) });

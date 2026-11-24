// The On-call setup the panel saves and the background service reads: which issue tracker, org
// and projects to watch, which events count, your rules for the AI, and whether you are on call.
// Pure, so tests/ and the Node service can load it without Herdr.
import { getProvider, DEFAULT_PROVIDER } from "./providers/catalog.js";

// An org in the tracker, with the host its API answers on.
/** @typedef {{ slug: string, name: string, apiUrl: string }} Org */
/** @typedef {{ id: string, slug: string }} Project */
/** @typedef {"critical" | "high" | "medium" | "low" | "ignore"} Severity */
// The tracker's own priority for an issue, when it has one.
/** @typedef {"high" | "medium" | "low"} Priority */
/** @typedef {"haiku" | "sonnet" | "opus"} Model */
/** @typedef {{ id: string, text: string, isOn: boolean }} Rule */
/** @typedef {"nudgeRules" | "neverRules"} RuleList */
// What the setup scan learned about the repo: CODEOWNERS and the SDK's noise rules as code read
// them, and the AI's short summary, which the engineer can edit.
/**
 * @typedef {{
 *   folder: string, scannedAt: string, codeowners: string, setupFiles: string[],
 *   noiseRules: Record<string, string[]>, summary: string, costUsd: number | null,
 * }} RepoProfile
 */
/** @typedef {"token" | "org" | "projects" | "repo" | "domain"} SetupStep */
/**
 * @typedef {{
 *   isOn: boolean,
 *   provider: import("./providers/catalog.js").ProviderId,
 *   org: Org | null,
 *   projects: Project[],
 *   projectsByOrg: Record<string, Project[]>,
 *   environments: string[],
 *   pollMinutes: number,
 *   catchUpHours: number,
 *   notifySeverities: Severity[],
 *   aiPriorities: Priority[],
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
/** @type {Priority[]} */
export const PRIORITIES = ["high", "medium", "low"];
/** @type {{ id: Model, label: string, description: string }[]} */
export const MODELS = [
  { id: "haiku", label: "Haiku", description: "fastest and cheapest" },
  { id: "sonnet", label: "Sonnet", description: "balanced" },
  { id: "opus", label: "Opus", description: "most thorough, slowest" },
];
// The name hc knows the service by: one per machine.
export const SERVICE_NAME = "gh44-oncall";
const DEFAULT_POLL_MINUTES = 2;
const DEFAULT_CATCH_UP_HOURS = 12;
const DEFAULT_ENVIRONMENTS = ["production"];
/** @type {Severity[]} */
const DEFAULT_NOTIFY = ["critical", "high"];
/** @type {Priority[]} */
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

// Rules a new setup starts with: noise that rarely needs anyone.
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

// A saved org; `regionUrl` is what older setups called `apiUrl`.
/** @param {{ value: unknown, defaultUrl: string }} params @returns {Org | null} */
function readOrg({ value, defaultUrl }) {
  const o = toRecord(value);
  if (!isText(o.slug)) return null;
  const apiUrl = [o.apiUrl, o.regionUrl].find(isText) ?? defaultUrl;
  return { slug: o.slug, name: isText(o.name) ? o.name : o.slug, apiUrl };
}

/** @param {unknown} value @returns {Project[]} */
function readProjects(value) {
  if (!Array.isArray(value)) return [];
  return value.map(toRecord).filter((p) => isText(p.id) && isText(p.slug)).map((p) => ({ id: p.id, slug: p.slug }));
}

// Each org's picked projects, kept for switching back to it.
/** @param {unknown} value @returns {Record<string, Project[]>} */
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

// The profile's noise rules by key; older profiles kept Sentry's two keys as fields of their own.
/** @param {Record<string, any>} p @returns {Record<string, string[]>} */
function readNoiseRules(p) {
  const saved = toRecord(p.noiseRules);
  const entries = Object.keys(saved).length ? Object.entries(saved) : [["ignoreErrors", p.ignoreErrors], ["denyUrls", p.denyUrls]].filter(([, v]) => Array.isArray(v));
  return Object.fromEntries(entries.map(([key, list]) => [key, readTexts(list)]));
}

/** @param {unknown} value @returns {RepoProfile | null} */
function readRepoProfile(value) {
  const p = toRecord(value);
  if (!isText(p.folder) || !isText(p.scannedAt)) return null;
  return {
    folder: p.folder,
    scannedAt: p.scannedAt,
    codeowners: typeof p.codeowners === "string" ? p.codeowners.slice(0, MAX_PROFILE_CODEOWNERS) : "",
    setupFiles: readTexts(p.setupFiles ?? p.sentryFiles),
    noiseRules: readNoiseRules(p),
    summary: typeof p.summary === "string" ? p.summary.slice(0, MAX_PROFILE_SUMMARY) : "",
    costUsd: typeof p.costUsd === "number" ? p.costUsd : null,
  };
}

// A saved config read back safely: unknown or broken fields fall back to their defaults.
/** @param {unknown} saved @returns {OncallConfig} */
export function readOncallConfig(saved) {
  const s = toRecord(saved);
  const provider = getProvider(s.provider ?? DEFAULT_PROVIDER);
  return {
    isOn: s.isOn === true,
    provider: provider.id,
    org: readOrg({ value: s.org, defaultUrl: provider.url }),
    projects: readProjects(s.projects),
    projectsByOrg: readProjectsByOrg(s.projectsByOrg),
    environments: readEnvironments(s.environments),
    pollMinutes: POLL_MINUTES.includes(s.pollMinutes) ? s.pollMinutes : DEFAULT_POLL_MINUTES,
    catchUpHours: CATCH_UP_HOURS.includes(s.catchUpHours) ? s.catchUpHours : DEFAULT_CATCH_UP_HOURS,
    notifySeverities: readPicks({ value: s.notifySeverities, options: NOTIFY_SEVERITY_OPTIONS, fallback: DEFAULT_NOTIFY }),
    aiPriorities: readPicks({ value: s.aiPriorities, options: PRIORITIES, fallback: DEFAULT_AI_PRIORITIES }),
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
/** @param {{ config: OncallConfig, org: Org }} params @returns {OncallConfig} */
export function setOrg({ config, org }) {
  if (config.org?.slug === org.slug) return config;
  const projectsByOrg = config.org ? { ...config.projectsByOrg, [config.org.slug]: config.projects } : config.projectsByOrg;
  return { ...config, org, projects: projectsByOrg[org.slug] ?? [], projectsByOrg };
}

// The projects whose ids were picked, in the org's order.
/** @param {{ config: OncallConfig, ids: string[], projects: Project[] }} params @returns {OncallConfig} */
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

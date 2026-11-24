// What the service does with each alert: which ones to look at, the free filters, the prompt
// for the AI and reading its verdict back. Pure, so tests/ can load it.

import { BUILT_IN_TRIAGE_SKILL } from "../config.js";
import { formatRepoContext } from "./repo-scan.mjs";

/** @typedef {import("../config.js").OncallConfig} OncallConfig */
/** @typedef {import("../config.js").Severity} Severity */
/** @typedef {import("./alerts.mjs").Alert} Alert */
/** @typedef {import("./alerts.mjs").EventContext} EventContext */
/** @typedef {"new" | "regressed" | "escalating" | "grew" | "rerun"} Trigger */
/** @typedef {"priority" | "impact" | "domain" | "ai" | "failed"} Stage */
/** @typedef {"reported" | "ignored" | "held" | "failed"} Outcome */
/**
 * @typedef {{
 *   issueId: string, shortId: string, title: string, project: string, url: string, kind: string,
 *   priority: string | null, count: number, userCount: number, lastSeen: string,
 *   decidedAt: string, trigger: Trigger, stage: Stage, outcome: Outcome,
 *   severity: Severity | null, matchedRule: string | null, summary: string, owner: Owner | null,
 *   sessionId: string | null, reportPath: string | null, cwd: string | null, costUsd: number | null,
 *   isNotified: boolean,
 * }} Decision
 */
// Who owns the broken code, as the AI judged it.
/** @typedef {"mine" | "other" | "unclear"} Owner */
/** @typedef {{ severity: Severity, matches: boolean, rule: string | null, summary: string, owner: Owner | null }} Verdict */
/** @typedef {{ mine: "yes" | "no" | "unclear", reason: string }} DomainVerdict */

export const VERDICT_MARKER = "ONCALL_VERDICT";
export const DOMAIN_MARKER = "DOMAIN_VERDICT";
const DOMAIN_ANSWERS = ["yes", "no", "unclear"];
// Brand-new issues are mostly one-offs: they wait until they reach this.
export const IMPACT_GATE = { minEvents: 3, minUsers: 2 };
// Decisions kept on disk: the newest ones, and none older than this.
const KEEP_DECISIONS = 500;
const KEEP_DAYS = 14;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const TRIGGER_KINDS = ["regressed", "escalating"];
const SEVERITY_WORDS = ["critical", "high", "medium", "low", "ignore"];
const OWNED_ANSWERS = ["mine", "unclear"];
/** @type {Owner[]} */
const OWNER_ANSWERS = ["mine", "other", "unclear"];

/** @param {Alert} alert */
const isBelowImpact = (alert) => alert.count < IMPACT_GATE.minEvents && alert.userCount < IMPACT_GATE.minUsers;

// Alerts that need a decision now: new ones first seen inside the look-back window, held ones that
// grew, and ones that turned regressed or escalating since their last decision. Ongoing issues
// that started before the window never trigger.
/** @param {{ alerts: Alert[], decisions: Record<string, Decision>, now: number, hours: number }} params @returns {{ alert: Alert, trigger: Trigger }[]} */
export function selectWork({ alerts, decisions, now, hours }) {
  const since = now - hours * HOUR_MS;
  return alerts.flatMap((alert) => {
    const past = decisions[alert.id];
    const isTriggerKind = TRIGGER_KINDS.includes(alert.kind);
    if (!past) {
      if (isTriggerKind) return [{ alert, trigger: /** @type {Trigger} */ (alert.kind) }];
      const isNewInWindow = (alert.kind === "new" || alert.kind === "other") && Date.parse(alert.firstSeen) >= since;
      return isNewInWindow ? [{ alert, trigger: /** @type {Trigger} */ ("new") }] : [];
    }
    if (past.outcome === "held") return isBelowImpact(alert) ? [] : [{ alert, trigger: /** @type {Trigger} */ ("grew") }];
    if (isTriggerKind && past.kind !== alert.kind) return [{ alert, trigger: /** @type {Trigger} */ (alert.kind) }];
    return [];
  });
}

// Checks that cost nothing, before the AI. Null: the AI looks at it.
/** @param {{ alert: Alert, trigger: Trigger, config: OncallConfig }} params @returns {{ stage: Stage, outcome: Outcome, summary: string } | null} */
export function runFreeFilters({ alert, trigger, config }) {
  if (trigger === "rerun") return null;
  if (alert.priority && !config.aiPriorities.includes(/** @type {any} */ (alert.priority))) {
    return { stage: "priority", outcome: "ignored", summary: `Sentry priority ${alert.priority}; the AI looks at ${config.aiPriorities.join(", ")}` };
  }
  if ((trigger === "new" || trigger === "grew") && isBelowImpact(alert)) {
    return { stage: "impact", outcome: "held", summary: `Waiting for impact: ${alert.count} event${alert.count === 1 ? "" : "s"}, ${alert.userCount} user${alert.userCount === 1 ? "" : "s"}` };
  }
  return null;
}

/** @param {import("../config.js").Rule[]} rules */
const formatRules = (rules) => {
  const on = rules.filter((r) => r.isOn);
  return on.length ? on.map((r) => `- ${r.text}`).join("\n") : "- (none)";
};

// What every triage must do, whichever skill guides the investigation: stay read only, apply
// the engineer's domain and rules, and end with the verdict line the service reads.
const INSTRUCTIONS = `You triage one Sentry issue for an on-call engineer. Answer one question: does this person need to act on it now?

Rules:
- You run unattended. Read only: never change anything in Sentry, never post anywhere, never edit files.
- Never invent counts, users or releases. Use the data below, or the Sentry tools if you have them.
- Be fast. Fetch only what changes the answer.

Does it match:
- If a domain is given, an issue outside it never matches.
- "Never nudge me for" rules win over everything.
- With "Nudge me when" rules set, it matches only when one of them fits. With none set, it matches when it is a real defect worth on-call attention.

Severity is one of: critical, high, medium, low, ignore.

Write the markdown report the guide asks for, with a fenced diff block for a suggested code change when there is one. Then end with exactly one verdict line, nothing after it. Use this format even when the guide asks for another:
${VERDICT_MARKER} {"severity":"<critical|high|medium|low|ignore>","matches":<true|false>,"owner":"<mine|other|unclear: whose code broke, by the domain>","rule":"<the matching rule's text, or empty>","summary":"<one sentence for a notification>"}`;

/** @param {EventContext | null} context */
const formatFrames = (context) => (context?.frames.length
  ? context.frames.map((f) => `- ${f.isInApp ? "[app]" : "[lib]"} ${f.fn} at ${f.file}${f.line ? `:${f.line}` : ""}`).join("\n")
  : "- (no stack)");
/** @param {EventContext | null} context */
const formatTags = (context) => (context && Object.keys(context.tags).length ? Object.entries(context.tags).map(([k, v]) => `- ${k}: ${v}`).join("\n") : "- (none)");

const DOMAIN_INSTRUCTIONS = `You decide one thing: is this Sentry issue in the on-call engineer's domain? Answer from the data below only; you have no tools.

Judge ownership only, not whether the error is real, noise, a browser quirk or third-party: that is decided later. An issue in an app or folder of the domain is yes, whatever its cause.

Map the stack frames, culprit, URL and transaction to the domain. Paths in Sentry often carry a build prefix (app:///, webpack://, _next/static, ./): match on the meaningful part, like the app and module folder. Shared code (packages, an app shell) that breaks a feature in the domain counts as yes. When nothing ties it to the domain or to another one, say unclear.

Answer with one line, nothing else:
${DOMAIN_MARKER} {"mine":"<yes|no|unclear>","reason":"<one short sentence naming the path or area that decided it>"}`;

// The cheap "is this mine?" check, before the full triage.
/** @param {{ config: OncallConfig, alert: Alert, context: EventContext | null }} params */
export function buildDomainPrompt({ config, alert, context }) {
  return `${DOMAIN_INSTRUCTIONS}

## The engineer's domain
${config.domain}
${formatRepoContext(config.repoProfile)}
## Issue
Short id: ${alert.shortId}
Title: ${alert.title}
Message: ${context?.message || "(none)"}
Culprit: ${alert.culprit || "(none)"}
Project: ${alert.project}

## Top frames
${formatFrames(context)}

## Tags of the latest event
${formatTags(context)}
`;
}

// The domain check's answer; null when it gave none.
/** @param {string} text @returns {DomainVerdict | null} */
export function parseDomainVerdict(text) {
  const line = text.split("\n").reverse().find((l) => l.includes(DOMAIN_MARKER));
  if (!line) return null;
  try {
    const raw = JSON.parse(line.slice(line.indexOf("{"), line.lastIndexOf("}") + 1));
    const mine = String(raw.mine ?? "").toLowerCase();
    if (!DOMAIN_ANSWERS.includes(mine)) return null;
    return { mine: /** @type {DomainVerdict["mine"]} */ (mine), reason: typeof raw.reason === "string" ? raw.reason.trim() : "" };
  } catch {
    return null;
  }
}

// The investigation guide at the top: the built-in skill's text (builtInGuide), or the picked
// skill run as /name.
/** @param {{ config: OncallConfig, builtInGuide: string }} params */
const getGuide = ({ config, builtInGuide }) => {
  if (config.triageSkill !== BUILT_IN_TRIAGE_SKILL) return `/${config.triageSkill}\n\nUse the skill above for the investigation, then answer in the format below.\n\n`;
  return builtInGuide ? `${builtInGuide}\n\n---\n\n` : "";
};

/** @param {{ config: OncallConfig, alert: Alert, context: EventContext | null, trigger: Trigger, domainVerdict?: DomainVerdict | null, builtInGuide?: string }} params */
export function buildPrompt({ config, alert, context, trigger, domainVerdict = null, builtInGuide = "" }) {
  const frames = formatFrames(context);
  const tags = formatTags(context);
  const domain = config.domain
    ? `\n## The engineer's domain\n${config.domain}\n${domainVerdict ? `\nA quick check said: ${domainVerdict.mine}, ${domainVerdict.reason}\n` : ""}`
    : "";
  const issue = [
    `Short id: ${alert.shortId}`, `Title: ${alert.title}`, `Message: ${context?.message || "(none)"}`, `Culprit: ${alert.culprit || "(none)"}`,
    `Project: ${alert.project}`, `Level: ${alert.level}`, `Sentry priority: ${alert.priority ?? "unknown"}`, `Status: ${alert.kind}`,
    `Why now: ${trigger}`, `Events: ${alert.count}`, `Users: ${alert.userCount}`, `First seen: ${alert.firstSeen}`, `Last seen: ${alert.lastSeen}`,
    `Unhandled: ${alert.isUnhandled ? "yes" : "no"}`, `Link: ${alert.url}`,
  ].join("\n");
  return `${getGuide({ config, builtInGuide })}${INSTRUCTIONS}

## Nudge me when
${formatRules(config.nudgeRules)}

## Never nudge me for
${formatRules(config.neverRules)}
${domain}${formatRepoContext(config.repoProfile)}
## Issue
${issue}

## Top frames
${frames}

## Tags of the latest event
${tags}
`;
}

// A SKILL.md without its frontmatter: the guide the built-in skill puts in the prompt.
/** @param {string} text */
export const stripFrontmatter = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, "").trim();

// The last verdict line of the AI's answer; null when it has none or it is broken.
/** @param {string} text @returns {Verdict | null} */
export function parseVerdict(text) {
  const line = text.split("\n").reverse().find((l) => l.includes(VERDICT_MARKER));
  if (!line) return null;
  try {
    const raw = JSON.parse(line.slice(line.indexOf("{"), line.lastIndexOf("}") + 1));
    const severity = String(raw.severity ?? "").toLowerCase();
    const owner = String(raw.owner ?? "").toLowerCase();
    if (!SEVERITY_WORDS.includes(severity) || typeof raw.summary !== "string") return null;
    return {
      severity: /** @type {Severity} */ (severity),
      // A skill's own verdict line may say who owns it instead: not another team's counts as a match.
      matches: typeof raw.matches === "boolean" ? raw.matches : OWNED_ANSWERS.includes(String(raw.owner ?? "").toLowerCase()),
      rule: typeof raw.rule === "string" && raw.rule.trim() ? raw.rule.trim() : null,
      summary: raw.summary.trim(),
      owner: OWNER_ANSWERS.find((answer) => answer === owner) ?? null,
    };
  } catch {
    return null;
  }
}

/** @param {string} text */
export const stripVerdict = (text) => text.split("\n").filter((l) => !l.includes(VERDICT_MARKER)).join("\n").trim();

// A verdict worth a nudge: it matches your rules and its severity is one you picked.
/** @param {{ verdict: Verdict, config: OncallConfig }} params */
export const shouldNotify = ({ verdict, config }) => verdict.matches && verdict.severity !== "ignore" && config.notifySeverities.includes(verdict.severity);

/**
 * @param {{ alert: Alert, trigger: Trigger, at: string, details: Partial<Decision> & Pick<Decision, "stage" | "outcome" | "summary"> }} params
 * @returns {Decision}
 */
export function toDecision({ alert, trigger, at, details }) {
  return {
    issueId: alert.id, shortId: alert.shortId, title: alert.title, project: alert.project, url: alert.url, kind: alert.kind,
    priority: alert.priority, count: alert.count, userCount: alert.userCount, lastSeen: alert.lastSeen,
    decidedAt: at, trigger, severity: null, matchedRule: null, owner: null, sessionId: null, reportPath: null, cwd: null, costUsd: null, isNotified: false,
    ...details,
  };
}

// The newest decisions, none older than KEEP_DAYS.
/** @param {{ decisions: Record<string, Decision>, now: number }} params @returns {Record<string, Decision>} */
export function pruneDecisions({ decisions, now }) {
  const kept = Object.values(decisions)
    .filter((d) => now - Date.parse(d.decidedAt) < KEEP_DAYS * DAY_MS)
    .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))
    .slice(0, KEEP_DECISIONS);
  return Object.fromEntries(kept.map((d) => [d.issueId, d]));
}

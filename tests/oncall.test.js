import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readOncallConfig, getMissingSetup, setOrg, pickProjects, pickSome, parseEnvironments, addRule, toggleRule, removeRule,
  POLL_MINUTES, NOTIFY_SEVERITY_OPTIONS, BUILT_IN_TRIAGE_SKILL,
} from "../mods/hub/oncall-config.js";
import { readFileSync } from "node:fs";
import { toAlert, toAlerts, toOrgs, toProjects, buildIssuesPath, toEventContext } from "../mods/hub/oncall-service/alerts.mjs";
import { selectWork, runFreeFilters, buildPrompt, buildDomainPrompt, parseVerdict, parseDomainVerdict, stripVerdict, stripFrontmatter, shouldNotify, toDecision, pruneDecisions } from "../mods/hub/oncall-service/triage.mjs";
import { extractArrayPatterns, collectNoiseRules, cleanCodeowners, buildScanPrompt, formatRepoContext } from "../mods/hub/oncall-service/repo-scan.mjs";
import { readDecisions, filterDecisions, getTodayStats, getNewNudges, seenKey, countUnseen, getDecidedBy, isRerunPending, getCountdownLeft, isCheckPending, splitReport } from "../mods/hub/oncall-decisions.js";

const org = { slug: "acme", name: "Acme", regionUrl: "https://de.sentry.io" };
const web = { id: "1", slug: "web" };
const api = { id: "2", slug: "api" };
const config = readOncallConfig({ isOn: true, org, projects: [web] });

/** @param {Partial<import("../mods/hub/oncall-service/alerts.mjs").Alert>} patch */
const alert = (patch = {}) => ({
  id: "42", shortId: "WEB-1A", title: "TypeError: x is undefined", culprit: "app/job.tsx", level: "error", priority: "high",
  project: "web", url: "https://acme.sentry.io/issues/42/", kind: "new", firstSeen: "2026-11-23T08:00:00Z", lastSeen: "2026-11-23T10:00:00Z",
  count: 40, userCount: 12, isUnhandled: true, ...patch,
});

test("a missing or broken On-call config reads as off with the defaults", () => {
  for (const saved of [undefined, null, "x", []]) {
    const c = readOncallConfig(saved);
    assert.equal(c.isOn, false);
    assert.equal(c.org, null);
    assert.deepEqual(c.projects, []);
    assert.equal(c.pollMinutes, 2);
    assert.deepEqual(c.environments, ["production"]);
    assert.deepEqual(c.notifySeverities, ["critical", "high"]);
    assert.deepEqual(c.aiPriorities, ["high", "medium"]);
    assert.equal(c.model, "sonnet");
    assert.deepEqual(c.nudgeRules, []);
    assert.equal(c.neverRules.length, 2);
    assert.equal(c.isSoundOn, true);
  }
});

test("broken fields fall back one by one; saved ones are kept", () => {
  const c = readOncallConfig({ pollMinutes: 3, model: "gpt", notifySeverities: ["nope"], environments: ["production", " staging ", "", 4], nudgeRules: [{ id: "a", text: "team rule", isOn: false }, { text: "no id" }], triageSkill: "bad name!" });
  assert.equal(c.pollMinutes, 2);
  assert.equal(c.model, "sonnet");
  assert.deepEqual(c.notifySeverities, ["critical", "high"]);
  assert.deepEqual(c.environments, ["production", "staging"]);
  assert.deepEqual(c.nudgeRules, [{ id: "a", text: "team rule", isOn: false }]);
  assert.equal(c.triageSkill, BUILT_IN_TRIAGE_SKILL);
  assert.ok(POLL_MINUTES.includes(readOncallConfig({ pollMinutes: 5 }).pollMinutes));
  assert.deepEqual(readOncallConfig({ environments: [] }).environments, []);
});

test("an org without a region falls back to sentry.io, and one without a name to its slug", () => {
  assert.deepEqual(readOncallConfig({ org: { slug: "acme" } }).org, { slug: "acme", name: "acme", regionUrl: "https://sentry.io" });
});

test("On-call can start once a token, an org and a project are set, in that order", () => {
  assert.equal(getMissingSetup({ config, hasToken: false }), "token");
  assert.equal(getMissingSetup({ config: { ...config, org: null }, hasToken: true }), "org");
  assert.equal(getMissingSetup({ config: { ...config, projects: [] }, hasToken: true }), "projects");
  assert.equal(getMissingSetup({ config, hasToken: true }), "repo");
  assert.equal(getMissingSetup({ config: { ...config, codeFolder: "/code/web" }, hasToken: true }), "domain");
  assert.equal(getMissingSetup({ config: { ...config, codeFolder: "/code/web", domain: "apps/web" }, hasToken: true }), null);
});

test("picking another org keeps each org's projects; picked project ids keep the org's order", () => {
  assert.equal(setOrg({ config, org }), config);
  assert.deepEqual(setOrg({ config, org: { ...org, slug: "other" } }).projects, []);
  const picked = { ...config, projects: [{ id: "1", slug: "web" }] };
  const other = setOrg({ config: picked, org: { ...org, slug: "other" } });
  assert.deepEqual(other.projectsByOrg[org.slug], [{ id: "1", slug: "web" }]);
  assert.deepEqual(setOrg({ config: other, org }).projects, [{ id: "1", slug: "web" }]);
  assert.deepEqual(pickProjects({ config, ids: [api.id, web.id], projects: [web, api] }).projects, [web, api]);
  assert.deepEqual(pickProjects({ config, ids: [api.id, "gone"], projects: [web, api] }).projects, [api]);
  assert.deepEqual(pickProjects({ config, ids: [], projects: [web, api] }).projects, []);
});

test("a multi-choice setting keeps its order and never goes empty", () => {
  assert.deepEqual(pickSome({ picked: ["high", "critical"], order: NOTIFY_SEVERITY_OPTIONS }), ["critical", "high"]);
  assert.deepEqual(pickSome({ picked: ["high", "nope"], order: NOTIFY_SEVERITY_OPTIONS }), ["high"]);
  assert.equal(pickSome({ picked: [], order: NOTIFY_SEVERITY_OPTIONS }), null);
  assert.deepEqual(parseEnvironments("production, staging  production"), ["production", "staging"]);
});

test("rules: added once (case-insensitive), switched off and removed", () => {
  const withRule = addRule({ config, list: "nudgeRules", text: "  Team Checkout issues ", id: "n1" });
  assert.deepEqual(withRule.nudgeRules, [{ id: "n1", text: "Team Checkout issues", isOn: true }]);
  assert.equal(addRule({ config: withRule, list: "nudgeRules", text: "team checkout ISSUES", id: "n2" }), withRule);
  assert.equal(addRule({ config, list: "nudgeRules", text: "   ", id: "n3" }), config);
  assert.equal(toggleRule({ config: withRule, list: "nudgeRules", id: "n1" }).nudgeRules[0].isOn, false);
  assert.deepEqual(removeRule({ config: withRule, list: "nudgeRules", id: "n1" }).nudgeRules, []);
});

test("a Sentry issue becomes an alert with its kind and priority", () => {
  const a = toAlert({
    id: "42", shortId: "WEB-1A", title: "TypeError", culprit: "app/job.tsx", level: "error", priority: "medium",
    project: { slug: "web" }, permalink: "https://x/42/", substatus: "regressed", firstSeen: "f", lastSeen: "l", count: "120", userCount: 33, isUnhandled: true,
  });
  assert.equal(a?.kind, "regressed");
  assert.equal(a?.priority, "medium");
  assert.equal(a?.count, 120);
  assert.equal(toAlert({ title: "no id" }), null);
  assert.equal(toAlert({ id: "1", title: "t", substatus: "archived_until_escalating" })?.kind, "other");
  assert.deepEqual(toAlerts({ not: "a list" }), []);
});

test("the issues path asks for unresolved errors of the picked projects and environments, seen in the window", () => {
  const url = new URL(`https://x${buildIssuesPath({ org: "acme", projectIds: ["1", "2"], environments: ["production"], hours: 12 })}`);
  assert.equal(url.pathname, "/organizations/acme/issues/");
  assert.equal(url.searchParams.get("query"), "is:unresolved issue.category:error lastSeen:-12h");
  assert.deepEqual(url.searchParams.getAll("project"), ["1", "2"]);
  assert.deepEqual(url.searchParams.getAll("environment"), ["production"]);
});

test("the latest event gives the message, app frames first and the useful tags", () => {
  const context = toEventContext({
    entries: [{ type: "exception", data: { values: [{ type: "TypeError", value: "x is undefined", stacktrace: { frames: [
      { function: "lib", filename: "node_modules/react.js", lineNo: 1, inApp: false },
      { function: "handleApply", filename: "app/apply.tsx", lineNo: 42, inApp: true },
    ] } }] } }],
    tags: [{ key: "url", value: "https://acme.com/apply" }, { key: "secret", value: "x" }, { key: "release", value: "" }],
  });
  assert.equal(context.message, "TypeError: x is undefined");
  assert.deepEqual(context.frames.map((f) => f.fn), ["handleApply", "lib"]);
  assert.deepEqual(context.tags, { url: "https://acme.com/apply" });
  assert.deepEqual(toEventContext(null), { message: "", frames: [], tags: {} });
});

test("orgs keep their region host and sort by name; projects sort by slug", () => {
  assert.deepEqual(toOrgs([{ slug: "b", name: "Beta", links: { regionUrl: "https://de.sentry.io" } }, { slug: "a", name: "Alpha" }, { name: "no slug" }]), [
    { slug: "a", name: "Alpha", regionUrl: "https://sentry.io" },
    { slug: "b", name: "Beta", regionUrl: "https://de.sentry.io" },
  ]);
  assert.deepEqual(toProjects([{ id: "2", slug: "web" }, { id: "1", slug: "api" }, { slug: "x" }]), [{ id: "1", slug: "api" }, { id: "2", slug: "web" }]);
});

const decided = (patch = {}) => toDecision({ alert: alert(), trigger: "new", at: "2026-11-23T10:00:00Z", details: { stage: "ai", outcome: "reported", summary: "s", ...patch } });

test("work: new issues in the window, held ones that grew, and ones that turned regressed or escalating", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  const work = (alerts, decisions = {}) => selectWork({ alerts, decisions, now, hours: 12 }).map((w) => w.trigger);
  assert.deepEqual(work([alert()]), ["new"]);
  assert.deepEqual(work([alert({ firstSeen: "2026-11-20T08:00:00Z" })]), []);
  assert.deepEqual(work([alert({ kind: "ongoing" })]), []);
  assert.deepEqual(work([alert({ kind: "escalating", firstSeen: "2026-10-01T08:00:00Z" })]), ["escalating"]);
  assert.deepEqual(work([alert()], { 42: decided() }), []);
  assert.deepEqual(work([alert({ kind: "regressed" })], { 42: decided() }), ["regressed"]);
  assert.deepEqual(work([alert({ kind: "regressed" })], { 42: decided({ kind: "regressed" }) }), []);
  const held = decided({ stage: "impact", outcome: "held" });
  assert.deepEqual(work([alert({ count: 1, userCount: 1 })], { 42: held }), []);
  assert.deepEqual(work([alert({ count: 9, userCount: 1 })], { 42: held }), ["grew"]);
});

test("free filters: other Sentry priorities skip the AI, small new issues wait, a re-run skips both", () => {
  assert.equal(runFreeFilters({ alert: alert({ priority: "low" }), trigger: "new", config })?.stage, "priority");
  assert.equal(runFreeFilters({ alert: alert({ count: 1, userCount: 1 }), trigger: "new", config })?.outcome, "held");
  assert.equal(runFreeFilters({ alert: alert({ count: 1, userCount: 1 }), trigger: "regressed", config }), null);
  assert.equal(runFreeFilters({ alert: alert({ priority: "low", count: 1, userCount: 1 }), trigger: "rerun", config }), null);
  assert.equal(runFreeFilters({ alert: alert(), trigger: "new", config }), null);
});

test("the prompt carries the rules that are on, the issue and the stack; a triage skill goes first", () => {
  const withRules = addRule({ config: toggleRule({ config, list: "neverRules", id: "never-bots" }), list: "nudgeRules", text: "Team Checkout issues", id: "n1" });
  const prompt = buildPrompt({ config: withRules, alert: alert(), context: { message: "boom", frames: [{ fn: "apply", file: "app/a.tsx", line: 3, isInApp: true }], tags: {} }, trigger: "new" });
  assert.match(prompt, /## Nudge me when\n- Team Checkout issues/);
  assert.match(prompt, /browser extensions/);
  assert.doesNotMatch(prompt, /bots, crawlers/);
  assert.match(prompt, /Short id: WEB-1A/);
  assert.match(prompt, /\[app\] apply at app\/a.tsx:3/);
  assert.ok(buildPrompt({ config: { ...config, triageSkill: "team-triage" }, alert: alert(), context: null, trigger: "new" }).startsWith("/team-triage\n"));
});

test("the verdict is the last marker line; broken ones are null and the marker is cut from the report", () => {
  const text = 'report\nONCALL_VERDICT {"severity":"HIGH","matches":true,"rule":"Team Checkout issues","summary":"Apply is broken"}';
  assert.deepEqual(parseVerdict(text), { severity: "high", matches: true, rule: "Team Checkout issues", summary: "Apply is broken", owner: null });
  assert.equal(parseVerdict("no verdict"), null);
  assert.equal(parseVerdict('ONCALL_VERDICT {"severity":"huge","summary":"x"}'), null);
  assert.equal(parseVerdict("ONCALL_VERDICT {broken"), null);
  assert.equal(stripVerdict(text), "report");
});

test("a nudge needs a matching rule and a severity you picked", () => {
  assert.equal(shouldNotify({ verdict: { severity: "high", matches: true, rule: null, summary: "" }, config }), true);
  assert.equal(shouldNotify({ verdict: { severity: "medium", matches: true, rule: null, summary: "" }, config }), false);
  assert.equal(shouldNotify({ verdict: { severity: "critical", matches: false, rule: null, summary: "" }, config }), false);
});

test("decisions older than two weeks are dropped", () => {
  const now = Date.parse("2026-11-23T10:00:00Z");
  const old = { ...decided(), issueId: "1", decidedAt: "2026-11-01T10:00:00Z" };
  const kept = pruneDecisions({ decisions: { 1: old, 42: decided() }, now });
  assert.deepEqual(Object.keys(kept), ["42"]);
});

test("the tab: newest first, Needs you by severity, search, today's stats, unseen and new nudges", () => {
  const items = {
    a: { ...decided({ severity: "high", isNotified: true }), issueId: "a", shortId: "WEB-A", decidedAt: "2026-11-23T09:00:00Z", costUsd: 0.5 },
    b: { ...decided({ severity: "critical", isNotified: true }), issueId: "b", shortId: "WEB-B", decidedAt: "2026-11-23T08:00:00Z", costUsd: 0.25 },
    c: { ...decided({ stage: "priority", outcome: "ignored" }), issueId: "c", shortId: "API-C", project: "api", decidedAt: "2026-11-23T10:00:00Z" },
    d: { ...decided({ severity: "low" }), issueId: "d", decidedAt: "2026-11-22T10:00:00Z", costUsd: 9 },
  };
  const decisions = readDecisions({ items });
  assert.deepEqual(decisions.map((d) => d.issueId), ["c", "a", "b", "d"]);
  assert.deepEqual(filterDecisions({ decisions, filters: { view: "attention" }, search: "" }).map((d) => d.issueId), ["b", "a"]);
  assert.deepEqual(filterDecisions({ decisions, filters: { view: "filtered" }, search: "" }).map((d) => d.issueId), ["c"]);
  assert.deepEqual(filterDecisions({ decisions, filters: { view: "all" }, search: "api" }).map((d) => d.issueId), ["c"]);
  const seen = [seenKey(items.a)];
  assert.equal(countUnseen({ decisions, seen }), 1);
  assert.deepEqual(getTodayStats({ decisions, seen, now: new Date("2026-11-23T12:00:00") }), { triaged: 3, filtered: 1, investigated: 2, unseen: 1, costUsd: 0.75 });
  assert.deepEqual(getNewNudges({ decisions, since: "2026-11-23T08:30:00Z" }).map((d) => d.issueId), ["a"]);
  assert.deepEqual(readDecisions(null), []);
});

test("the domain is kept trimmed and capped; empty means no domain check", () => {
  assert.equal(readOncallConfig({}).domain, "");
  assert.equal(readOncallConfig({ domain: "  /apps/web/ @acme/checkout \n" }).domain, "/apps/web/ @acme/checkout");
  assert.equal(readOncallConfig({ domain: "x".repeat(9000) }).domain.length, 8000);
});

test("the domain check gets the domain and the stack; the full triage hears its answer", () => {
  const withDomain = { ...config, domain: "/apps/shop-app/ @acme/checkout" };
  const context = { message: "boom", frames: [{ fn: "apply", file: "app:///shop-app/src/a.tsx", line: 3, isInApp: true }], tags: { url: "https://x/apply" } };
  const domainPrompt = buildDomainPrompt({ config: withDomain, alert: alert(), context });
  assert.match(domainPrompt, /## The engineer's domain\n\/apps\/shop-app\/ @acme\/checkout/);
  assert.match(domainPrompt, /shop-app\/src\/a.tsx:3/);
  assert.match(domainPrompt, /DOMAIN_VERDICT/);
  const full = buildPrompt({ config: withDomain, alert: alert(), context, trigger: "new", domainVerdict: { mine: "yes", reason: "shop-app" } });
  assert.match(full, /A quick check said: yes, shop-app/);
  assert.doesNotMatch(buildPrompt({ config, alert: alert(), context, trigger: "new" }), /engineer's domain/);
});

test("the domain verdict is yes, no or unclear; anything else is null", () => {
  assert.deepEqual(parseDomainVerdict('thinking\nDOMAIN_VERDICT {"mine":"NO","reason":"settings-app is Team Storm"}'), { mine: "no", reason: "settings-app is Team Storm" });
  assert.equal(parseDomainVerdict('DOMAIN_VERDICT {"mine":"maybe"}'), null);
  assert.equal(parseDomainVerdict("no marker"), null);
});

test("an issue outside the domain lands in Filtered, not Needs you", () => {
  const outside = { ...decided({ stage: "domain", outcome: "ignored", summary: "Not your domain" }), issueId: "x" };
  const decisions = readDecisions({ items: { x: outside } });
  assert.deepEqual(filterDecisions({ decisions, filters: { view: "filtered" }, search: "" }).map((d) => d.issueId), ["x"]);
  assert.deepEqual(filterDecisions({ decisions, filters: { view: "attention" }, search: "" }), []);
});

test("the built-in triage skill is the default and goes into the prompt as text, without its frontmatter", () => {
  assert.equal(readOncallConfig({}).triageSkill, BUILT_IN_TRIAGE_SKILL);
  const skill = readFileSync(new URL("../mods/hub/oncall-service/skills/oncall-triage/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /^---\nname: oncall-triage\n/);
  const guide = stripFrontmatter(skill);
  assert.ok(guide.startsWith("# On-call triage"));
  const prompt = buildPrompt({ config, alert: alert(), context: null, trigger: "new", builtInGuide: guide });
  assert.ok(prompt.startsWith("# On-call triage"));
  assert.doesNotMatch(prompt, /^\/oncall-triage/);
  assert.match(prompt, /ONCALL_VERDICT \{"severity"/);
  assert.ok(buildPrompt({ config, alert: alert(), context: null, trigger: "new" }).startsWith("You triage one Sentry issue"));
});

test("a skill's own verdict line with an owner counts as a match unless another team owns it", () => {
  const line = (owner) => `ONCALL_VERDICT {"severity":"HIGH","owner":"${owner}","ownerTeams":["frontend-checkout"],"summary":"Apply is broken"}`;
  assert.equal(parseVerdict(line("mine"))?.matches, true);
  assert.equal(parseVerdict(line("unclear"))?.matches, true);
  assert.equal(parseVerdict(line("other"))?.matches, false);
  assert.equal(parseVerdict('ONCALL_VERDICT {"severity":"high","matches":false,"owner":"mine","summary":"x"}')?.matches, false);
});

test("the scan reads ignoreErrors and denyUrls literals, regexes and spreads, each once", () => {
  const source = `Sentry.init({
    ignoreErrors: [
      'ResizeObserver loop limit exceeded', "Non-Error promise rejection", /chrome-extension:\\/\\//i,
      ...COMMON_IGNORED, \`Can't find variable: [x]\`,
    ],
    denyUrls: [/extensions\\//i, "googletagmanager.com"],
  })`;
  const { patterns, spreads } = extractArrayPatterns({ source, key: "ignoreErrors" });
  assert.deepEqual(patterns, ["ResizeObserver loop limit exceeded", "Non-Error promise rejection", "/chrome-extension:\\/\\//i", "Can't find variable: [x]"]);
  assert.deepEqual(spreads, ["COMMON_IGNORED"]);
  const rules = collectNoiseRules([{ path: "a.ts", source }, { path: "b.ts", source }]);
  assert.equal(rules.ignoreErrors.length, 4);
  assert.deepEqual(rules.denyUrls, ["/extensions\\//i", "googletagmanager.com"]);
  assert.deepEqual(extractArrayPatterns({ source: "const x = 1", key: "ignoreErrors" }), { patterns: [], spreads: [] });
});

test("CODEOWNERS loses comments and blanks; the scan prompt carries what code read", () => {
  assert.equal(cleanCodeowners("# owners\n\n/apps/web/ @acme/web\n  /packages/ui/ @acme/platform  \n"), "/apps/web/ @acme/web\n/packages/ui/ @acme/platform");
  const prompt = buildScanPrompt({ folder: "/code/web", facts: { codeowners: "/apps/web/ @acme/web", codeownersPath: ".github/CODEOWNERS", sentryFiles: ["apps/web/sentry.ts"], ignoreErrors: ["ResizeObserver"], denyUrls: [], spreads: ["COMMON_IGNORED"] } });
  assert.match(prompt, /## CODEOWNERS \(\.github\/CODEOWNERS\)\n\/apps\/web\/ @acme\/web/);
  assert.match(prompt, /## Spread into them \(resolve these\)\n- COMMON_IGNORED/);
  assert.match(prompt, /## denyUrls found\n- \(none\)/);
});

test("a saved repo profile is read back safely and goes into the triage and domain prompts", () => {
  const profile = { folder: "/code/web", scannedAt: "2026-11-24T09:00:00Z", codeowners: "/apps/web/ @acme/web", sentryFiles: ["apps/web/sentry.ts", 3], ignoreErrors: ["ResizeObserver"], denyUrls: [], summary: "## Apps and areas\n- apps/web", costUsd: 0.02 };
  const c = readOncallConfig({ ...config, repoProfile: profile });
  assert.deepEqual(c.repoProfile?.sentryFiles, ["apps/web/sentry.ts"]);
  assert.equal(readOncallConfig({ repoProfile: { summary: "no folder" } }).repoProfile, null);
  assert.equal(formatRepoContext(null), "");
  const prompt = buildPrompt({ config: c, alert: alert(), context: null, trigger: "new" });
  assert.match(prompt, /## Repo profile \(\/code\/web, scanned 2026-11-24\)\n## Apps and areas/);
  assert.match(prompt, /ignoreErrors:\n- ResizeObserver/);
  assert.match(prompt, /## CODEOWNERS\n\/apps\/web\/ @acme\/web/);
  assert.match(buildDomainPrompt({ config: { ...c, domain: "apps/web" }, alert: alert(), context: null }), /## Repo profile/);
});

test("the verdict keeps whose code broke; anything else is no owner", () => {
  const line = (owner) => `ONCALL_VERDICT {"severity":"high","matches":false,"owner":"${owner}","summary":"x"}`;
  assert.equal(parseVerdict(line("OTHER"))?.owner, "other");
  assert.equal(parseVerdict(line("mine"))?.owner, "mine");
  assert.equal(parseVerdict(line("someone"))?.owner, null);
});

test("decided by names the filter, the domain check or the AI, and the AI's other-team calls", () => {
  const decision = (patch) => toDecision({ alert: alert(), trigger: "new", at: "2026-11-24T10:00:00Z", details: { stage: "ai", outcome: "ignored", summary: "x", ...patch } });
  assert.equal(getDecidedBy(decision({ stage: "priority" })), "Priority filter");
  assert.equal(getDecidedBy(decision({ stage: "impact", outcome: "held" })), "Waiting for impact");
  assert.equal(getDecidedBy(decision({ stage: "domain" })), "Domain check");
  assert.equal(getDecidedBy(decision({})), "AI");
  assert.equal(getDecidedBy(decision({ owner: "other" })), "AI · other team");
  assert.equal(getDecidedBy(decision({ stage: "failed", outcome: "failed" })), "Triage failed");
});

test("a re-run spins until a newer decision lands, and gives up after 15 minutes", () => {
  const d = toDecision({ alert: alert(), trigger: "new", at: "2026-11-24T10:00:00.000Z", details: { stage: "ai", outcome: "ignored", summary: "x" } });
  const now = Date.parse("2026-11-24T10:05:00.000Z");
  assert.equal(isRerunPending({ decision: d, requestedAt: "2026-11-24T10:04:00.000Z", now }), true);
  assert.equal(isRerunPending({ decision: d, requestedAt: "2026-11-24T09:59:00.000Z", now }), false);
  assert.equal(isRerunPending({ decision: d, requestedAt: undefined, now }), false);
  assert.equal(isRerunPending({ decision: d, requestedAt: "2026-11-24T10:04:00.000Z", now: now + 16 * 60_000 }), false);
});

test("the filters narrow any view by severity, project, decided by, time and seen", () => {
  const items = {
    a: { ...decided({ severity: "high", isNotified: true }), issueId: "a", project: "web", decidedAt: "2026-11-24T09:30:00Z" },
    b: { ...decided({ severity: "critical", isNotified: true }), issueId: "b", project: "api", decidedAt: "2026-11-23T08:00:00Z" },
    c: { ...decided({ stage: "priority", outcome: "ignored" }), issueId: "c", project: "api", decidedAt: "2026-11-24T09:50:00Z" },
  };
  const decisions = readDecisions({ items });
  const now = Date.parse("2026-11-24T10:00:00Z");
  /** @param {object} filters */
  const ids = (filters, seen = []) => filterDecisions({ decisions, filters: { view: "all", ...filters }, search: "", seen, now }).map((d) => d.issueId);
  assert.deepEqual(ids({ severities: ["critical"] }), ["b"]);
  assert.deepEqual(ids({ projects: ["api"] }), ["c", "b"]);
  assert.deepEqual(ids({ decidedBy: ["Priority filter"] }), ["c"]);
  assert.deepEqual(ids({ time: "1h" }), ["c", "a"]);
  assert.deepEqual(ids({ seen: "unseen" }, [seenKey(items.a)]), ["b"]);
  assert.deepEqual(ids({ seen: "seen" }, [seenKey(items.a)]), ["c", "a"]);
});

test("the time left is 1 right after a check and 0 when the next one is due", () => {
  assert.equal(getCountdownLeft({ msLeft: 120_000, periodMs: 120_000 }), 1);
  assert.equal(getCountdownLeft({ msLeft: 60_000, periodMs: 120_000 }), 0.5);
  assert.equal(getCountdownLeft({ msLeft: 0, periodMs: 120_000 }), 0);
  assert.equal(getCountdownLeft({ msLeft: 999_999, periodMs: 120_000 }), 1);
  assert.equal(getCountdownLeft({ msLeft: 5, periodMs: 0 }), 0);
});

test("Check now spins until the service writes a new next check time, for at most 15 minutes", () => {
  const request = { at: Date.parse("2026-11-24T10:00:00Z"), nextPollAt: "2026-11-24T10:02:00Z" };
  const now = Date.parse("2026-11-24T10:00:30Z");
  assert.equal(isCheckPending({ request, nextPollAt: "2026-11-24T10:02:00Z", now }), true);
  assert.equal(isCheckPending({ request, nextPollAt: "2026-11-24T10:03:10Z", now }), false);
  assert.equal(isCheckPending({ request: null, nextPollAt: null, now }), false);
  assert.equal(isCheckPending({ request, nextPollAt: "2026-11-24T10:02:00Z", now: now + 16 * 60_000 }), false);
});

test("a report splits into markdown and diff blocks, an indented diff in a list included", () => {
  const report = [
    "## APP-1: loop",
    "- Suggested change:",
    "",
    "   ```diff",
    "   --- packages/form/useEditor.ts",
    "   +++ packages/form/useEditor.ts",
    "   @@ useEditor",
    "   -  callback(html)",
    "   +  callbackRef.current(html)",
    "      }",
    "   ```",
    "   Add `useLatest` to the import.",
  ].join("\n");
  const parts = splitReport(report);
  assert.deepEqual(parts.map((p) => p.kind), ["markdown", "diff", "markdown"]);
  const diff = parts[1];
  assert.ok(diff.kind === "diff");
  assert.deepEqual(diff.lines.map((l) => l.kind), ["file", "file", "hunk", "remove", "add", "context"]);
  assert.equal(diff.lines[3].text, "-  callback(html)");
  assert.equal(diff.lines[5].text, "   }");
  assert.deepEqual(splitReport("no code here"), [{ kind: "markdown", text: "no code here" }]);
  assert.deepEqual(splitReport("```diff\n+ a").map((p) => p.kind), ["markdown"]);
});

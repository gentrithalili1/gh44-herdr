#!/usr/bin/env node
// The On-call service: polls the issue tracker for the picked projects, runs free filters and an AI triage
// on what is left, and writes decisions and reports to disk, where the Omnia panel reads them.
// It runs under herdr-core (`hc run --name gh44-oncall`), so it keeps going while the Herdr
// window is closed, and stops when you go off call.
//
//   main.mjs run --home <dir>                        poll until stopped or off call
//   main.mjs orgs --home <dir> [--provider <id>] [--token-file <file>]   who the token is and its orgs (checks a new token)
//   main.mjs projects --home <dir>                   the saved org's projects
//   main.mjs preview --home <dir>                    what the next check would do, without the AI
//   main.mjs domain-test --home <dir>                the domain check on the latest issues (cheap model)
//   main.mjs scan --home <dir>                       the setup scan of the picked repo (cheap model)
//
// <dir> is the hub mod's data folder. The panel asks for a check or a re-run by dropping a file in
// <dir>/oncall/requests. Every command but run prints one JSON line.
import { readFile, writeFile, rename, mkdir, readdir, rm, stat } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readOncallConfig, DOMAIN_MODEL, BUILT_IN_TRIAGE_SKILL } from "../config.js";
import { getProvider } from "../providers/catalog.js";
import { PROVIDER_APIS } from "../providers/index.mjs";
import { ProviderError, UNAUTHORIZED } from "../providers/contract.js";
import { CODEOWNERS_PATHS, MAX_SETUP_FILES, cleanCodeowners, collectNoiseRules, buildScanPrompt } from "./repo-scan.mjs";
import {
  selectWork, runFreeFilters, buildPrompt, buildDomainPrompt, parseVerdict, parseDomainVerdict, stripVerdict, stripFrontmatter, shouldNotify, toDecision, pruneDecisions,
} from "./triage.mjs";

const MINUTE_MS = 60_000;
// While waiting for the next check, the requests folder is looked at this often.
const REQUEST_POLL_MS = 2_000;
// AI runs per check; the rest wait for the next check, so one burst can't run up a bill.
const MAX_AI_RUNS_PER_CHECK = 3;
const CLAUDE_TIMEOUT_MS = 15 * MINUTE_MS;
// The panel touches the heartbeat while Herdr runs; older than this, alerts go to macOS instead.
const HEARTBEAT_STALE_MS = 45_000;
const CHECK_NOW = "check-now";
const RERUN_PREFIX = "rerun-";

// Read-only tools for the triage, plus the provider's own (catalog.js); anything else is denied in print mode.
const ALLOWED_TOOLS = ["Read", "Grep", "Glob", "ToolSearch", "Bash(git log:*)", "Bash(git blame:*)", "Bash(git show:*)"];
const DISALLOWED_TOOLS = ["Edit", "Write", "NotebookEdit", "mcp__claude_ai_Slack"];

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { home: { type: "string" }, "token-file": { type: "string" }, provider: { type: "string" } },
});
const [command] = positionals;
if (!values.home) {
  print({ status: "error", reason: "failed", message: "--home is required" });
  process.exit(2);
}
const HOME = values.home;
const ONCALL = join(HOME, "oncall");
const paths = {
  config: join(ONCALL, "config.json"),
  alerts: join(ONCALL, "alerts.json"),
  status: join(ONCALL, "status.json"),
  decisions: join(ONCALL, "decisions.json"),
  reports: join(ONCALL, "reports"),
  requests: join(ONCALL, "requests"),
  heartbeat: join(ONCALL, "heartbeat"),
};

/** @param {unknown} value */
function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/** @param {string} line */
const log = (line) => process.stdout.write(`${new Date().toISOString()} ${line}\n`);

/** @param {unknown} error */
const toMessage = (error) => (error instanceof Error ? error.message : String(error));

/** @param {string} path */
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

// Written to a temp file first, so the panel never reads half a file.
/** @param {string} path @param {unknown} value */
async function writeJson(path, value) {
  await mkdir(ONCALL, { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}

// The provider's token: a new one being checked (--token-file), else the saved <provider>-token.
/** @param {import("../providers/catalog.js").ProviderId} provider */
async function readToken(provider) {
  const file = values["token-file"] ?? join(HOME, `${provider}-token`);
  const token = (await readFile(file, "utf8").catch(() => "")).trim();
  if (!token) throw new ProviderError({ status: UNAUTHORIZED, message: `No ${getProvider(provider).name} token saved` });
  return token;
}

/** @param {unknown} error */
const toFailure = (error) => ({
  status: "error",
  reason: error instanceof ProviderError && error.status === UNAUTHORIZED ? "auth" : "failed",
  message: toMessage(error),
});

const readConfig = async () => readOncallConfig(await readJson(paths.config));

// The token's owner and orgs; --provider names the tracker of a token not saved yet.
async function listOrgs() {
  const provider = getProvider(values.provider ?? (await readConfig()).provider).id;
  const token = await readToken(provider);
  return { status: "success", ...(await PROVIDER_APIS[provider].listOrgs({ token })) };
}

async function listProjects() {
  const config = await readConfig();
  if (!config.org) return { status: "error", reason: "failed", message: "Pick an organization first" };
  const token = await readToken(config.provider);
  return { status: "success", projects: await PROVIDER_APIS[config.provider].listProjects({ token, org: config.org }) };
}

// The picked projects' issues seen in the look-back window.
/** @param {{ config: OncallConfig, org: Org, token: string }} params */
const listIssues = ({ config, org, token }) => PROVIDER_APIS[config.provider].listIssues({
  token, org, projectIds: config.projects.map((p) => p.id), environments: config.environments, hours: config.catchUpHours,
});

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @typedef {import("../config.js").OncallConfig} OncallConfig */
/** @typedef {import("./triage.mjs").Decision} Decision */
/** @typedef {import("../providers/contract.js").Alert} Alert */
/** @typedef {import("../providers/contract.js").Org} Org */

// The panel's requests, taken (deleted) as they are read.
async function takeRequests() {
  const names = await readdir(paths.requests).catch(() => []);
  await Promise.all(names.map((name) => rm(join(paths.requests, name), { force: true })));
  return { isCheckNow: names.includes(CHECK_NOW), rerunIds: names.filter((n) => n.startsWith(RERUN_PREFIX)).map((n) => n.slice(RERUN_PREFIX.length)) };
}

/** @param {{ config: OncallConfig, token: string, issueId: string }} params */
const loadEventContext = ({ config, token, issueId }) => (config.org
  ? PROVIDER_APIS[config.provider].getContext({ token, org: config.org, id: issueId, environments: config.environments })
  : Promise.resolve(null));

// Headless `claude -p` with read-only tools, in the code folder when one is set.
// The domain check runs with no tools at all: it answers from the prompt.
/** @param {{ config: OncallConfig, prompt: string, cwd: string, model?: string, isToolless?: boolean }} params @returns {Promise<{ sessionId: string, text: string, isError: boolean, costUsd: number | null }>} */
function runClaude({ config, prompt, cwd, model = config.model, isToolless = false }) {
  return new Promise((resolve, reject) => {
    // The built-in skill is in the prompt itself; any other one runs through the Skill tool.
    const { aiTools } = getProvider(config.provider);
    const allowed = [...ALLOWED_TOOLS, ...aiTools.allowed, ...(config.triageSkill === BUILT_IN_TRIAGE_SKILL ? [] : ["Skill"])];
    const tools = isToolless ? ["--tools", ""] : ["--allowedTools", ...allowed, "--disallowedTools", ...DISALLOWED_TOOLS, ...aiTools.disallowed];
    const args = ["-p", "--output-format", "json", "--model", model, ...tools];
    // Its own process group, so nothing claude signals on exit reaches the service.
    const child = spawn(config.claudePath ?? "claude", args, { cwd, stdio: ["pipe", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), CLAUDE_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        reject(new Error(`claude stopped after ${CLAUDE_TIMEOUT_MS / MINUTE_MS} minutes`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve({ sessionId: String(parsed.session_id ?? ""), text: String(parsed.result ?? ""), isError: parsed.is_error === true, costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : null });
      } catch {
        reject(new Error(`claude exited ${code}: ${(stderr || stdout).trim().slice(0, 300)}`));
      }
    });
    child.stdin.end(prompt);
  });
}

const BUILT_IN_SKILL_FILE = new URL("../skills/oncall-triage/SKILL.md", import.meta.url);

// The bundled triage skill's steps; "" when the file can't be read (the prompt still has the rules).
async function readBuiltInGuide() {
  try {
    return stripFrontmatter(await readFile(BUILT_IN_SKILL_FILE, "utf8"));
  } catch (error) {
    log(`built-in triage skill not read: ${toMessage(error)}`);
    return "";
  }
}

/** @param {string} path */
const isFolder = async (path) => Boolean(await stat(path).then((s) => s.isDirectory()).catch(() => false));

// Herdr shows its own toast while the panel's heartbeat is fresh; without it, macOS does.
/** @param {{ config: OncallConfig, decision: Decision }} params */
async function notifyOutsideHerdr({ config, decision }) {
  const beat = await stat(paths.heartbeat).catch(() => null);
  if (beat && Date.now() - beat.mtimeMs < HEARTBEAT_STALE_MS) return;
  const title = `${(decision.severity ?? "").toUpperCase()} · ${decision.shortId}`;
  const script = `display notification ${JSON.stringify(decision.summary)} with title ${JSON.stringify(title)} subtitle ${JSON.stringify(decision.title.slice(0, 120))}${config.isSoundOn ? ' sound name "Glass"' : ""}`;
  await new Promise((resolve) => execFile("/usr/bin/osascript", ["-e", script], () => resolve(null)));
}

/** @param {{ config: OncallConfig, alert: Alert, trigger: import("./triage.mjs").Trigger, token: string }} params @returns {Promise<Decision>} */
async function triageWithAi({ config, alert, trigger, token }) {
  const at = new Date().toISOString();
  const context = await loadEventContext({ config, token, issueId: alert.id });
  const cwd = config.codeFolder && (await isFolder(config.codeFolder)) ? config.codeFolder : ONCALL;
  // "Is this mine?" first, on the cheap model; only yes or unclear goes on to the full triage.
  /** @type {import("./triage.mjs").DomainVerdict | null} */
  let domainVerdict = null;
  let domainCost = 0;
  if (config.domain && trigger !== "rerun") {
    try {
      const check = await runClaude({ config, prompt: buildDomainPrompt({ config, alert, context }), cwd: ONCALL, model: DOMAIN_MODEL, isToolless: true });
      domainVerdict = parseDomainVerdict(check.text);
      domainCost = check.costUsd ?? 0;
      log(`${alert.shortId}: domain ${domainVerdict?.mine ?? "no answer"}${domainVerdict?.reason ? `, ${domainVerdict.reason}` : ""}`);
    } catch (error) {
      log(`${alert.shortId}: domain check failed, full triage instead: ${toMessage(error)}`);
    }
    if (domainVerdict?.mine === "no") {
      return toDecision({ alert, trigger, at, details: { stage: "domain", outcome: "ignored", summary: `Not your domain: ${domainVerdict.reason}`, costUsd: domainCost } });
    }
  }
  const builtInGuide = config.triageSkill === BUILT_IN_TRIAGE_SKILL ? await readBuiltInGuide() : "";
  const prompt = buildPrompt({ config, alert, context, trigger, domainVerdict, builtInGuide });
  try {
    const run = await runClaude({ config, prompt, cwd });
    run.costUsd = (run.costUsd ?? 0) + domainCost;
    const verdict = parseVerdict(run.text);
    await mkdir(paths.reports, { recursive: true });
    const reportPath = join(paths.reports, `${alert.shortId}.md`);
    await writeFile(reportPath, `${stripVerdict(run.text)}\n\n[Open in ${getProvider(config.provider).name}](${alert.url})\n`, { mode: 0o600 });
    if (run.isError || !verdict) {
      return toDecision({ alert, trigger, at, details: { stage: "failed", outcome: "failed", summary: run.isError ? "Claude returned an error" : "Claude gave no verdict", sessionId: run.sessionId || null, reportPath, cwd, costUsd: run.costUsd } });
    }
    const isNudge = shouldNotify({ verdict, config });
    return toDecision({
      alert, trigger, at,
      details: {
        stage: "ai", outcome: verdict.matches && verdict.severity !== "ignore" ? "reported" : "ignored", severity: verdict.severity,
        matchedRule: verdict.rule, owner: verdict.owner, summary: verdict.summary, sessionId: run.sessionId || null, reportPath, cwd, costUsd: run.costUsd, isNotified: isNudge,
      },
    });
  } catch (error) {
    return toDecision({ alert, trigger, at, details: { stage: "failed", outcome: "failed", summary: toMessage(error), cwd } });
  }
}

// One check without the AI: how many issues, which would go to the AI, which the free filters stop.
async function previewCheck() {
  const config = await readConfig();
  if (!config.org || config.projects.length === 0) return { status: "error", reason: "failed", message: "Pick an organization and projects first" };
  const token = await readToken(config.provider);
  const alerts = await listIssues({ config, org: config.org, token });
  const decisions = (await readJson(paths.decisions))?.items ?? {};
  const work = selectWork({ alerts, decisions, now: Date.now(), hours: config.catchUpHours });
  const filtered = work.map((w) => ({ ...w, filter: runFreeFilters({ alert: w.alert, trigger: w.trigger, config }) }));
  const toAi = filtered.filter((w) => !w.filter);
  return {
    status: "success",
    issues: alerts.length,
    decided: alerts.length - work.length,
    toAi: toAi.map((w) => ({ shortId: w.alert.shortId, title: w.alert.title, trigger: w.trigger })),
    filtered: filtered.filter((w) => w.filter).map((w) => ({ shortId: w.alert.shortId, reason: w.filter?.summary ?? "" })),
    aiPerCheck: MAX_AI_RUNS_PER_CHECK,
  };
}

// The domain check on the few latest issues with a stack, to see it decide before it filters anything.
const DOMAIN_TEST_ISSUES = 5;
async function testDomain() {
  const config = await readConfig();
  if (!config.org || config.projects.length === 0) return { status: "error", reason: "failed", message: "Pick an organization and projects first" };
  if (!config.domain) return { status: "error", reason: "failed", message: "Save your domain first" };
  const token = await readToken(config.provider);
  const alerts = (await listIssues({ config, org: config.org, token })).filter((a) => a.priority !== "low").slice(0, DOMAIN_TEST_ISSUES);
  const results = await Promise.all(alerts.map(async (alert) => {
    const context = await loadEventContext({ config, token, issueId: alert.id });
    try {
      const check = await runClaude({ config, prompt: buildDomainPrompt({ config, alert, context }), cwd: ONCALL, model: DOMAIN_MODEL, isToolless: true });
      const verdict = parseDomainVerdict(check.text);
      return { shortId: alert.shortId, title: alert.title, mine: verdict?.mine ?? "no answer", reason: verdict?.reason ?? check.text.slice(0, 120), costUsd: check.costUsd ?? 0 };
    } catch (error) {
      return { shortId: alert.shortId, title: alert.title, mine: "failed", reason: toMessage(error), costUsd: 0 };
    }
  }));
  return { status: "success", results, costUsd: results.reduce((sum, r) => sum + r.costUsd, 0) };
}

// Polls until the config says off call (or hc kills it). A failed check is kept in status.json
// for the panel and retried on the next turn.
async function runService() {
  /** @type {Record<string, any>} */
  let status = { pid: process.pid, startedAt: new Date().toISOString(), lastPollAt: null, nextPollAt: null, lastError: null, alertCount: 0, current: null };
  const writeStatus = (patch = {}) => {
    status = { ...status, ...patch };
    return writeJson(paths.status, status);
  };
  const stop = async () => {
    await writeJson(paths.status, { ...status, pid: null, current: null, stoppedAt: new Date().toISOString() }).catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("SIGHUP", stop);
  /** @type {string[]} */
  let rerunIds = [];
  for (;;) {
    const config = await readConfig();
    if (!config.isOn || !config.org) await stop();
    const org = /** @type {NonNullable<OncallConfig["org"]>} */ (config.org);
    const at = new Date().toISOString();
    try {
      const token = await readToken(config.provider);
      const alerts = await listIssues({ config, org, token });
      await writeJson(paths.alerts, { fetchedAt: at, items: alerts });
      await writeStatus({ lastPollAt: at, lastError: null, alertCount: alerts.length });
      /** @type {Record<string, Decision>} */
      let decisions = (await readJson(paths.decisions))?.items ?? {};
      const work = selectWork({ alerts, decisions, now: Date.now(), hours: config.catchUpHours });
      for (const id of rerunIds) {
        const alert = alerts.find((a) => a.id === id) ?? (await PROVIDER_APIS[config.provider].getIssue({ token, org, id }));
        if (alert) work.unshift({ alert, trigger: "rerun" });
      }
      rerunIds = [];
      let aiRuns = 0;
      for (const { alert, trigger } of work) {
        const filtered = runFreeFilters({ alert, trigger, config });
        if (!filtered && aiRuns >= MAX_AI_RUNS_PER_CHECK) continue;
        if (!filtered) {
          aiRuns += 1;
          await writeStatus({ current: { shortId: alert.shortId, title: alert.title } });
          log(`${alert.shortId}: AI triage (${trigger})`);
        }
        const decision = filtered
          ? toDecision({ alert, trigger, at: new Date().toISOString(), details: filtered })
          : await triageWithAi({ config, alert, trigger, token });
        decisions = pruneDecisions({ decisions: { ...decisions, [alert.id]: decision }, now: Date.now() });
        await writeJson(paths.decisions, { items: decisions });
        if (decision.isNotified) await notifyOutsideHerdr({ config, decision });
        log(`${alert.shortId} → ${decision.outcome}${decision.severity ? ` ${decision.severity}` : ""}: ${decision.summary}`);
      }
      await writeStatus({ current: null });
    } catch (error) {
      await writeStatus({ lastPollAt: at, lastError: toFailure(error), current: null });
      log(`check failed: ${toMessage(error)}`);
    }
    // Wait for the next check, or less when the panel asks for one.
    const nextAt = Date.now() + config.pollMinutes * MINUTE_MS;
    await writeStatus({ nextPollAt: new Date(nextAt).toISOString() });
    while (Date.now() < nextAt) {
      await sleep(REQUEST_POLL_MS);
      const requests = await takeRequests();
      rerunIds = [...rerunIds, ...requests.rerunIds];
      if (requests.isCheckNow || rerunIds.length > 0) break;
      if (!(await readConfig()).isOn) await stop();
    }
  }
}

// The scan's AI part: the cheap model, reading the repo.
const SCAN_MODEL = "haiku";

/** @param {{ args: string[], cwd: string }} params @returns {Promise<string>} */
const runGit = ({ args, cwd }) => new Promise((resolve) => {
  execFile("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => resolve(error ? "" : String(stdout)));
});

// What code reads exactly: CODEOWNERS and the noise rules in the tracker SDK's setup files.
/** @param {{ folder: string, provider: import("../providers/catalog.js").Provider }} params @returns {Promise<import("./repo-scan.mjs").RepoFacts>} */
async function readRepoFacts({ folder, provider }) {
  let codeowners = "";
  let codeownersPath = null;
  for (const path of CODEOWNERS_PATHS) {
    const text = await readFile(join(folder, path), "utf8").catch(() => null);
    if (text !== null) {
      codeowners = cleanCodeowners(text);
      codeownersPath = path;
      break;
    }
  }
  const { filePattern, noiseKeys } = provider.setupScan;
  const listed = await runGit({ args: ["grep", "-l", "-I", "-E", filePattern, "--", ".", ":!*.test.*", ":!*.spec.*", ":!**/__tests__/**"], cwd: folder });
  const setupFiles = listed.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, MAX_SETUP_FILES);
  const files = await Promise.all(setupFiles.map(async (path) => ({ path, source: await readFile(join(folder, path), "utf8").catch(() => "") })));
  return { codeowners, codeownersPath, setupFiles, ...collectNoiseRules({ files, keys: noiseKeys }) };
}

// The setup scan of the picked repo: the facts code reads, then a short AI summary of the rest.
async function scanRepo() {
  const config = await readConfig();
  const folder = config.codeFolder;
  if (!folder || !(await isFolder(folder))) return { status: "error", reason: "failed", message: "Pick your repo folder first" };
  const provider = getProvider(config.provider);
  const facts = await readRepoFacts({ folder, provider });
  const run = await runClaude({ config, prompt: buildScanPrompt({ folder, facts, provider }), cwd: folder, model: SCAN_MODEL });
  if (run.isError || !run.text.trim()) return { status: "error", reason: "failed", message: "The AI part of the scan gave no answer" };
  /** @type {import("../config.js").RepoProfile} */
  const profile = {
    folder, scannedAt: new Date().toISOString(), codeowners: facts.codeowners, setupFiles: facts.setupFiles,
    noiseRules: facts.noiseRules, summary: run.text.trim(), costUsd: run.costUsd,
  };
  return { status: "success", profile };
}

try {
  switch (command) {
    case "run":
      await runService();
      break;
    case "orgs":
      print(await listOrgs());
      break;
    case "projects":
      print(await listProjects());
      break;
    case "preview":
      print(await previewCheck());
      break;
    case "domain-test":
      print(await testDomain());
      break;
    case "scan":
      print(await scanRepo());
      break;
    default:
      print({ status: "error", reason: "failed", message: `Unknown command ${command ?? "(none)"}` });
      process.exit(2);
  }
} catch (error) {
  print(toFailure(error));
  process.exit(1);
}

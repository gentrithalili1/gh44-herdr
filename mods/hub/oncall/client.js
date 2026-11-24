// On-call I/O for the panel: the saved setup, the Sentry token and starting or stopping the
// background service under herdr-core. The service (oncall/service/main.mjs) does the Sentry calls;
// the panel runs it for one-off answers (orgs, projects) and reads the files it writes.
// The token sits in a file only the user can read, like the Linear key.
import { exec, hc, run, appHome, readTextFile, writeTextFile, spaces } from "herdr";
import { readOncallConfig, SERVICE_NAME } from "./config.js";
import { readDecisions } from "./decisions.js";

const getDataFolder = () => `${appHome()}/hub`;
const getOncallFolder = () => `${getDataFolder()}/oncall`;
const getTokenFile = () => `${getDataFolder()}/sentry-token`;
const getConfigFile = () => `${getOncallFolder()}/config.json`;
const getStatusFile = () => `${getOncallFolder()}/status.json`;
const getDecisionsFile = () => `${getOncallFolder()}/decisions.json`;
const getRequestsFolder = () => `${getOncallFolder()}/requests`;
const getHeartbeatFile = () => `${getOncallFolder()}/heartbeat`;
const ALERT_SOUND = "/System/Library/Sounds/Glass.aiff";
const getServiceFile = () => `${appHome()}/mods/hub/oncall/service/main.mjs`;
const SERVICE_TIMEOUT_MS = 120_000;
// The repo scan reads the repo with the AI: give it longer.
const SCAN_TIMEOUT_MS = 600_000;
// Asked of the login shell when Herdr's own PATH has no node (fnm, nvm, asdf set it up there).
// The service shares oncall-config.js with the panel, a .js file Node reads as ES module with a warning.
const NODE_FLAGS = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];
// The login shell's answer, for a program Herdr's own PATH lacks (fnm, nvm, asdf set PATH up there).
const FROM_LOGIN_SHELL = 'exec "${SHELL:-/bin/zsh}" -lic "$0" 2>/dev/null';
const NO_NODE = "Node.js was not found. Install Node 22 or newer.";
const NO_CLAUDE = "Claude Code (claude) was not found. Install it to run the AI triage.";

/** @typedef {import("./config.js").OncallConfig} OncallConfig */
/** @typedef {{ status: "error", reason: "auth" | "failed" | "noNode", message?: string }} OncallError */
/**
 * @typedef {{
 *   isRunning: boolean, startedAt: string | null, lastPollAt: string | null, nextPollAt: string | null,
 *   alertCount: number, lastError: { reason: string, message: string } | null,
 *   current: { shortId: string, title: string } | null,
 * }} ServiceStatus
 */

/** @param {unknown} error */
const toMessage = (error) => (error instanceof Error ? error.message : String(error));

/** @param {string | null} text */
const parseJson = (text) => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

/** @param {string} text */
const lastLine = (text) => text.trim().split("\n").pop() ?? "";

/** @returns {Promise<OncallConfig>} */
export async function loadOncallConfig() {
  return readOncallConfig(parseJson(await readTextFile(getConfigFile())));
}

// Written whole each time; the folder is the user's alone.
/** @param {OncallConfig} config @returns {Promise<OncallError | { status: "success" }>} */
export async function saveOncallConfig(config) {
  try {
    const made = await exec("sh", ["-c", 'mkdir -p "$0" && chmod 700 "$1" "$0"', getOncallFolder(), getDataFolder()]);
    if (made.code !== 0) return { status: "error", reason: "failed", message: made.stderr.trim() };
    const file = getConfigFile();
    await writeTextFile(file, `${JSON.stringify(config, null, 2)}\n`, await readTextFile(file));
    return { status: "success" };
  } catch (error) {
    return { status: "error", reason: "failed", message: toMessage(error) };
  }
}

export const hasSentryToken = async () => Boolean((await readTextFile(getTokenFile()))?.trim());

// A program's absolute path: the saved one while it still runs, else Herdr's PATH, else the login shell's.
/** @param {{ saved: string | null, probe: string[] }} params @returns {Promise<string | null>} */
async function findProgram({ saved, probe }) {
  if (saved && (await exec("test", ["-x", saved])).code === 0) return saved;
  /** @returns {null} */
  const none = () => null;
  const line = probe.join(" ");
  const direct = await exec("sh", ["-c", line]).catch(none);
  const directPath = direct?.code === 0 ? lastLine(direct.stdout) : "";
  if (directPath.startsWith("/")) return directPath;
  const shell = await exec("sh", ["-c", FROM_LOGIN_SHELL, line]).catch(none);
  const path = shell ? lastLine(shell.stdout) : "";
  return path.startsWith("/") ? path : null;
}

// The real node binary, not a version manager's per-shell shim.
/** @param {OncallConfig} config */
const findNode = (config) => findProgram({ saved: config.nodePath, probe: ["node", "-p", "process.execPath"] });
/** @param {OncallConfig} config */
const findClaude = (config) => findProgram({ saved: config.claudePath, probe: ["command", "-v", "claude"] });

// One service command, its JSON answer.
/** @param {{ args: string[], config: OncallConfig, timeout?: number }} params @returns {Promise<any>} */
async function runServiceCommand({ args, config, timeout = SERVICE_TIMEOUT_MS }) {
  const node = await findNode(config);
  if (!node) return { status: "error", reason: "noNode", message: NO_NODE };
  const r = await exec(node, [...NODE_FLAGS, getServiceFile(), ...args, "--home", getDataFolder()], { timeout });
  return parseJson(lastLine(r.stdout)) ?? { status: "error", reason: "failed", message: lastLine(r.stderr) || `The service exited with ${r.code}` };
}

// Checks the token with Sentry first and keeps it only when Sentry accepts it.
/** @param {string} token @returns {Promise<OncallError | { status: "success", user: string | null, orgs: import("./config.js").SentryOrg[] }>} */
export async function saveSentryToken(token) {
  const value = token.trim();
  if (!/^\S+$/.test(value)) return { status: "error", reason: "failed", message: "Paste the token as one word, without spaces" };
  const pending = `${getTokenFile()}.${Date.now()}-${Math.random().toString(36).slice(2)}.pending`;
  /** @param {OncallError} failure */
  const fail = async (failure) => {
    await exec("rm", ["-f", pending]);
    return failure;
  };
  try {
    const made = await exec("sh", ["-c", 'mkdir -p "$0" && chmod 700 "$0"', getDataFolder()]);
    if (made.code !== 0) return await fail({ status: "error", reason: "failed", message: made.stderr.trim() });
    await writeTextFile(pending, `${value}\n`, null);
    const locked = await exec("chmod", ["600", pending]);
    if (locked.code !== 0) return await fail({ status: "error", reason: "failed", message: locked.stderr.trim() });
    const r = await runServiceCommand({ args: ["orgs", "--token-file", pending], config: await loadOncallConfig() });
    if (r.status !== "success") return await fail(r);
    const moved = await exec("mv", ["-f", pending, getTokenFile()]);
    if (moved.code !== 0) return await fail({ status: "error", reason: "failed", message: moved.stderr.trim() });
    return r;
  } catch (error) {
    return await fail({ status: "error", reason: "failed", message: toMessage(error) });
  }
}

/** @returns {Promise<OncallError | { status: "success" }>} */
export async function removeSentryToken() {
  const r = await exec("rm", ["-f", getTokenFile()]);
  return r.code === 0 ? { status: "success" } : { status: "error", reason: "failed", message: r.stderr.trim() };
}

// Who the saved token is and its orgs.
/** @returns {Promise<OncallError | { status: "success", user: string | null, orgs: import("./config.js").SentryOrg[] }>} */
export async function loadSentryAccount() {
  if (!(await hasSentryToken())) return { status: "error", reason: "auth" };
  return runServiceCommand({ args: ["orgs"], config: await loadOncallConfig() });
}

/** @returns {Promise<OncallError | { status: "success", projects: import("./config.js").SentryProject[] }>} */
export async function loadSentryProjects() {
  return runServiceCommand({ args: ["projects"], config: await loadOncallConfig() });
}

const isServiceLive = async () => {
  const r = await hc(["get", SERVICE_NAME, "--json"]);
  return r.code === 0 && parseJson(r.stdout)?.state === "live";
};

/** @returns {Promise<ServiceStatus>} */
export async function loadServiceStatus() {
  const [isRunning, saved] = await Promise.all([isServiceLive(), readTextFile(getStatusFile()).then(parseJson)]);
  const s = saved ?? {};
  return {
    isRunning,
    startedAt: isRunning ? s.startedAt ?? null : null,
    lastPollAt: s.lastPollAt ?? null,
    nextPollAt: isRunning ? s.nextPollAt ?? null : null,
    alertCount: Number(s.alertCount) || 0,
    current: isRunning && s.current?.shortId ? { shortId: String(s.current.shortId), title: String(s.current.title ?? "") } : null,
    lastError: s.lastError ? { reason: String(s.lastError.reason), message: String(s.lastError.message ?? "") } : null,
  };
}

// Starts the service unless it runs already. Saves isOn, so Herdr starts it again after a restart.
/** @param {OncallConfig} config @returns {Promise<OncallError | { status: "success", config: OncallConfig }>} */
export async function startOncall(config) {
  const node = await findNode(config);
  if (!node) return { status: "error", reason: "noNode", message: NO_NODE };
  const claude = await findClaude(config);
  if (!claude) return { status: "error", reason: "failed", message: NO_CLAUDE };
  const next = { ...config, isOn: true, nodePath: node, claudePath: claude };
  const saved = await saveOncallConfig(next);
  if (saved.status !== "success") return saved;
  if (await isServiceLive()) return { status: "success", config: next };
  const r = await hc(["run", "--bg", "--rm", "--no-parent", "--name", SERVICE_NAME, "--cwd", getOncallFolder(), "--json", "--",
    node, ...NODE_FLAGS, getServiceFile(), "run", "--home", getDataFolder()]);
  if (r.code !== 0) return { status: "error", reason: "failed", message: lastLine(r.stderr) || lastLine(r.stdout) || "hc run failed" };
  return { status: "success", config: next };
}

// Off call: saved first (the service also stops itself on its next turn), then the service ends.
/** @param {OncallConfig} config @returns {Promise<OncallError | { status: "success", config: OncallConfig }>} */
export async function stopOncall(config) {
  const next = { ...config, isOn: false };
  const saved = await saveOncallConfig(next);
  if (saved.status !== "success") return saved;
  if (await isServiceLive()) await hc(["kill", SERVICE_NAME]);
  return { status: "success", config: next };
}

// On call when Herdr last closed, and the service is gone (a reboot, a crash): start it again.
// Nothing happens when off call or not set up.
/** @returns {Promise<OncallError | { status: "success" | "skipped" }>} */
export async function resumeOncall() {
  const config = await loadOncallConfig();
  if (!config.isOn || !config.org || config.projects.length === 0 || !(await hasSentryToken())) return { status: "skipped" };
  if (await isServiceLive()) return { status: "skipped" };
  const r = await startOncall(config);
  return r.status === "success" ? { status: "success" } : r;
}

/** @returns {Promise<import("./decisions.js").Decision[]>} */
export async function loadDecisions() {
  return readDecisions(parseJson(await readTextFile(getDecisionsFile())));
}

// The service picks a request up within seconds while it waits for its next check.
/** @param {string} name @returns {Promise<OncallError | { status: "success" }>} */
async function sendRequest(name) {
  const r = await exec("sh", ["-c", 'mkdir -p "$0" && : > "$0/$1"', getRequestsFolder(), name]);
  return r.code === 0 ? { status: "success" } : { status: "error", reason: "failed", message: r.stderr.trim() };
}

export const requestCheckNow = () => sendRequest("check-now");
/** @param {string} issueId */
export const requestRerun = (issueId) => sendRequest(`rerun-${issueId.replace(/[^\w-]/g, "")}`);

// Tells the service Herdr is open, so its alerts show as Herdr toasts instead of macOS ones.
export const touchHeartbeat = () => exec("sh", ["-c", 'mkdir -p "$0" && touch "$1"', getOncallFolder(), getHeartbeatFile()]);

export const playAlertSound = () => exec("afplay", [ALERT_SOUND]);

// The AI's report as a markdown tab of its own.
/** @param {import("./decisions.js").Decision} decision */
export function openReport(decision) {
  if (!decision.reportPath) return false;
  // In its own tab; a report already open in the shown space is switched to instead.
  const name = `${decision.shortId} report`;
  const space = spaces().find((s) => s.active);
  const open = space?.tabs.find((tab) => tab.name === name);
  if (open) {
    run("tab.select", { id: open.id });
    return true;
  }
  run("tab.new", { name, mod: "hub", props: { report: { path: decision.reportPath, title: name, url: decision.url } }, ...(space ? { space: space.id } : {}) });
  return true;
}

// Picks up the triage's Claude session in a new tab, in the folder it ran in.
/** @param {{ decision: import("./decisions.js").Decision, config: { claudePath: string | null } }} params */
export function continueInClaude({ decision, config }) {
  if (!decision.sessionId) return false;
  const argv = [config.claudePath ?? "claude", "--resume", decision.sessionId];
  run("tab.new", { name: `${decision.shortId} investigate`, argv, folder: decision.cwd ?? getOncallFolder() });
  return true;
}

/** @param {string} path */
export const loadReport = (path) => readTextFile(path);

// What the next check would do, without the AI: issue count, what goes to the AI and what the filters stop.
/** @returns {Promise<OncallError | { status: "success", issues: number, decided: number, toAi: { shortId: string, title: string, trigger: string }[], filtered: { shortId: string, reason: string }[], aiPerCheck: number }>} */
export async function loadPreview() {
  return runServiceCommand({ args: ["preview"], config: await loadOncallConfig() });
}

// The domain check on the latest issues: what it would keep and drop, and what that cost.
/** @returns {Promise<OncallError | { status: "success", results: { shortId: string, title: string, mine: string, reason: string, costUsd: number }[], costUsd: number }>} */
export async function testDomain() {
  const config = await loadOncallConfig();
  const claude = await findClaude(config);
  if (!claude) return { status: "error", reason: "failed", message: NO_CLAUDE };
  if (claude !== config.claudePath) await saveOncallConfig({ ...config, claudePath: claude });
  return runServiceCommand({ args: ["domain-test"], config });
}

// The setup scan of the saved repo folder: CODEOWNERS, the Sentry noise rules and an AI summary.
/** @returns {Promise<OncallError | { status: "success", profile: import("./config.js").RepoProfile }>} */
export async function scanRepo() {
  const config = await loadOncallConfig();
  const claude = await findClaude(config);
  if (!claude) return { status: "error", reason: "failed", message: NO_CLAUDE };
  if (claude !== config.claudePath) await saveOncallConfig({ ...config, claudePath: claude });
  return runServiceCommand({ args: ["scan"], config, timeout: SCAN_TIMEOUT_MS });
}

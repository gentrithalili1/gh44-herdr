// Starting a gh44 skill in a new Claude tab: here, in the background, or in the ticket's worktree.
// Also Ask, and the gh44 installs and uninstall.
import { run, spaces, agents, appHome, home, notify, openOverlay, exec } from "herdr";
import { moveIssueToInProgress } from "./linear.js";
import { getIssueStage, shortSkill, getAskPrompt, ASK_ACTION } from "./settings.js";

// Starting work on a ticket that is not started yet moves it to In Progress.
const NOT_STARTED_STAGES = ["backlog", "todo"];

async function startIssue(issue) {
  const r = await moveIssueToInProgress(issue);
  if (r.status === "success") {
    notify({ title: `${issue.identifier} moved to ${r.state}`, level: "info" });
    return;
  }
  const body = r.reason === "auth" ? "Add your Linear API key in the Work panel's ⚙ settings." : r.message;
  notify({ title: `Could not move ${issue.identifier} to In Progress`, body, level: "warning" });
}

// Whether the gh44 Herdr themes are in Herdr's themes folder. null: couldn't check.
/** @returns {Promise<boolean | null>} */
export async function loadHasGh44Theme() {
  try {
    return (await exec("test", ["-f", `${appHome()}/themes/gh44-dark.json`])).code === 0;
  } catch {
    return null;
  }
}

const GITHUB_OWNER_URL = "https://github.com/gentrithalili1";
const CLONE_TIMEOUT_MS = 60_000;
const BRAIN_INSTALL_TIMEOUT_MS = 600_000;
const ERROR_TAIL_LINES = 3;

/** @typedef {{ status: "success" } | { status: "failed", reason: "notLinked" | "clone" | "install", message?: string }} InstallOutcome */
/** @type {Record<"notLinked" | "clone" | "install", string>} */
export const INSTALL_ERRORS = {
  notLinked: "The hub mod is not linked from gh44-herdr. Run gh44-herdr/install.sh.",
  clone: "git clone failed. Check your network and GitHub access.",
  install: "The install failed.",
};

// The gh44-herdr checkout, from the hub mod's link. null: the mod is not linked.
async function getGh44HerdrFolder() {
  const link = await exec("readlink", [`${appHome()}/mods/hub`]);
  const target = link.stdout.trim();
  if (link.code !== 0 || !target) return null;
  return target.replace(/\/mods\/hub\/?$/, "");
}

// The gh44 folder that holds gh44-herdr. null: the mod is not linked.
async function getGh44Folder() {
  const folder = await getGh44HerdrFolder();
  return folder ? folder.replace(/\/[^/]+$/, "") : null;
}

/** @param {string} output */
const lastLines = (output) => output.trim().split("\n").slice(-ERROR_TAIL_LINES).join("\n");

// Clones a gh44 repo next to gh44-herdr, where install.sh looks for it. A clone already there is reused.
/** @param {{ name: "gh44-theme" | "gh44-brain" }} params @returns {Promise<{ status: "success", folder: string } | InstallOutcome>} */
async function cloneGh44Repo({ name }) {
  const parent = await getGh44Folder();
  if (!parent) return { status: "failed", reason: "notLinked" };
  const folder = `${parent}/${name}`;
  if ((await exec("test", ["-d", `${folder}/.git`])).code === 0) return { status: "success", folder };
  const clone = await exec("git", ["clone", "-q", `${GITHUB_OWNER_URL}/${name}.git`, folder], { timeout: CLONE_TIMEOUT_MS });
  return clone.code === 0 ? { status: "success", folder } : { status: "failed", reason: "clone", message: lastLines(clone.stderr) };
}

// gh44-theme: cloned, then its Herdr themes copied into Herdr's themes folder.
/** @returns {Promise<InstallOutcome>} */
export async function installGh44Theme() {
  try {
    const repo = await cloneGh44Repo({ name: "gh44-theme" });
    if (repo.status === "failed") return repo;
    if (!("folder" in repo)) return { status: "failed", reason: "clone" };
    const copy = await exec("sh", ["-c", 'mkdir -p "$1" && cp "$0"/herdr/*.json "$1"/', repo.folder, `${appHome()}/themes`]);
    return copy.code === 0 ? { status: "success" } : { status: "failed", reason: "install", message: lastLines(copy.stderr) };
  } catch (error) {
    return { status: "failed", reason: "install", message: String(error) };
  }
}

// gh44-brain: cloned, then its install.sh links the skills into ~/.claude.
/** @returns {Promise<InstallOutcome>} */
export async function installGh44Brain() {
  try {
    const repo = await cloneGh44Repo({ name: "gh44-brain" });
    if (repo.status === "failed") return repo;
    if (!("folder" in repo)) return { status: "failed", reason: "clone" };
    const install = await exec("bash", [`${repo.folder}/install.sh`], { cwd: repo.folder, timeout: BRAIN_INSTALL_TIMEOUT_MS });
    return install.code === 0 ? { status: "success" } : { status: "failed", reason: "install", message: lastLines(install.stderr || install.stdout) };
  } catch (error) {
    return { status: "failed", reason: "install", message: String(error) };
  }
}

/** @typedef {{ status: "started" } | { status: "failed", reason: "notLinked" | "start", message?: string }} UninstallOutcome */

// gh44-herdr's uninstall.sh, detached: it removes this panel's mod, so it must outlive it.
/** @returns {Promise<UninstallOutcome>} */
export async function uninstallGh44Herdr() {
  try {
    const folder = await getGh44HerdrFolder();
    if (!folder) return { status: "failed", reason: "notLinked" };
    const start = await exec("sh", ["-c", 'nohup bash "$0" >/dev/null 2>&1 &', `${folder}/uninstall.sh`]);
    return start.code === 0 ? { status: "started" } : { status: "failed", reason: "start", message: lastLines(start.stderr) };
  } catch (error) {
    return { status: "failed", reason: "start", message: String(error) };
  }
}

// The skills in ~/.claude/skills: its folders and symlinks, not plain files.
// [] when the folder doesn't exist; null when it couldn't be listed (unknown, keep the defaults).
/** @returns {Promise<string[] | null>} */
export async function loadInstalledSkills() {
  const folder = `${home()}/.claude/skills`;
  try {
    if ((await exec("test", ["-e", folder])).code !== 0) return [];
    const r = await exec("find", [folder, "-mindepth", "1", "-maxdepth", "1", "(", "-type", "d", "-o", "-type", "l", ")"]);
    if (r.code !== 0) return null;
    return r.stdout.split("\n").map((path) => path.trim().split("/").pop()).filter((name) => name && !name.startsWith("."));
  } catch {
    return null;
  }
}

// A space already working on this branch, other than the shown one.
export const findSpaceOnBranch = (branch) => (branch ? spaces().find((s) => !s.active && s.branch === branch) ?? null : null);

// Most urgent first, like Herdr's own space and tab status.
const STATUS_RANK = { blocked: 0, done: 1, working: 2, idle: 3 };

// The agent working on an item: in a tab this panel named after it ("THU-123 plan",
// "#123 code-review"), or anywhere in a space on its branch. The most urgent one wins.
export function findAgentFor({ label, branch }) {
  const branchSpaces = new Set(spaces().filter((s) => branch && s.branch === branch).map((s) => s.id));
  const matches = agents().filter((a) => a.tab_name?.startsWith(`${label} `) || branchSpaces.has(a.space));
  return matches.sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || b.seq - a.seq)[0] ?? null;
}

export function focusAgent(agent) {
  run("space.select", { id: agent.space });
  run("tab.select", { id: agent.tab });
}

// target: { ref (what the skill gets), prRef? (for PR skills), label (tab name prefix),
//   branch?, folder?, main? (the repo's main checkout), worktree? (an existing checkout of the branch),
//   space? (a space already open on the branch), issue? (the Linear issue, for its status) }
// role (settings.js getSkillRole): a review skill gets prRef, a work skill moves a not started ticket.
// isBackground: open the tab without switching to it (reviews). isWorktree: in the ticket's worktree.
// Ask runs as startAsk. Resolves once a new worktree's branch is ready and its dialog is open.
export async function startSkill({ skill, target, role = "other", isWorktree = false, isBackground = false }) {
  if (skill === ASK_ACTION) {
    startAsk(target);
    return;
  }
  const ref = role === "review" && target.prRef ? target.prRef : target.ref;
  const prompt = `/${skill} ${ref}`;
  const name = `${target.label} ${shortSkill(skill)}`;
  const space = spaces().find((s) => s.active);
  if (target.issue && role === "work" && NOT_STARTED_STAGES.includes(getIssueStage(target.issue))) void startIssue(target.issue);
  if (isWorktree && target.space) {
    run("tab.new", { name, space: target.space, folder: target.worktree, argv: ["claude", prompt], focus: !isBackground });
    return;
  }
  // An existing worktree needs no main checkout; a new one is made from it.
  if (isWorktree && (target.worktree || (target.branch && target.main))) {
    await startInWorktree({ target, name, prompt });
    return;
  }
  run("tab.new", { name, space: space?.id, argv: ["claude", prompt], focus: !isBackground, ...(target.folder ? { folder: target.folder } : {}) });
  if (isBackground) notify({ title: `Started ${name}`, body: "Running in the background. Herdr tells you when it needs you or is done.", level: "info" });
}

// Ask: Claude reads the PR (its URL) or ticket (its ID) in a new tab here, in front, and waits.
// It never moves the ticket or asks where to run.
/** @param {{ label: string }} target */
export const getAskTabName = (target) => `${target.label} ${ASK_ACTION}`;

// Shows the shown space's tab with this name, if there is one.
/** @param {string} name */
export function selectTabNamed(name) {
  const tab = spaces().find((s) => s.active)?.tabs.find((t) => t.name === name);
  if (tab) run("tab.select", { id: tab.id });
}

/** @param {{ ref: string, label: string, folder?: string | null }} target */
function startAsk(target) {
  const space = spaces().find((s) => s.active);
  run("tab.new", {
    name: getAskTabName(target), space: space?.id, argv: ["claude", getAskPrompt(target.ref)], focus: true,
    ...(target.folder ? { folder: target.folder } : {}),
  });
}

// Herdr's own New worktree dialog creates the worktree where Herdr keeps them
// (settings.json worktrees.directory, default ~/.herdr/worktrees/<repo>/<branch>) and opens
// a space in it; its first tab prepares the worktree and starts Claude.
// An existing checkout of the branch is reused as is.
async function startInWorktree({ target, name, prompt }) {
  const script = `${appHome()}/mods/hub/start-worktree.sh`;
  const { main, branch } = target;
  if (target.worktree) {
    run("space.new", { folder: target.worktree, tab: name, argv: ["bash", script, prompt] });
    return;
  }
  // Herdr's dialog branches a new branch from the main checkout's HEAD, which may be behind.
  // Create it from the fresh remote default branch first; the dialog then checks it out.
  try {
    await exec("git", ["fetch", "-q", "origin"], { cwd: main });
    const hasBranch = (await exec("git", ["show-ref", "-q", "--verify", `refs/heads/${branch}`], { cwd: main })).code === 0;
    if (!hasBranch) {
      const base = (await exec("git", ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], { cwd: main })).stdout.trim() || "origin/main";
      await exec("git", ["branch", "--no-track", branch, base], { cwd: main });
    }
  } catch (error) {
    notify({ title: `Could not prepare branch ${branch}`, body: String(error?.message ?? error), level: "warning" });
  }
  openOverlay({
    mod: "worktree", kind: "dialog", width: 440, height: 260,
    props: {
      space: spaces().find((s) => s.active)?.id, folder: target.main, action: "new",
      branch: target.branch, tab: name, argv: ["bash", script, prompt, "--prepare"],
    },
  });
}

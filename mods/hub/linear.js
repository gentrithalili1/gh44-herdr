// Linear data through its GraphQL API, with the user's personal API key. The key sits in a file
// only the user can read, as the Authorization header curl reads (`-H @file`), so it never
// shows in the process list.
import { exec, appHome, readTextFile, writeTextFile } from "herdr";
import { buildIssueFilter } from "./filters.js";

const ISSUE_LIMIT = 100;

const ISSUES_QUERY = `query($filter: IssueFilter, $first: Int) {
  issues(filter: $filter, first: $first, orderBy: updatedAt) {
    nodes {
      id identifier title url branchName priority createdAt updatedAt
      state { name type }
      team { id key }
      project { id name }
      assignee { name isMe }
      labels { nodes { name color } }
      attachments(first: 10) { nodes { url creator { isMe } metadata } }
    }
  }
}`;

const META_QUERY = `query {
  teams(first: 100) { nodes { id key name } }
  projects(first: 200, filter: { status: { type: { nin: ["completed", "canceled"] } } }) {
    nodes { id name teams { nodes { id } } }
  }
}`;

const PULL_REQUEST_URL = /github\.com\/.+\/pull\/\d+/;
const CLOSED_PULL_REQUEST = ["merged", "closed"];

// The issue's PR: the newest open one, else the newest. Mine when its Linear creator
// (the PR author's linked account) is me; without a creator, when the issue is mine.
/** @typedef {{ url: string, creator: { isMe: boolean } | null, metadata: { createdAt?: string, status?: string } | null }} Attachment */
/** @param {{ attachments: Attachment[], isAssignedToMe: boolean }} params */
function toPullRequest({ attachments, isAssignedToMe }) {
  const prs = attachments
    .filter((a) => PULL_REQUEST_URL.test(a.url))
    .sort((a, b) => String(b.metadata?.createdAt ?? "").localeCompare(String(a.metadata?.createdAt ?? "")));
  const pr = prs.find((a) => !CLOSED_PULL_REQUEST.includes(a.metadata?.status)) ?? prs[0];
  if (!pr) return { prUrl: null, isMyPullRequest: isAssignedToMe };
  return { prUrl: pr.url, isMyPullRequest: pr.creator ? Boolean(pr.creator.isMe) : isAssignedToMe };
}

const toIssue = (n) => ({
  id: n.id,
  identifier: n.identifier,
  title: n.title,
  url: n.url,
  branch: n.branchName,
  priority: n.priority,
  createdAt: n.createdAt,
  updatedAt: n.updatedAt,
  state: n.state?.name ?? "",
  stateType: n.state?.type ?? "",
  team: n.team?.key ?? "",
  teamId: n.team?.id ?? null,
  project: n.project?.name ?? null,
  assignee: n.assignee?.name ?? null,
  labels: (n.labels?.nodes ?? []).map((l) => l.name),
  labelColors: Object.fromEntries((n.labels?.nodes ?? []).map((l) => [l.name, l.color])),
  ...toPullRequest({ attachments: n.attachments?.nodes ?? [], isAssignedToMe: Boolean(n.assignee?.isMe) }),
});

const API_URL = "https://api.linear.app/graphql";
const REQUEST_TIMEOUT_SECONDS = "30";
const getKeyFolder = () => `${appHome()}/hub`;
const getKeyFile = () => `${getKeyFolder()}/linear-key`;
const AUTH_ERROR = "AUTHENTICATION_ERROR";

/** @typedef {{ status: "error", reason: "auth" | "failed", message?: string }} LinearError */

/** @param {unknown} error */
const toMessage = (error) => (error instanceof Error ? error.message : String(error));

/** @param {string} text */
const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// reason "auth": no key, or Linear turned it down (its message says why).
/**
 * @param {{ query: string, variables?: object, keyFile?: string }} params
 * @returns {Promise<LinearError | { status: "success", data: any }>}
 */
async function request({ query, variables, keyFile = getKeyFile() }) {
  try {
    if (!(await readTextFile(keyFile))) return { status: "error", reason: "auth" };
    const r = await exec("curl", [
      "-sS", "--max-time", REQUEST_TIMEOUT_SECONDS, "-X", "POST", API_URL,
      "-H", "Content-Type: application/json", "-H", `@${keyFile}`,
      "--data-binary", JSON.stringify({ query, variables }),
    ]);
    const body = parseJson(r.stdout);
    const error = body?.errors?.[0];
    const message = error?.extensions?.userPresentableMessage ?? error?.message;
    if (error?.extensions?.code === AUTH_ERROR || error?.extensions?.type === "authentication error") return { status: "error", reason: "auth", message };
    if (error || !body?.data) return { status: "error", reason: "failed", message: message ?? (r.stderr || r.stdout).trim().split("\n")[0] };
    return { status: "success", data: body.data };
  } catch (error) {
    return { status: "error", reason: "failed", message: toMessage(error) };
  }
}

const VIEWER_QUERY = "query { viewer { name } }";

// Who the saved key belongs to.
/** @returns {Promise<LinearError | { status: "success", name: string }>} */
export async function loadLinearViewer() {
  const r = await request({ query: VIEWER_QUERY });
  if (r.status !== "success") return r;
  return { status: "success", name: r.data.viewer.name };
}

// Checks the key with Linear first, and keeps it only when Linear accepts it. The folder is
// the user's alone (700) before the key is written, and the file then 600.
/** @param {string} key @returns {Promise<LinearError | { status: "success", name: string }>} */
export async function saveLinearKey(key) {
  const value = key.trim();
  if (!/^\S+$/.test(value)) return { status: "error", reason: "failed", message: "Paste the key as one word, without spaces" };
  // Its own file per save, so two saves at once can't swap keys.
  const pending = `${getKeyFile()}.${Date.now()}-${Math.random().toString(36).slice(2)}.pending`;
  // Stops the save and removes the key if it was written already.
  /** @param {string} message @returns {Promise<LinearError>} */
  const fail = async (message) => {
    await exec("rm", ["-f", pending]);
    return { status: "error", reason: "failed", message };
  };
  try {
    for (const args of [["mkdir", "-p", getKeyFolder()], ["chmod", "700", getKeyFolder()]]) {
      const r = await exec(args[0], args.slice(1));
      if (r.code !== 0) return await fail(r.stderr.trim() || `${args[0]} failed`);
    }
    await writeTextFile(pending, `Authorization: ${value}\n`, null);
    const locked = await exec("chmod", ["600", pending]);
    if (locked.code !== 0) return await fail(locked.stderr.trim() || "chmod failed");
    const r = await request({ query: VIEWER_QUERY, keyFile: pending });
    if (r.status !== "success") {
      await exec("rm", ["-f", pending]);
      return r;
    }
    const moved = await exec("mv", ["-f", pending, getKeyFile()]);
    if (moved.code !== 0) return await fail(moved.stderr.trim() || "mv failed");
    return { status: "success", name: r.data.viewer.name };
  } catch (error) {
    return await fail(toMessage(error));
  }
}

/** @returns {Promise<LinearError | { status: "success" }>} */
export async function removeLinearKey() {
  const r = await exec("rm", ["-f", getKeyFile()]);
  return r.code === 0 ? { status: "success" } : { status: "error", reason: "failed", message: r.stderr.trim() };
}

export async function loadIssues(filters) {
  const r = await request({ query: ISSUES_QUERY, variables: { filter: buildIssueFilter(filters), first: ISSUE_LIMIT } });
  if (r.status !== "success") return r;
  return { status: "success", items: r.data.issues.nodes.map(toIssue), isCapped: r.data.issues.nodes.length >= ISSUE_LIMIT };
}

// Teams and open projects for the filter menus.
export async function loadLinearMeta() {
  const r = await request({ query: META_QUERY });
  if (r.status !== "success") return r;
  return {
    status: "success",
    teams: r.data.teams.nodes.map((t) => ({ value: t.id, label: `${t.name} (${t.key})` })).sort((a, b) => a.label.localeCompare(b.label)),
    projects: r.data.projects.nodes.map((p) => ({ id: p.id, name: p.name, teamIds: p.teams.nodes.map((t) => t.id) })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const STARTED_STATES_QUERY = `query($id: String!) {
  team(id: $id) { states(filter: { type: { eq: "started" } }) { nodes { id name position } } }
}`;

const MOVE_ISSUE_MUTATION = `mutation($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success }
}`;

// Moves an issue to its team's first started status that is not a review one ("In Progress").
/** @param {{ id: string, teamId: string }} issue @returns {Promise<LinearError | { status: "success", state: string }>} */
export async function moveIssueToInProgress(issue) {
  const r = await request({ query: STARTED_STATES_QUERY, variables: { id: issue.teamId } });
  if (r.status !== "success") return r;
  const state = r.data.team.states.nodes
    .filter((st) => !/review/i.test(st.name))
    .sort((a, b) => a.position - b.position)[0];
  if (!state) return { status: "error", reason: "failed", message: "No started status in the team" };
  const m = await request({ query: MOVE_ISSUE_MUTATION, variables: { id: issue.id, stateId: state.id } });
  if (m.status !== "success") return m;
  return { status: "success", state: state.name };
}

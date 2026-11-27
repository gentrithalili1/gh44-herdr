// Where the panel puts a ticket's new worktree: Herdr's worktrees folder (settings.json
// worktrees.directory, default ~/.herdr/worktrees), then <repo>/<folder name slug>, like Herdr's dialog.
// A ticket's worktree is named by its identifier (THU-123) on a branch thu-123, not Linear's long branchName.

const DEFAULT_WORKTREES_DIRECTORY = "~/.herdr/worktrees";

// Herdr's worktrees folder from its settings.json text. null: the setting is not a usable path.
/** @param {{ settingsText: string | null, userHome: string }} params @returns {string | null} */
export function getWorktreesRoot({ settingsText, userHome }) {
  let directory = DEFAULT_WORKTREES_DIRECTORY;
  try {
    directory = (settingsText ? JSON.parse(settingsText) : {})?.worktrees?.directory ?? DEFAULT_WORKTREES_DIRECTORY;
  } catch {
    return null;
  }
  if (typeof directory !== "string" || !directory.trim()) return null;
  const path = directory === "~" || directory.startsWith("~/") ? `${userHome.replace(/\/$/, "")}${directory.slice(1)}` : directory;
  return path.startsWith("/") ? path.replace(/\/+$/, "") : null;
}

// A branch as a folder name, as Herdr's dialog names it.
/** @param {string} branch */
export function slugBranch(branch) {
  const normalized = branch.normalize("NFC");
  const name = normalized.replace(/[^\p{L}\p{M}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  if (name) return name;
  let hash = 2166136261;
  for (const char of normalized) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619);
  return `branch-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

// A ticket's branch: its lowercased identifier (thu-123), unless only Linear's long branchName is
// already checked out (a worktree made before), which is kept.
/** @param {{ identifier: string, linearBranch: string | null, isCheckedOut: (branch: string) => boolean }} params */
export function getTicketBranch({ identifier, linearBranch, isCheckedOut }) {
  const short = identifier.toLowerCase();
  return linearBranch && !isCheckedOut(short) && isCheckedOut(linearBranch) ? linearBranch : short;
}

// The attempt-th folder to try: the plain one first, then "-2", "-3", ... when an earlier one
// is taken (a folder left from a removed worktree is never deleted or reused).
// name: the folder's name (a ticket's identifier, else the branch).
/** @param {{ root: string, repo: string, name: string, attempt: number }} params */
export function getWorktreePath({ root, repo, name, attempt }) {
  const base = `${root}/${repo}/${slugBranch(name)}`;
  return attempt === 0 ? base : `${base}-${attempt + 1}`;
}

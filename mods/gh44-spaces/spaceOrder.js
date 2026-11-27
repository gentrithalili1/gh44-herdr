// Dragging a space onto another reorders it, inside its machine's block only (space.move keeps
// spaces there). Pure, so tests/ can load it without Herdr.

/** @typedef {{ id: string, machine: string | null }} OrderedSpace */
/** @typedef {{ status: "move", id: string, index: number } | { status: "none" }} SpaceMove */

/** @param {{ spaces: OrderedSpace[], from: string, to: string }} params */
const getPlaces = ({ spaces, from, to }) => {
  const fromIndex = spaces.findIndex((s) => s.id === from);
  const toIndex = spaces.findIndex((s) => s.id === to);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return null;
  if ((spaces[fromIndex].machine ?? null) !== (spaces[toIndex].machine ?? null)) return null;
  return { fromIndex, toIndex };
};

// index: space.move's, from 1.
/** @param {{ spaces: OrderedSpace[], from: string, to: string }} params @returns {SpaceMove} */
export const getSpaceMove = ({ spaces, from, to }) => {
  const places = getPlaces({ spaces, from, to });
  return places ? { status: "move", id: from, index: places.toIndex + 1 } : { status: "none" };
};

// Where the drop line goes on the row under the pointer: below it moving down, above it moving up.
/** @param {{ spaces: OrderedSpace[], from: string, to: string }} params @returns {"top" | "bottom" | null} */
export const getDropEdge = ({ spaces, from, to }) => {
  const places = getPlaces({ spaces, from, to });
  if (!places) return null;
  return places.fromIndex < places.toIndex ? "bottom" : "top";
};

// Each worktree space's main checkout space, for the agents list to nest it under: a linked
// worktree whose repo has a main checkout open as a space. The first such space wins.
/** @param {{ spaces: { id: string, repo: string | null, linked: boolean }[] }} params @returns {Record<string, string>} */
export const getWorktreeParents = ({ spaces }) => {
  /** @type {Map<string, string>} */
  const mainOf = new Map();
  for (const s of spaces) if (s.repo && !s.linked && !mainOf.has(s.repo)) mainOf.set(s.repo, s.id);
  return Object.fromEntries(spaces.filter((s) => s.repo && s.linked && mainOf.has(s.repo)).map((s) => [s.id, /** @type {string} */ (mainOf.get(s.repo ?? ""))]));
};

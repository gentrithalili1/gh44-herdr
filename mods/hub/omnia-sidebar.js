// Settings › General's "Omnia sidebar": the layout's two sidebar blocks (ids spaces and agents)
// show either the omnia mods (gh44-spaces, gh44-agents) or Herdr's own. One pair of blocks, its mod
// swapped with layout.set, so the other pair never runs beside it (a hidden block still starts).
// Pure, so tests/ can load it without Herdr.

export const OMNIA_SIDEBAR_STORE = "omnia.sidebar";
/** @type {Record<string, { omnia: string, stock: string }>} */
const BLOCK_MODS = {
  spaces: { omnia: "gh44-spaces", stock: "spaces" },
  agents: { omnia: "gh44-agents", stock: "agents" },
};

// Unset means on: installing gh44-omnia gives the omnia sidebar.
/** @param {unknown} saved */
export const isOmniaSidebarOn = (saved) => saved !== false;

/** @typedef {{ id?: string, type?: string, content?: Record<string, unknown>, children?: LayoutNode[] } & Record<string, unknown>} LayoutNode */

// The layout with the sidebar blocks' mods set; null when it has neither block (another layout).
/** @param {{ layout: unknown, isOmnia: boolean }} params @returns {LayoutNode | null} */
export const getSidebarLayout = ({ layout, isOmnia }) => {
  let isFound = false;
  /** @param {LayoutNode} node @returns {LayoutNode} */
  const swap = (node) => {
    const mods = node.type === "block" && node.id ? BLOCK_MODS[node.id] : undefined;
    if (mods) isFound = true;
    return {
      ...node,
      ...(mods ? { content: { mod: isOmnia ? mods.omnia : mods.stock } } : {}),
      ...(Array.isArray(node.children) ? { children: node.children.map(swap) } : {}),
    };
  };
  if (!layout || typeof layout !== "object") return null;
  const next = swap(/** @type {LayoutNode} */ (layout));
  return isFound ? next : null;
};

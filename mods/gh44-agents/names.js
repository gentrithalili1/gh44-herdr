// Agent names: a name someone gives an agent is the omnia.name label on its terminal, so it
// survives restarts, works on other machines and other mods can read it. It wins over the
// agent's own title everywhere. Pure, so tests/ can load it without Herdr.

export const AGENT_NAME_LABEL = "omnia.name";

/** @param {{ labels: Record<string, string> | undefined, fallback: string }} params */
export const getDisplayName = ({ labels, fallback }) => labels?.[AGENT_NAME_LABEL]?.trim() || fallback;

// An empty name takes the label off: the agent's own title again.
/** @param {{ terminal: string, name: string }} params @returns {import("./leads.js").LabelChange[]} */
export const getRenameLabels = ({ terminal, name }) => [{ terminal, labels: [`${AGENT_NAME_LABEL}=${name.trim()}`] }];

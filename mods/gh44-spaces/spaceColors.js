// A space's color, kept in shared("space.colors") as Herdr's spaces mod keeps it: a theme color
// name (ansi6) or a hex. The edit box offers six gh44 hues; lavender is the leads' and red is
// "needs you", so neither is a space color. Pure, so tests/ can load it without Herdr.

/** @typedef {{ id: string, label: string }} Hue */

// Clay and rose are not theme colors: they are kept as their dark hex, which Herdr's own spaces
// mod draws as it is, and drawn here in their light step on a light theme.
const CLAY = "#C59172";
const ROSE = "#F08BA2";
/** @type {Record<string, string>} */
const LIGHT_STEP = { [CLAY]: "#B64309", [ROSE]: "#B73A68" };

/** @type {Hue[]} */
export const HUES = [
  { id: "ansi6", label: "Seafoam" },
  { id: "ansi4", label: "Sky" },
  { id: "ansi2", label: "Sage" },
  { id: "ansi3", label: "Ochre" },
  { id: CLAY, label: "Clay" },
  { id: ROSE, label: "Rose" },
];

// The hue fewest spaces use, the first one on a tie.
/** @param {{ used: string[] }} params */
export const getNewSpaceColor = ({ used }) => {
  const uses = (/** @type {string} */ id) => used.filter((c) => c === id).length;
  return HUES.reduce((best, h) => (uses(h.id) < uses(best.id) ? h : best)).id;
};

// null: a theme color name this theme does not have.
/** @param {{ color: string, t: Record<string, string>, isDark: boolean }} params @returns {string | null} */
export const getHueFill = ({ color, t, isDark }) => {
  if (color.startsWith("#")) return isDark ? color : (LIGHT_STEP[color] ?? color);
  return t[color] ?? null;
};

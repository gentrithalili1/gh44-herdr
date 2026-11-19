// Look pieces the panel and its settings view share.

/** @param {string} name */
export const icon = (name) => `mods/hub/icons/${name}.svg`;

// One meaning per color, everywhere in the panel. Accent is for buttons only.
/** @param {Record<string, string>} t @returns {Record<string, string>} */
export const palette = (t) => ({ success: t.ansi2, danger: t.ansi1, warning: t.ansi3, neutral: t.dim, quiet: t.muted });

// PR numbers in the terminal's font.
export const MONO_FONT = "Lilex";
// Side space of the panel's header, search and list.
export const GUTTER = 14;

/** @param {unknown} _e @param {import("gpui-kit").Context} cx */
export const stop = (_e, cx) => cx.stop_propagation();

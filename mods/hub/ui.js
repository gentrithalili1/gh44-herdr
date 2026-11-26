// Look pieces the panel and its settings view share.
import { div } from "gpui-kit";

/** @param {string} name */
export const icon = (name) => `mods/hub/icons/${name}.svg`;

// One meaning per color, everywhere in the panel. Accent is for buttons only.
/** @param {Record<string, string>} t @returns {Record<string, string>} */
export const palette = (t) => ({ success: t.ansi2, danger: t.ansi1, warning: t.ansi3, neutral: t.dim, quiet: t.muted });

// PR numbers in the terminal's font.
export const MONO_FONT = "Lilex";
// Side space of the panel's header, search and list.
export const GUTTER = 14;

// A radio's circle: a filled dot when picked.
/** @param {{ t: Record<string, any>, isOn: boolean }} params */
export const radioMark = ({ t, isOn }) => div().size(14).flex_none().flex().items_center().justify_center().rounded(7).border(1.5)
  .border_color(isOn ? t.accent : t.dim)
  .when(isOn, (el) => el.child(div().size(6).rounded(3).bg(t.accent)));

/** @param {unknown} _e @param {import("gpui-kit").Context} cx */
export const stop = (_e, cx) => cx.stop_propagation();

// A pressed element's box in the window, from a mouse down: where a menu opened from it goes.
// null before the element is painted.
/** @typedef {{ left: number, top: number, width: number, height: number }} Anchor */
/** @param {import("gpui-kit").MouseButtonEvent} e @returns {Anchor | null} */
export const toAnchor = (e) => (e.local_position && e.bounds
  ? { left: e.position.x - e.local_position.x, top: e.position.y - e.local_position.y, width: e.bounds.width, height: e.bounds.height }
  : null);

// A row's strip: the holder end's width, the action column's width, the split button's height.
export const HOLDER_WIDTH = 28;
// Wide enough for the longest common labels: "resolve-conflicts", "address-review".
export const ACTION_COLUMN_WIDTH = 166;
export const SPLIT_BUTTON_HEIGHT = 26;

// Groups whose tone says "not your move": a raised holder with a dim glyph.
const NEUTRAL_TONES = ["quiet", "neutral"];

/** @param {string} tone */
export const isNeutralTone = (tone) => NEUTRAL_TONES.includes(tone);

// The holder tone of the step being set up: the accent, like a primary button.
export const ACCENT_TONE = "accent";

// A strip's holder end: its group's tone, with the glyph cut out of it.
/** @param {{ t: Record<string, string>, tone: string }} params @returns {{ bg: string, glyph: string }} */
export const holderLook = ({ t, tone }) => {
  if (tone === ACCENT_TONE) return { bg: t.accent, glyph: t.accent_foreground };
  return isNeutralTone(tone) ? { bg: t.raised, glyph: t.dim } : { bg: palette(t)[tone], glyph: t.background };
};

// Alpha suffixes for a 6-digit hex token: a faint tint, the split line on a filled button, a hover.
const TINT = "1f";
const SPLIT_LINE = "40";
const HOVER_FILL = "d9";
const HOVER_TINT = "33";

// The split button's colors per style (row-action.js RowActionStyle).
/**
 * @param {{ t: Record<string, string>, style: import("./row-action.js").RowActionStyle }} params
 * @returns {{ bg: string, border: string, text: string, divider: string, hover: string }}
 */
export const splitButtonLook = ({ t, style }) => {
  switch (style) {
    case "suggested": return { bg: t.accent, border: t.accent, text: t.accent_foreground, divider: `${t.accent_foreground}${SPLIT_LINE}`, hover: `${t.accent}${HOVER_FILL}` };
    case "quiet": return { bg: t.raised, border: t.input, text: t.foreground, divider: t.input, hover: t.hover };
    case "alert": return { bg: `${t.blocked}${TINT}`, border: t.blocked, text: t.blocked, divider: `${t.blocked}${SPLIT_LINE}`, hover: `${t.blocked}${HOVER_TINT}` };
    default: {
      /** @type {never} */
      const unknownStyle = style;
      return unknownStyle;
    }
  }
};

// The control kit: every settings control and dialog piece in one strip language. A control row
// is a strip with its label (and an optional help line) on the left and its control on the right;
// a holder strip adds a holder end in a tone. Presentational only: state lives in the views.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";
import { icon, palette, radioMark, holderLook, isNeutralTone, toAnchor, MONO_FONT, HOLDER_WIDTH } from "./ui.js";

/** @typedef {ReturnType<typeof div>} Element */

const ROW_MIN_HEIGHT = 34;
const SWITCH_WIDTH = 28;
const SWITCH_HEIGHT = 16;
const SWITCH_KNOB = 12;
const BUTTON_HEIGHT = 26;
const KEY_CELL_SIZE = 22;
const DISABLED_OPACITY = 0.5;
const HOLDER_GLYPH_SIZE = 12;
const SPINNER = "mods/workspace-chrome/spinner.svg";
const SPINNER_PERIOD_MS = 900;

// A bay: a group of settings, its name with an optional count, a help line, then its strips.
/** @param {{ title: string, count?: number | null, description?: string | null, children: Element[] }} params */
export const bay = ({ title, count = null, description = null, children }) => {
  const t = theme();
  return v_flex().flex_none().gap(4)
    .child(v_flex().pb(2).gap(2)
      .child(h_flex().gap(6).items_center().text_size(11).font_semibold().text_color(t.muted)
        .child(title.toUpperCase())
        .when(count !== null, (el) => el.child(div().font_family(MONO_FONT).font_normal().text_color(t.dim).child(String(count)))))
      .when(Boolean(description), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(description ?? ""))))
    .children(children);
};

// A strip without a holder: label (and help) left, control right. onClick makes the whole row the target.
/**
 * @param {{ id: string, label: string | Element, help?: string | null, control?: Element | null, isDisabled?: boolean,
 *   tip?: string | null, onClick?: ((cx: import("gpui-kit").Context) => void) | null }} params
 */
export const controlRow = ({ id, label, help = null, control = null, isDisabled = false, tip = null, onClick = null }) => {
  const t = theme();
  return h_flex().id(`control-${id}`).min_h(ROW_MIN_HEIGHT).flex_none().px(10).py(5).gap(10).items_center().rounded(4)
    .bg(t.popover).border(1).border_color(t.border)
    .when(Boolean(tip), (el) => el.tooltip(tip ?? ""))
    .when(Boolean(onClick) && !isDisabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { onClick?.(cx); cx.notify(); }))
    .child(v_flex().flex_1().min_w(0).gap(1)
      .child(typeof label === "string" ? div().truncate().text_size(12.5).text_color(isDisabled ? t.muted : t.foreground).child(label) : label)
      .when(Boolean(help), (el) => el.child(div().text_size(11).text_color(t.dim).child(help ?? ""))))
    .when(control !== null, (el) => el.child(h_flex().flex_none().gap(6).items_center().child(control)));
};

// A switch: a pill track with a knob on the right when on.
/** @param {{ isOn: boolean, isDisabled?: boolean }} params */
export const switchMark = ({ isOn, isDisabled = false }) => {
  const t = theme();
  return h_flex().w(SWITCH_WIDTH).h(SWITCH_HEIGHT).flex_none().px(2).items_center().rounded(SWITCH_HEIGHT / 2)
    .bg(isOn ? t.accent : t.input).when(isOn, (el) => el.justify_end())
    .when(isDisabled, (el) => el.opacity(DISABLED_OPACITY))
    .child(div().size(SWITCH_KNOB).rounded(SWITCH_KNOB / 2).bg(isOn ? t.accent_foreground : t.muted));
};

// Toggle row. Disabled (the last tab on): dimmed, its help says why.
/**
 * @param {{ id: string, label: string, help?: string | null, isOn: boolean, isDisabled?: boolean,
 *   onToggle: (cx: import("gpui-kit").Context) => void }} params
 */
export const toggleRow = ({ id, label, help = null, isOn, isDisabled = false, onToggle }) => controlRow({
  id, label, help, isDisabled, onClick: onToggle, control: switchMark({ isOn, isDisabled }),
});

// Radio row: one option of a single choice, its dot on the left.
/** @param {{ id: string, label: string, help?: string | null, isOn: boolean, onPick: (cx: import("gpui-kit").Context) => void }} params */
export const radioRow = ({ id, label, help = null, isOn, onPick }) => {
  const t = theme();
  return controlRow({
    id, help, onClick: onPick,
    label: h_flex().gap(8).items_center().text_size(12.5).text_color(t.foreground).child(radioMark({ t, isOn })).child(label),
  });
};

// A multiselect's closed text: its first pick and how many more, or "None picked".
/** @param {string[]} labels @returns {{ text: string, more: number, isEmpty: boolean }} */
export const getPickedText = (labels) => (labels.length === 0
  ? { text: "None picked", more: 0, isEmpty: true }
  : { text: labels[0], more: labels.length - 1, isEmpty: false });

// A select, closed: its value (a multiselect: first pick + "+N") and a chevron. onOpen gets the
// button's box, so the menu opens under it.
/**
 * @param {{ id: string, text: string, more?: number, isEmpty?: boolean,
 *   onOpen: (params: { anchor: import("./ui.js").Anchor | null }) => void }} params
 */
export const selectButton = ({ id, text, more = 0, isEmpty = false, onOpen }) => {
  const t = theme();
  /** @type {import("./ui.js").Anchor | null} */
  let anchor = null;
  return h_flex().id(`select-${id}`).h(BUTTON_HEIGHT).max_w(200).px(8).gap(6).flex_none().items_center().rounded(6).border(1).border_color(t.input)
    .bg(t.background).cursor_pointer().hover((s) => s.bg(t.hover))
    .on_mouse_down("left", (e) => { anchor = toAnchor(e); })
    .on_click((_e, cx) => { cx.stop_propagation(); onOpen({ anchor }); })
    .child(div().min_w(0).truncate().text_size(12).text_color(isEmpty ? t.dim : t.foreground).child(text))
    .when(more > 0, (el) => el.child(div().flex_none().px(5).rounded(8).bg(t.raised).font_family(MONO_FONT).text_size(10.5).text_color(t.muted).child(`+${more}`)))
    .child(svg(icon("chevron")).size(12).flex_none().text_color(t.muted));
};

/** @typedef {"primary" | "normal" | "ghost" | "busy" | "danger" | "dangerConfirm"} ButtonVariant */

// A button. busy: a spinner and no click. dangerConfirm: the second click of a two-click danger.
/** @param {{ id: string, label: string, variant?: ButtonVariant, onClick?: ((cx: import("gpui-kit").Context) => void) | null }} params */
export const button = ({ id, label, variant = "normal", onClick = null }) => {
  const t = theme();
  const danger = palette(t).danger;
  const base = h_flex().id(id).h(BUTTON_HEIGHT).px(10).gap(6).flex_none().items_center().justify_center().rounded(6).border(1).text_size(12).font_medium();
  /** @returns {Element} */
  const styled = () => {
    switch (variant) {
      case "primary": return base.bg(t.accent).border_color(t.accent).text_color(t.accent_foreground);
      case "normal": return base.bg(t.raised).border_color(t.input).text_color(t.foreground);
      // No border color: GPUI leaves the 1px border transparent, so it lines up with the others.
      case "ghost": return base.text_color(t.muted);
      case "busy": return base.bg(t.raised).border_color(t.input).text_color(t.muted)
        .child(svg(SPINNER).size(12).text_color(t.working).spin(SPINNER_PERIOD_MS));
      case "danger": return base.border_color(danger).text_color(danger);
      case "dangerConfirm": return base.bg(danger).border_color(danger).text_color(t.background);
      default: {
        /** @type {never} */
        const unknownVariant = variant;
        return unknownVariant;
      }
    }
  };
  const isClickable = variant !== "busy" && onClick !== null;
  return styled()
    .when(isClickable, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => { cx.stop_propagation(); onClick?.(cx); cx.notify(); }))
    .child(label);
};

// warning: works, but something failed (a check). off: not running.
/** @typedef {"connected" | "checking" | "rejected" | "warning" | "off"} StatusTone */

// A status line: a dot (a spinner while checking), the text and an optional help line.
/** @param {{ id: string, tone: StatusTone, text: string, help?: string | null, action?: Element | null, tip?: string | null }} params */
export const statusLine = ({ id, tone, text, help = null, action = null, tip = null }) => {
  const t = theme();
  const colors = palette(t);
  /** @param {string} color */
  const dot = (color) => div().size(7).flex_none().rounded(4).bg(color);
  /** @returns {Element} */
  const mark = () => {
    switch (tone) {
      case "connected": return dot(colors.success);
      case "checking": return svg(SPINNER).size(12).flex_none().text_color(t.working).spin(SPINNER_PERIOD_MS);
      case "rejected": return dot(colors.danger);
      case "warning": return dot(colors.warning);
      case "off": return dot(t.dim);
      default: {
        /** @type {never} */
        const unknownTone = tone;
        return unknownTone;
      }
    }
  };
  /** @type {Record<StatusTone, string>} */
  const textColor = { connected: t.foreground, checking: t.foreground, rejected: colors.danger, warning: colors.warning, off: t.muted };
  return controlRow({
    id, help, control: action, tip,
    label: h_flex().min_w(0).gap(8).items_center().text_size(12.5).text_color(textColor[tone]).child(mark()).child(div().min_w(0).truncate().child(text)),
  });
};

/** @typedef {"builtIn" | "repo" | "notInstalled" | "notInRepo" | "installed" | "link"} ListTagKind */

// A tag beside a name in a list: built in, a repo's own (its name), not installed, not in repo, a link.
/** @param {{ kind: ListTagKind, text?: string, tip?: string | null, isDim?: boolean }} params */
export const listTag = ({ kind, text = "", tip = null, isDim = false }) => {
  const t = theme();
  /** @returns {Element} */
  const tag = () => {
    switch (kind) {
      case "builtIn": return div().text_color(t.dim).child("built in");
      case "installed": return div().text_color(t.dim).child("installed");
      case "link": return div().text_color(t.dim).child("link");
      case "repo": return div().px(6).h(18).flex().items_center().rounded(4).border(1).border_color(t.border).text_color(isDim ? t.dim : t.muted).child(text);
      case "notInstalled": return div().text_color(palette(t).warning).child("not installed");
      case "notInRepo": return div().text_color(palette(t).warning).child("not in repo");
      default: {
        /** @type {never} */
        const unknownKind = kind;
        return unknownKind;
      }
    }
  };
  return div().flex_none().text_size(11).when(Boolean(tip), (el) => el.tooltip(tip ?? "")).child(tag());
};

// A key cell, idle: the key letter, or a dash with none. Click to type a new one.
/** @param {{ id: string, letter: string | null, tip: string, onClick: (cx: import("gpui-kit").Context) => void }} params */
export const keyCell = ({ id, letter, tip, onClick }) => {
  const t = theme();
  return div().id(id).size(KEY_CELL_SIZE).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
    .border(1).border_color(t.border).bg(t.background).font_family(MONO_FONT).text_size(12).text_color(letter ? t.foreground : t.dim)
    .hover((s) => s.bg(t.hover)).tooltip(tip)
    .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); cx.notify(); })
    .child(letter ?? "–");
};

// A key cell while typing: the input in an accent box. "No key" goes beside it.
/** @param {{ input: Element }} params */
export const keyCellEditing = ({ input }) => {
  const t = theme();
  return div().w(KEY_CELL_SIZE + 4).h(KEY_CELL_SIZE).flex_none().px(4).flex().items_center().rounded(5).border(1).border_color(t.accent).bg(t.background)
    .child(input);
};

// A text field's box: the input, and an optional button joined to its right (a secret's Save).
/** @param {{ id: string, input: Element, isFocused: boolean, iconName?: string | null, trailing?: Element | null }} params */
export const fieldBox = ({ id, input, isFocused, iconName = null, trailing = null }) => {
  const t = theme();
  return h_flex().id(`field-${id}`).h(30).flex_none().items_center().rounded(6).border(1).border_color(isFocused ? t.accent : t.input).bg(t.background).overflow_hidden()
    .child(h_flex().flex_1().min_w(0).px(8).gap(6).items_center()
      .when(Boolean(iconName), (el) => el.child(svg(icon(iconName ?? "")).size(13).flex_none().text_color(t.dim)))
      .child(input))
    .when(trailing !== null, (el) => el.child(div().w(1).h_full().bg(t.border)).child(trailing));
};

// A link line, accent, opening a URL.
/** @param {{ id: string, label: string, url: string }} params */
export const linkLine = ({ id, label, url }) => {
  const t = theme();
  return h_flex().id(id).flex_none().px(2).gap(4).items_center().text_size(11.5).text_color(t.accent).cursor_pointer().hover((s) => s.opacity(0.85))
    .on_click((_e, cx) => cx.open_url(url))
    .child(label);
};

// A strip with a holder end in a tone (a neutral tone: raised, dim glyph), a body and a trailing part.
/**
 * @param {{ id: string, tone: string, iconName: string, tip?: string | null, body: Element, trailing?: Element | null,
 *   onClick?: ((cx: import("gpui-kit").Context) => void) | null }} params
 */
export const holderStrip = ({ id, tone, iconName, tip = null, body, trailing = null, onClick = null }) => {
  const t = theme();
  const look = holderLook({ t, tone });
  return h_flex().id(`strip-${id}`).min_h(ROW_MIN_HEIGHT).flex_none().items_stretch().rounded(4).overflow_hidden()
    .bg(t.popover).border(1).border_color(t.border)
    .when(Boolean(onClick), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { onClick?.(cx); cx.notify(); }))
    .child(div().w(HOLDER_WIDTH).flex_none().flex().items_center().justify_center().bg(look.bg)
      .when(Boolean(tip), (el) => el.tooltip(tip ?? ""))
      .child(svg(icon(iconName)).size(HOLDER_GLYPH_SIZE).text_color(look.glyph)))
    .child(v_flex().flex_1().min_w(0).px(10).py(6).gap(3).justify_center().child(body))
    .when(trailing !== null, (el) => el.child(h_flex().flex_none().pr(8).gap(6).items_center().child(trailing)));
};

// A case's action chip: the main one filled, the rest outlined.
/** @param {{ id: string, label: string, isMain: boolean }} params */
export const actionChip = ({ id, label, isMain }) => {
  const t = theme();
  return div().id(id).h(18).px(6).flex_none().flex().items_center().rounded(4).border(1).text_size(11)
    .when(isMain, (el) => el.bg(t.accent).border_color(t.accent).text_color(t.accent_foreground))
    .when(!isMain, (el) => el.border_color(t.border).text_color(t.muted))
    .child(label);
};

// ---------- dialog shell ----------

// A dialog's header: a holder end in a tone, a small kicker line, the title and a line under it.
/**
 * @param {{ tone: string, iconName: string, tip?: string | null, kicker?: string | Element | null, title: string, subtitle?: string | Element | null }} params
 */
export const dialogHeader = ({ tone, iconName, tip = null, kicker = null, title, subtitle = null }) => {
  const t = theme();
  const look = holderLook({ t, tone });
  /** @param {string | Element} part */
  const line = (part) => (typeof part === "string" ? div().truncate().text_size(12).text_color(t.dim).child(part) : part);
  return h_flex().flex_none().items_stretch().border_b(1).border_color(t.border)
    .child(div().w(HOLDER_WIDTH).flex_none().flex().items_center().justify_center().bg(look.bg).when(Boolean(tip), (el) => el.tooltip(tip ?? ""))
      .child(svg(icon(iconName)).size(14).text_color(look.glyph)))
    .child(v_flex().flex_1().min_w(0).px(12).py(10).gap(3)
      .when(kicker !== null, (el) => el.child(line(kicker ?? "")))
      .child(div().truncate().text_size(15).font_semibold().text_color(t.foreground).child(title))
      .when(subtitle !== null, (el) => el.child(line(subtitle ?? ""))));
};

// A dialog section: an uppercase title and its rows.
/** @param {{ id: string, title?: string | null, children: Element[] }} params */
export const dialogSection = ({ id, title = null, children }) => {
  const t = theme();
  return v_flex().id(`section-${id}`).flex_none().px(12).py(10).gap(4).border_b(1).border_color(t.border)
    .when(Boolean(title), (el) => el.child(div().pb(2).text_size(11).font_semibold().text_color(t.dim).child((title ?? "").toUpperCase())))
    .children(children);
};

// A dialog footer: something on the left, the buttons on the right (the primary one last).
/** @param {{ left?: Element | null, buttons: Element[] }} params */
export const dialogFooter = ({ left = null, buttons }) => h_flex().flex_none().h(44).px(12).gap(8).items_center()
  .child(div().flex_1().min_w(0).when(left !== null, (el) => el.child(left)))
  .children(buttons);

// The tone a case's name takes in text: its tone, or the foreground for a neutral one.
/** @param {{ tone: string }} params */
export const toneText = ({ tone }) => {
  const t = theme();
  return isNeutralTone(tone) ? t.foreground : palette(t)[tone];
};

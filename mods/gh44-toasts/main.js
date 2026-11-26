// Notifications in the window's top-right corner. One mod, two copies:
// - the layout's `"toast"` mod: Herdr opens it per notify(); it files the notification in
//   shared(STORE) and closes itself at once.
// - a floating block on the layout's root (edge top, align end): it draws the filed ones as a
//   stack, newest on top, each gone after its timeout, on a click (which runs its action) or ×.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme, shared, setShared } from "herdr";

const STORE = "gh44.toasts";
const DEFAULT_TIMEOUT_MS = 6_000;
// Warnings and errors stay a while longer: they usually ask for something.
const LONG_TIMEOUT_MS = 10_000;
const MAX_SHOWN = 4;
const MAX_KEPT = 20;
const WIDTH = 340;
// How often the stack looks for expired notifications while it shows some.
const PRUNE_MS = 500;
const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };
const LOGIN = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/;

/** @typedef {{ id: string, title: string, body: string, level: string, icon: string | null, action: { name: string, args?: Record<string, unknown> } | null, until: number }} Toast */

/** @returns {Toast[]} */
const readToasts = () => {
  const saved = shared(STORE);
  return Array.isArray(saved) ? saved.filter((n) => n && typeof n.id === "string" && typeof n.until === "number") : [];
};

/** @param {Toast[]} toasts */
const writeToasts = (toasts) => setShared(STORE, toasts.slice(0, MAX_KEPT));

/** @param {string} id */
const dismiss = (id) => writeToasts(readToasts().filter((n) => n.id !== id));

/** @param {Record<string, any>} p */
const getTimeout = (p) => {
  if (typeof p.timeout === "number" && p.timeout > 0) return p.timeout;
  return p.level === "warning" || p.level === "error" ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
};

export default class Toasts extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.isRelay = typeof p.overlay === "string";
    if (this.isRelay) {
      const now = Date.now();
      /** @type {Toast} */
      const toast = {
        id: `${now}-${p.overlay}`, title: String(p.title ?? ""), body: String(p.body ?? ""), level: String(p.level ?? "info"),
        icon: typeof p.icon === "string" ? p.icon : null, action: p.action?.name ? p.action : null, until: now + getTimeout(p),
      };
      writeToasts([toast, ...readToasts().filter((n) => n.until > now)]);
      closeOverlay(p.overlay);
      return;
    }
    this.copied = null;
    // Drops expired ones while some show. setShared redraws every copy, so no notify is needed.
    cx.spawn(async (cx) => {
      for (;;) {
        await cx.sleep(PRUNE_MS);
        const toasts = readToasts();
        const now = Date.now();
        if (toasts.some((n) => n.until <= now)) writeToasts(toasts.filter((n) => n.until > now));
      }
    });
  }

  /** @param {Toast} n */
  card(n) {
    const t = theme();
    const login = LOGIN.exec(n.body);
    const command = login ? `hc machine login ${login[1]}` : null;
    return h_flex().id(`toast-${n.id}`).w(WIDTH).min_h(56).px(14).py(10).gap(12).items_center().rounded(6)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => {
        if (n.action) run(n.action.name, n.action.args ?? {});
        dismiss(n.id);
      })
      .child(n.icon ? image(n.icon).w(18).h(18).flex_none() : div().size(8).rounded(4).flex_none().bg(t[DOT[n.level] ?? "accent"]))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().font_semibold().text_size(13).text_color(t.foreground).child(login ? `${login[1]} needs a login: run` : n.title))
        .when(!login && n.body !== "", (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(n.body.split("\n", 1)[0])))
        .when(Boolean(command), (el) => el.child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(command ?? ""))
          .child(div().id(`toast-copy-${n.id}`).flex_none().px(6).py(3).rounded(4).bg(t.raised).text_size(12).text_color(t.foreground)
            .cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command ?? ""); this.copied = n.id; cx.notify(); })
            .child(this.copied === n.id ? "Copied" : "Copy")))))
      .child(div().id(`toast-close-${n.id}`).size(20).flex_none().flex().items_center().justify_center().rounded(4)
        .text_size(13).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.raised).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); dismiss(n.id); })
        .child("×"));
  }

  render() {
    if (this.isRelay) return div();
    const now = Date.now();
    const shown = readToasts().filter((n) => n.until > now).slice(0, MAX_SHOWN);
    // Nothing to show: an empty render hides the floating block.
    if (shown.length === 0) return div();
    const t = theme();
    return v_flex().id("toasts").gap(2).bg(t.popover).children(shown.map((n) => this.card(n)));
  }
}

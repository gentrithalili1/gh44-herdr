// The On-call long-text dialog: the hub mod opened as a dialog (props().dialog === ONCALL_TEXT_DIALOG)
// to read and edit "My domain" or the repo profile's summary, which take too much room inline.
import { div } from "gpui-kit";
import { h_flex, v_flex, TextareaState, Textarea } from "gpui-base";
import { theme, notify, props, openOverlay, closeOverlay, setShared } from "herdr";
import { palette, stop, MONO_FONT } from "../ui.js";
import { MAX_DOMAIN_LENGTH } from "./config.js";
import { loadOncallConfig, saveOncallConfig } from "./client.js";

export const ONCALL_TEXT_DIALOG = "oncall-text";
// Set to the save time after a save, so the open settings read the config again.
export const ONCALL_TEXT_SAVED_STORE = "hub.oncall.textSavedAt";
const DIALOG_SIZE = { width: 640, height: 520 };

/** @typedef {"domain" | "summary"} OncallTextField */
/** @typedef {import("./config.js").OncallConfig} OncallConfig */

/** @type {Record<OncallTextField, { title: string, description: string, placeholder: string, isMono: boolean }>} */
const FIELDS = {
  domain: {
    title: "My domain",
    description: "What you are on call for. A quick check drops issues outside it before the full triage.",
    placeholder: `Describe what you own, or paste your CODEOWNERS lines:
/apps/shop/ @my-org/my-team
/packages/payments/ @my-org/my-team
or: "The shop app: cart, checkout and payments"`,
    isMono: true,
  },
  summary: {
    title: "Repo profile summary",
    description: "The scan's short read of the repo. Every triage reads it, so fix anything it got wrong.",
    placeholder: "Scan the repo to fill this in.",
    isMono: false,
  },
};

/** @param {OncallTextField} field */
export const openOncallTextDialog = (field) => openOverlay({ mod: "hub", kind: "dialog", ...DIALOG_SIZE, props: { dialog: ONCALL_TEXT_DIALOG, field } });

/** @param {{ config: OncallConfig, field: OncallTextField }} params */
const readField = ({ config, field }) => {
  switch (field) {
    case "domain": return config.domain;
    case "summary": return config.repoProfile?.summary ?? "";
    default: {
      /** @type {never} */
      const unknownField = field;
      return unknownField;
    }
  }
};

/** @param {{ config: OncallConfig, field: OncallTextField, text: string }} params @returns {OncallConfig} */
const writeField = ({ config, field, text }) => {
  switch (field) {
    case "domain": return { ...config, domain: text.slice(0, MAX_DOMAIN_LENGTH) };
    case "summary": return config.repoProfile ? { ...config, repoProfile: { ...config.repoProfile, summary: text } } : config;
    default: {
      /** @type {never} */
      const unknownField = field;
      return unknownField;
    }
  }
};

export class OncallTextDialog {
  /** @param {{ cx: import("gpui-kit").Context, field: OncallTextField }} params */
  constructor({ cx, field }) {
    this.field = field;
    /** @type {"loading" | "ready" | "saving"} */
    this.status = "loading";
    this.saved = "";
    this.input = TextareaState.new({ placeholder: FIELDS[field].placeholder });
    this.input.on("change", (_e, cx) => cx.notify());
    cx.spawn(async (cx) => {
      this.saved = readField({ config: await loadOncallConfig(), field });
      this.input.set_value(this.saved);
      this.status = "ready";
      cx.notify();
    });
  }

  get isChanged() {
    return this.input.value().trim() !== this.saved.trim();
  }

  // Writes the field into a fresh read of the config, so nothing else saved meanwhile is lost.
  /** @param {import("gpui-kit").Context} cx */
  handleSave(cx) {
    if (this.status !== "ready" || !this.isChanged) return;
    this.status = "saving";
    cx.notify();
    cx.spawn(async (cx) => {
      const config = await loadOncallConfig();
      const r = await saveOncallConfig(writeField({ config, field: this.field, text: this.input.value().trim() }));
      if (r.status !== "success") {
        notify({ title: "Could not save the On-call setup", body: r.message, level: "warning" });
        this.status = "ready";
        cx.notify();
        return;
      }
      setShared(ONCALL_TEXT_SAVED_STORE, Date.now());
      closeOverlay(props().overlay);
    });
  }

  /** @param {{ id: string, label: string, isPrimary: boolean, isDisabled: boolean, onClick: (cx: import("gpui-kit").Context) => void }} params */
  button({ id, label, isPrimary, isDisabled, onClick }) {
    const t = theme();
    const base = div().id(id).h(28).px(14).flex_none().flex().items_center().rounded(6).border(1).text_size(12);
    const styled = isPrimary ? base.border_color(t.solid).bg(t.solid).text_color(t.solid_foreground) : base.border_color(t.border).text_color(t.foreground);
    if (isDisabled) return styled.opacity(0.5).child(label);
    return styled.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => onClick(cx)).child(label);
  }

  render() {
    const t = theme();
    const def = FIELDS[this.field];
    const footerText = this.status === "saving" ? "Saving…" : this.isChanged ? "Not saved yet" : "";
    return v_flex().id("oncall-text-dialog").size_full().p(16).gap(10).bg(t.background)
      .child(v_flex().gap(4)
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child(def.title))
        .child(div().text_size(12).text_color(t.muted).child(def.description)))
      .child(div().id("oncall-text-field").flex_1().min_h(0).rounded(6).border(1).border_color(t.input).px(8).py(6).bg(t.background)
        .overflow_y_scrollbar().on_mouse_down("left", stop)
        .child(Textarea.new(this.input).w_full().h_full().text_size(12).text_color(t.foreground).when(def.isMono, (el) => el.font_family(MONO_FONT))))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(11.5).text_color(palette(t).warning).child(footerText))
        .child(this.button({ id: "oncall-text-cancel", label: "Cancel", isPrimary: false, isDisabled: false, onClick: () => closeOverlay(props().overlay) }))
        .child(this.button({ id: "oncall-text-save", label: "Save", isPrimary: true, isDisabled: this.status !== "ready" || !this.isChanged, onClick: (cx) => this.handleSave(cx) })));
  }
}

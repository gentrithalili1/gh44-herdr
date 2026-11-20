// The gh44 dialog: the hub mod opened as a dialog (props().dialog === GH44_DIALOG).
// Two cards, gh44-brain and gh44-theme: a preview, a line on each and its install button.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, notify, props, openOverlay, closeOverlay } from "herdr";
import { icon, palette } from "./ui.js";
import { loadInstalledSkills, loadHasGh44Theme, installGh44Brain, installGh44Theme, INSTALL_ERRORS } from "./actions.js";
import { getGh44Setup, isUsingGh44Setup, countInstalledSkills } from "./settings.js";

export const GH44_DIALOG = "gh44";
const DIALOG_SIZE = { width: 580, height: 322 };
const PREVIEW_HEIGHT = 72;
const GITHUB_OWNER_URL = "https://github.com/gentrithalili1";
// The gh44 skills one ticket goes through, in order.
const BRAIN_STEPS = ["clarify", "plan", "implement", "review"];
// gh44-dark and gh44-light: background, foreground and four accent colors, for the preview.
const THEME_PREVIEW = [
  { name: "dark", background: "#101114", foreground: "#DFE1E5", colors: ["#75ADDB", "#9EBF7A", "#D4B25E", "#FD5D62"] },
  { name: "light", background: "#FAF7F3", foreground: "#2B2D30", colors: ["#0A6BA3", "#4C7B1D", "#916913", "#D30A15"] },
];
/** @typedef {"brain" | "theme"} Gh44Repo */
/** @type {Record<Gh44Repo, { name: string, install: () => Promise<import("./actions.js").InstallOutcome> }>} */
const REPOS = {
  brain: { name: "gh44-brain", install: installGh44Brain },
  theme: { name: "gh44-theme", install: installGh44Theme },
};

export const openGh44Dialog = () => openOverlay({ mod: "hub", kind: "dialog", ...DIALOG_SIZE, props: { dialog: GH44_DIALOG } });

export class Gh44Dialog {
  /**
   * @param {{
   *   cx: import("gpui-kit").Context,
   *   getSettings: () => import("./settings.js").Settings,
   *   patchSettings: (patch: Record<string, unknown>) => void,
   * }} params
   */
  constructor({ cx, getSettings, patchSettings }) {
    this.getSettings = getSettings;
    this.patchSettings = patchSettings;
    /** @type {string[] | null} */
    this.installedSkills = null;
    /** @type {boolean | null} */
    this.hasTheme = null;
    /** @type {Set<Gh44Repo>} */
    this.installing = new Set();
    this.loadInstalled(cx);
  }

  /** @param {import("gpui-kit").Context} cx */
  loadInstalled(cx) {
    cx.spawn(async (cx) => {
      this.installedSkills = (await loadInstalledSkills()) ?? this.installedSkills;
      this.hasTheme = (await loadHasGh44Theme()) ?? this.hasTheme;
      cx.notify();
    });
  }

  /** @param {{ cx: import("gpui-kit").Context, repo: Gh44Repo }} params */
  handleInstall({ cx, repo }) {
    if (this.installing.has(repo)) return;
    this.installing.add(repo);
    cx.notify();
    const { name, install } = REPOS[repo];
    cx.spawn(async (cx) => {
      const r = await install();
      this.installing.delete(repo);
      if (r.status === "success") {
        notify({ title: `${name} installed`, level: "info" });
        this.loadInstalled(cx);
      } else {
        notify({ title: `Could not install ${name}`, body: r.message || INSTALL_ERRORS[r.reason], level: "warning" });
      }
      cx.notify();
    });
  }

  /** @param {import("gpui-kit").Context} cx */
  handleUseSkills(cx) {
    this.patchSettings({ skills: getGh44Setup() });
    notify({ title: "gh44 skills in use on both tabs", level: "info" });
    cx.notify();
  }

  // A card's full-width button: solid while there is something to do, a check when done.
  /** @param {{ id: string, label: string, state: "action" | "busy" | "done", onClick?: (e: unknown, cx: import("gpui-kit").Context) => void }} params */
  cardButton({ id, label, state, onClick }) {
    const t = theme();
    const base = h_flex().id(id).w_full().h(30).gap(6).items_center().justify_center().rounded(8).border_1().text_size(12);
    switch (state) {
      case "done":
        return base.border_color(t.border).text_color(t.muted)
          .child(svg(icon("check")).size(12).text_color(palette(t).success))
          .child(label);
      case "busy":
        return base.border_color(t.solid).bg(t.solid).text_color(t.solid_foreground).opacity(0.7)
          .child(svg("mods/workspace-chrome/spinner.svg").size(12).spin(900))
          .child(label);
      case "action":
        return base.border_color(t.solid).bg(t.solid).text_color(t.solid_foreground).cursor_pointer().hover((s) => s.opacity(0.88))
          .when(Boolean(onClick), (el) => el.on_click(onClick ?? (() => {})))
          .child(label);
      default: {
        /** @type {never} */
        const unknownState = state;
        return unknownState;
      }
    }
  }

  // Preview, name with a link to its repo, a line on what it is, and its button.
  /** @param {{ repo: Gh44Repo, preview: ReturnType<typeof div>, detail: string, button: ReturnType<typeof h_flex> }} params */
  card({ repo, preview, detail, button }) {
    const t = theme();
    const { name } = REPOS[repo];
    return v_flex().id(`gh44-card-${repo}`).flex_1().min_w(0).p(10).gap(8).rounded(10).border_1().border_color(t.border).bg(t.background)
      .child(preview)
      .child(h_flex().gap(6).items_center()
        .child(div().flex_1().text_size(13).font_semibold().text_color(t.foreground).child(name))
        .child(h_flex().id(`gh44-card-${repo}-link`).h(22).px(6).gap(4).items_center().rounded(5).border_1().border_color(t.border)
          .text_size(11).text_color(t.accent).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(`Open ${name} on GitHub`)
          .on_click((_e, cx) => cx.open_url(`${GITHUB_OWNER_URL}/${name}`))
          .child(svg(icon("github")).size(11))
          .child("Source")))
      .child(div().flex_1().text_size(11.5).text_color(t.muted).child(detail))
      .child(button);
  }

  // The steps a ticket goes through: clarify › plan › implement › review.
  brainPreview() {
    const t = theme();
    return h_flex().h(PREVIEW_HEIGHT).px(8).gap(2).items_center().justify_center().rounded(7).bg(t.raised)
      .children(BRAIN_STEPS.flatMap((step, i) => [
        ...(i > 0 ? [svg(icon("chevron-right")).size(9).flex_none().text_color(t.dim)] : []),
        div().h(20).px(5).flex().flex_none().items_center().rounded(5).bg(t.background).text_size(10.5).text_color(t.foreground).child(step),
      ]));
  }

  // gh44-dark and gh44-light side by side, each with "Aa" and its colors.
  themePreview() {
    return h_flex().h(PREVIEW_HEIGHT).items_stretch().rounded(7).border_1().border_color(theme().border).overflow_hidden()
      .children(THEME_PREVIEW.map((look) => v_flex().flex_1().h_full().gap(6).items_center().justify_center().bg(look.background)
        .child(div().text_size(15).font_semibold().text_color(look.foreground).child("Aa"))
        .child(h_flex().gap(4).children(look.colors.map((color, i) => div().id(`gh44-swatch-${look.name}-${i}`).size(8).rounded(4).bg(color))))));
  }

  brainButton() {
    const setup = getGh44Setup();
    const count = this.installedSkills ? countInstalledSkills({ skills: setup, installedSkills: this.installedSkills }) : null;
    if (this.installing.has("brain")) return this.cardButton({ id: "gh44-brain-button", label: "Installing…", state: "busy" });
    if (count !== null && count.installed < count.total) {
      return this.cardButton({ id: "gh44-brain-button", label: "Install", state: "action", onClick: (_e, cx) => this.handleInstall({ cx, repo: "brain" }) });
    }
    if (isUsingGh44Setup({ skills: this.getSettings().skills })) return this.cardButton({ id: "gh44-brain-button", label: "In use", state: "done" });
    return this.cardButton({ id: "gh44-brain-button", label: "Use on both tabs", state: "action", onClick: (_e, cx) => this.handleUseSkills(cx) });
  }

  themeButton() {
    if (this.installing.has("theme")) return this.cardButton({ id: "gh44-theme-button", label: "Installing…", state: "busy" });
    if (this.hasTheme) return this.cardButton({ id: "gh44-theme-button", label: "Installed", state: "done" });
    return this.cardButton({ id: "gh44-theme-button", label: "Install", state: "action", onClick: (_e, cx) => this.handleInstall({ cx, repo: "theme" }) });
  }

  render() {
    const t = theme();
    return v_flex().id("gh44-dialog").size_full().min_h(0).p(18).gap(14).rounded(8).bg(t.popover).text_size(13)
      .child(v_flex().gap(2)
        .child(h_flex().items_center()
          .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("gh44 extras"))
          .child(div().text_size(11).text_color(t.dim).child("Esc")))
        .child(div().text_size(12).text_color(t.dim).child("Optional. The panel works with your own skills and any theme.")))
      .child(h_flex().flex_1().min_h(0).gap(12).items_stretch()
        .child(this.card({
          repo: "brain",
          preview: this.brainPreview(),
          detail: "Claude skills for each step of a ticket or PR, set up on the GitHub and Linear tabs.",
          button: this.brainButton(),
        }))
        .child(this.card({
          repo: "theme",
          preview: this.themePreview(),
          detail: "gh44-dark and gh44-light for Herdr. Pick one in Herdr's settings.",
          button: this.themeButton(),
        })));
  }
}

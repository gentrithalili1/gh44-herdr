// The gh44 setup: gh44-brain's skills on the GitHub and Linear tabs, and the gh44-theme themes.
// Gh44Setup holds what is installed and runs the installs, for the General settings' cards and for
// the gh44 dialog (the hub mod opened as a dialog, props().dialog === GH44_DIALOG).
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, notify, props, openOverlay, closeOverlay } from "herdr";
import { palette } from "./ui.js";
import { button, dialogHeader, dialogSection, dialogFooter } from "./controls.js";
import { loadInstalledSkills, loadHasGh44Theme, installGh44Brain, installGh44Theme, INSTALL_ERRORS } from "./actions.js";
import { getGh44Setup, isUsingGh44Setup, countInstalledSkills, shortSkill, isLinkEntry, ASK_ACTION, CONTINUE_ACTION } from "./settings.js";

export const GH44_DIALOG = "gh44";
const DIALOG_SIZE = { width: 480, height: 300 };
const FACT_LABEL_WIDTH = 110;
/** @typedef {"brain" | "theme"} Gh44Repo */
/** @type {Record<Gh44Repo, { name: string, install: () => Promise<import("./actions.js").InstallOutcome> }>} */
const REPOS = {
  brain: { name: "gh44-brain", install: installGh44Brain },
  theme: { name: "gh44-theme", install: installGh44Theme },
};
/** @type {{ tab: "github" | "linear", label: string }[]} */
const BRAIN_TABS = [{ tab: "github", label: "GitHub" }, { tab: "linear", label: "Linear" }];

export const openGh44Dialog = () => openOverlay({ mod: "hub", kind: "dialog", ...DIALOG_SIZE, props: { dialog: GH44_DIALOG } });

// gh44-brain's next step: install it, use it on both tabs, or done.
/** @typedef {{ status: "loading" } | { status: "installing" } | { status: "install", installed: number, total: number } | { status: "use" } | { status: "inUse" }} BrainState */
/** @typedef {"loading" | "installing" | "install" | "installed"} ThemeState */

// "GitHub: code-review · address-review · resolve-conflicts": the skills gh44-brain sets up on a
// tab (no built-in action or link entry).
/** @param {"github" | "linear"} tab */
const getBrainLine = (tab) => getGh44Setup()[tab].list.map((e) => e.name)
  .filter((name) => name !== ASK_ACTION && name !== CONTINUE_ACTION && !isLinkEntry(name)).map(shortSkill).join(" · ");

export class Gh44Setup {
  /**
   * @param {{
   *   getSettings: () => import("./settings.js").Settings,
   *   patchSettings: (patch: Record<string, unknown>) => void,
   * }} params
   */
  constructor({ getSettings, patchSettings }) {
    this.getSettings = getSettings;
    this.patchSettings = patchSettings;
    /** @type {string[] | null} */
    this.installedSkills = null;
    /** @type {boolean | null} */
    this.hasTheme = null;
    /** @type {Set<Gh44Repo>} */
    this.installing = new Set();
  }

  /** @param {import("gpui-kit").Context} cx */
  load(cx) {
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
        this.load(cx);
      } else {
        notify({ title: `Could not install ${name}`, body: r.message || INSTALL_ERRORS[r.reason], level: "warning" });
      }
      cx.notify();
    });
  }

  handleUseSkills() {
    this.patchSettings({ skills: getGh44Setup() });
    notify({ title: "gh44 skills in use on both tabs", level: "info" });
  }

  /** @returns {BrainState} */
  getBrainState() {
    if (this.installing.has("brain")) return { status: "installing" };
    if (!this.installedSkills) return { status: "loading" };
    const count = countInstalledSkills({ skills: getGh44Setup(), installedSkills: this.installedSkills });
    if (count.installed < count.total) return { status: "install", ...count };
    return isUsingGh44Setup({ skills: this.getSettings().skills }) ? { status: "inUse" } : { status: "use" };
  }

  /** @returns {ThemeState} */
  getThemeState() {
    if (this.installing.has("theme")) return "installing";
    if (this.hasTheme === null) return "loading";
    return this.hasTheme ? "installed" : "install";
  }

  // "4 of 7 installed"; null until the skills are listed.
  getBrainCount() {
    if (!this.installedSkills) return null;
    return countInstalledSkills({ skills: getGh44Setup(), installedSkills: this.installedSkills });
  }

  // gh44-brain's button: Install, Use on both tabs, or a quiet In use.
  /** @param {string} id */
  brainButton(id) {
    const state = this.getBrainState();
    switch (state.status) {
      case "loading": return button({ id, label: "Checking…", variant: "busy" });
      case "installing": return button({ id, label: "Installing…", variant: "busy" });
      case "install": return button({ id, label: "Install", variant: "primary", onClick: (cx) => this.handleInstall({ cx, repo: "brain" }) });
      case "use": return button({ id, label: "Use on both tabs", variant: "primary", onClick: () => this.handleUseSkills() });
      case "inUse": return statusText({ text: "✓ In use", isDone: true });
      default: {
        /** @type {never} */
        const unknownState = state;
        return unknownState;
      }
    }
  }

  /** @param {string} id */
  themeButton(id) {
    const state = this.getThemeState();
    switch (state) {
      case "loading": return button({ id, label: "Checking…", variant: "busy" });
      case "installing": return button({ id, label: "Installing…", variant: "busy" });
      case "install": return button({ id, label: "Install", variant: "primary", onClick: (cx) => this.handleInstall({ cx, repo: "theme" }) });
      case "installed": return statusText({ text: "✓ Installed", isDone: true });
      default: {
        /** @type {never} */
        const unknownState = state;
        return unknownState;
      }
    }
  }

  // The General settings' cards: name and button, what it sets up, and how much of it is installed.
  cards() {
    const t = theme();
    const count = this.getBrainCount();
    const isMissing = count !== null && count.installed < count.total;
    return [
      card({
        id: "brain", name: REPOS.brain.name, action: this.brainButton("gh44-brain-button"),
        lines: [
          ...BRAIN_TABS.map(({ tab, label }) => div().text_size(11.5).text_color(t.muted).child(`${label}: ${getBrainLine(tab)}`)),
          ...(count ? [div().text_size(11.5).text_color(isMissing ? palette(t).warning : t.dim)
            .child(`${count.installed} of ${count.total} installed${isMissing ? " · rows skip missing skills and show \"open\"" : ""}`)] : []),
        ],
      }),
      card({
        id: "theme", name: REPOS.theme.name, action: this.themeButton("gh44-theme-button"),
        lines: [div().text_size(11.5).text_color(t.muted).child("gh44-dark and gh44-light. Pick one in Herdr's settings.")],
      }),
    ];
  }
}

/** @param {{ text: string, isDone: boolean }} params */
const statusText = ({ text, isDone }) => {
  const t = theme();
  return div().flex_none().text_size(12).text_color(isDone ? palette(t).success : t.dim).child(text);
};

/** @param {{ id: string, name: string, action: ReturnType<typeof div>, lines: ReturnType<typeof div>[] }} params */
const card = ({ id, name, action, lines }) => {
  const t = theme();
  return v_flex().id(`gh44-card-${id}`).flex_none().px(10).py(8).gap(4).rounded(4).bg(t.popover).border(1).border_color(t.border)
    .child(h_flex().gap(8).items_center()
      .child(div().flex_1().text_size(12.5).font_semibold().text_color(t.foreground).child(name))
      .child(action))
    .children(lines);
};

export class Gh44Dialog {
  /**
   * @param {{
   *   cx: import("gpui-kit").Context,
   *   getSettings: () => import("./settings.js").Settings,
   *   patchSettings: (patch: Record<string, unknown>) => void,
   * }} params
   */
  constructor({ cx, getSettings, patchSettings }) {
    this.setup = new Gh44Setup({ getSettings, patchSettings });
    this.setup.load(cx);
  }

  /** @param {{ label: string, value: ReturnType<typeof div> }} params */
  factRow({ label, value }) {
    const t = theme();
    return h_flex().min_h(30).flex_none().gap(8).items_center().text_size(12.5)
      .child(div().w(FACT_LABEL_WIDTH).flex_none().text_color(t.dim).child(label))
      .child(h_flex().flex_1().min_w(0).gap(8).items_center().child(value));
  }

  render() {
    const t = theme();
    const count = this.setup.getBrainCount();
    const isComplete = this.setup.getBrainState().status === "inUse" && this.setup.getThemeState() === "installed";
    const brainText = count ? `${count.installed} of ${count.total} skills` : "Checking…";
    return v_flex().id("gh44-dialog").size_full().min_h(0).rounded(8).overflow_hidden().bg(t.popover).text_color(t.foreground)
      .child(dialogHeader({
        tone: isComplete ? "success" : "warning", iconName: isComplete ? "check" : "alert",
        title: "gh44 setup", subtitle: "Skills and theme from gh44-brain and gh44-theme. Optional: the panel works with your own.",
      }))
      .child(v_flex().id("gh44-dialog-body").flex_1().min_h(0).overflow_y_scrollbar()
        .child(dialogSection({
          id: "gh44",
          children: [
            this.factRow({ label: REPOS.brain.name, value: h_flex().flex_1().gap(8).items_center()
              .child(div().flex_1().text_color(count && count.installed < count.total ? palette(t).warning : t.foreground).child(brainText))
              .child(this.setup.brainButton("gh44-dialog-brain")) }),
            this.factRow({ label: "Use on tabs", value: div().text_color(t.muted).child(BRAIN_TABS.map((b) => b.label).join(" and ")) }),
            this.factRow({ label: REPOS.theme.name, value: h_flex().flex_1().gap(8).items_center()
              .child(div().flex_1().text_color(t.muted).child("gh44-dark and gh44-light"))
              .child(this.setup.themeButton("gh44-dialog-theme")) }),
          ],
        })))
      .child(dialogFooter({ buttons: [button({ id: "gh44-close", label: "Close", onClick: () => closeOverlay(props().overlay) })] }));
  }
}

// The ⚙ settings view: General · GitHub · Linear, shown in the Work panel in place of its list.
// It owns its inputs and edit state; the panel hands it the settings, the session and what to
// do when the Linear key changes.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, notify } from "herdr";
import { icon, palette, stop, MONO_FONT, GUTTER } from "./ui.js";
import { loadLinearViewer, saveLinearKey, removeLinearKey } from "./linear.js";
import { loadInstalledSkills, loadHasGh44Theme, installGh44Theme, installGh44Brain } from "./actions.js";
import {
  getDefaultSkill, shortSkill, getGh44Setup, isUsingGh44Setup, countInstalledSkills, addSkill, removeSkill, setSkillKey, setDefaultSkill, isValidSkillName,
  GITHUB_SITUATIONS, LINEAR_SITUATIONS, canRun,
} from "./settings.js";

/** @typedef {"general" | "github" | "linear"} SectionId */
/** @typedef {"linearKey" | "skillKey" | "addSkill"} InputId */
/**
 * @typedef {{
 *   login: string | null,
 *   linearAccount: { status: "idle" | "checking" | "connected" | "missing" | "failed", name?: string, message?: string },
 *   installedSkills: string[] | null,
 *   hasGh44Theme: boolean | null,
 * }} Session
 */

/** @type {{ tab: "github" | "linear", situations: { id: import("./settings.js").Situation, label: string }[] }[]} */
const SKILL_TABS = [
  { tab: "github", situations: GITHUB_SITUATIONS },
  { tab: "linear", situations: LINEAR_SITUATIONS },
];
/** @type {{ id: SectionId, label: string, iconName: string }[]} */
const SECTIONS = [
  { id: "general", label: "General", iconName: "settings" },
  { id: "github", label: "GitHub", iconName: "github" },
  { id: "linear", label: "Linear", iconName: "linear" },
];
/** @type {{ id: import("./settings.js").WhereToRun, label: string }[]} */
const WHERE_TO_RUN_OPTIONS = [
  { id: "ask", label: "Ask every time" },
  { id: "worktree", label: "Always a new worktree" },
  { id: "here", label: "Always this space" },
];
// Installed skills offered under the Add skill field.
const SKILL_SUGGESTIONS = 6;
const GH44_BRAIN_URL = "https://github.com/gentrithalili1/gh44-brain";
/** @typedef {"theme" | "brain"} Gh44Repo */
/** @type {Record<Gh44Repo, { name: string, install: () => Promise<import("./actions.js").InstallOutcome> }>} */
const GH44_REPOS = {
  theme: { name: "gh44-theme", install: installGh44Theme },
  brain: { name: "gh44-brain", install: installGh44Brain },
};
/** @type {Record<"notLinked" | "clone" | "install", string>} */
const INSTALL_ERRORS = {
  notLinked: "The hub mod is not linked from gh44-herdr. Run gh44-herdr/install.sh.",
  clone: "git clone failed. Check your network and GitHub access.",
  install: "The install failed.",
};
const LINEAR_API_KEYS_URL = "https://linear.app/settings/account/security";
const SWITCH_HEIGHT = 32;
const HEADER_HEIGHT = 40;

export class SettingsView {
  /**
   * InputState needs a live host call, so this runs in the panel's init.
   * @param {{
   *   session: Session,
   *   getSettings: () => import("./settings.js").Settings,
   *   patchSettings: (patch: Record<string, unknown>) => void,
   *   saveSkills: (params: { tab: "github" | "linear", skills: import("./settings.js").Skills }) => void,
   *   onLinearKeyChange: (cx: import("gpui-kit").Context) => void,
   *   focusPanel: () => void,
   * }} host
   */
  constructor({ session, getSettings, patchSettings, saveSkills, onLinearKeyChange, focusPanel }) {
    this.session = session;
    this.getSettings = getSettings;
    this.patchSettings = patchSettings;
    this.saveSkills = saveSkills;
    this.onLinearKeyChange = onLinearKeyChange;
    this.focusPanel = focusPanel;
    this.isOpen = false;
    // The last section shown, kept for the session.
    /** @type {SectionId} */
    this.sectionId = "general";
    /** @type {InputId | null} */
    this.focusedInput = null;
    // The Linear API key field, in the settings and in the Linear tab until a key works.
    /** @type {{ status: "idle" | "saving" | "failed", message?: string }} */
    this.keySave = { status: "idle" };
    // The gh44 repos being installed from the settings right now.
    /** @type {Set<Gh44Repo>} */
    this.installing = new Set();
    this.linearKeyInput = InputState.new({ placeholder: "lin_api_…" });
    this.linearKeyInput.set_masked(true);
    this.linearKeyInput.on("submit", (_e, cx) => this.handleSaveLinearKey(cx));
    this.trackFocus({ input: this.linearKeyInput, id: "linearKey" });
    // The skills editor: one key letter field and one Add skill field, moved to the row being edited.
    /** @type {{ tab: "github" | "linear", skill: string } | null} */
    this.keyEditing = null;
    /** @type {"github" | "linear" | null} */
    this.addingTab = null;
    // "<tab>:<situation>" whose default picker is open.
    /** @type {string | null} */
    this.openPicker = null;
    this.skillKeyInput = InputState.new({ placeholder: "" });
    this.skillKeyInput.on("change", (_e, cx) => this.handleSkillKeyChange(cx));
    this.trackFocus({ input: this.skillKeyInput, id: "skillKey" });
    // The typed name was turned down: it is not one word.
    this.isAddSkillRefused = false;
    this.addSkillInput = InputState.new({ placeholder: "Skill name, as in /name" });
    this.addSkillInput.on("change", (_e, cx) => { this.isAddSkillRefused = false; cx.notify(); });
    this.addSkillInput.on("submit", (_e, cx) => this.handleAddSkill({ skill: this.addSkillInput.value(), cx }));
    this.trackFocus({ input: this.addSkillInput, id: "addSkill" });
  }

  // Which of the view's inputs has the keyboard, so the panel's own keys stay off while typing.
  /** @param {{ input: import("gpui-base").InputState, id: InputId }} params */
  trackFocus({ input, id }) {
    input.on("focus", (_e, cx) => { this.focusedInput = id; cx.notify(); });
    input.on("blur", (_e, cx) => {
      if (this.focusedInput === id) this.focusedInput = null;
      cx.notify();
    });
  }

  isTyping() {
    return this.focusedInput !== null;
  }

  // section: where to land; without one, the last section shown.
  /** @param {{ cx: import("gpui-kit").Context, section?: "general" | "github" | "linear" }} params */
  open({ cx, section }) {
    this.isOpen = true;
    if (section) this.sectionId = section;
    this.loadSkillList(cx);
    if (!this.getSettings().shouldShowLinear || this.session.linearAccount.status === "checking") return;
    this.session.linearAccount = { status: "checking" };
    cx.spawn(async (cx) => {
      const r = await loadLinearViewer();
      if (r.status === "success") this.session.linearAccount = { status: "connected", name: r.name };
      else this.session.linearAccount = r.reason === "auth" ? { status: "missing", message: r.message } : { status: "failed", message: r.message };
      cx.notify();
    });
  }

  // Back to the list; an edit left open in the settings is dropped.
  close() {
    this.isOpen = false;
    this.keyEditing = null;
    this.addingTab = null;
    this.openPicker = null;
    this.focusPanel();
  }

  // A skill added to ~/.claude/skills, or the gh44 theme, shows up the next time the settings open.
  /** @param {import("gpui-kit").Context} cx */
  loadSkillList(cx) {
    cx.spawn(async (cx) => {
      this.session.installedSkills = (await loadInstalledSkills()) ?? this.session.installedSkills;
      this.session.hasGh44Theme = (await loadHasGh44Theme()) ?? this.session.hasGh44Theme;
      cx.notify();
    });
  }

  /** @param {import("gpui-kit").Context} cx */
  handleSkillKeyChange(cx) {
    const value = this.skillKeyInput.value();
    const editing = this.keyEditing;
    if (!value || !editing) return;
    this.saveSkills({ tab: editing.tab, skills: setSkillKey({ skills: this.getSettings().skills, tab: editing.tab, skill: editing.skill, key: value.slice(-1) }) });
    this.keyEditing = null;
    this.skillKeyInput.set_value("");
    this.focusPanel();
    cx.notify();
  }

  /** @param {{ skill: string, cx: import("gpui-kit").Context }} params */
  handleAddSkill({ skill, cx }) {
    const name = skill.trim();
    if (!this.addingTab || !name) return;
    if (!isValidSkillName(name)) {
      this.isAddSkillRefused = true;
      cx.notify();
      return;
    }
    this.saveSkills({ tab: this.addingTab, skills: addSkill({ skills: this.getSettings().skills, tab: this.addingTab, skill: name }) });
    this.addSkillInput.set_value("");
    this.addingTab = null;
    this.focusPanel();
    cx.notify();
  }

  /** @param {import("gpui-kit").Context} cx */
  handleSaveLinearKey(cx) {
    const key = this.linearKeyInput.value();
    if (!key.trim() || this.keySave.status === "saving") return;
    this.keySave = { status: "saving" };
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await saveLinearKey(key);
      if (r.status === "success") {
        this.session.linearAccount = { status: "connected", name: r.name };
        this.keySave = { status: "idle" };
        this.linearKeyInput.set_value("");
        this.onLinearKeyChange(cx);
      } else {
        this.keySave = { status: "failed", message: r.message ?? "Linear did not accept this key" };
      }
      cx.notify();
    });
  }

  /** @param {import("gpui-kit").Context} cx */
  handleRemoveLinearKey(cx) {
    cx.spawn(async (cx) => {
      const r = await removeLinearKey();
      if (r.status === "success") {
        this.session.linearAccount = { status: "missing" };
        this.onLinearKeyChange(cx);
      } else {
        notify({ title: "Could not remove the Linear key", body: r.message, level: "warning" });
      }
      cx.notify();
    });
  }

  // The Linear tab without a working key: what to do, then the key field.
  // It sits in the list, whose mouse down takes the keyboard for j/k; stop that so the field keeps focus.
  /** @param {string | undefined} reason */
  linearConnect(reason) {
    const t = theme();
    return v_flex().id("linear-connect").p(16).gap(10).text_size(12.5).on_mouse_down("left", stop)
      .child(div().text_color(t.foreground).font_semibold().child("Connect Linear"))
      .child(div().text_color(t.dim).child(reason ?? "Paste a personal API key. It stays on this machine, readable only by you."))
      .child(this.linearKeyField());
  }

  // [key ••••• | Save], Linear's answer when it turns a key down, and where to make a key.
  linearKeyField() {
    const t = theme();
    const isSaving = this.keySave.status === "saving";
    const saveButton = h_flex().id("linear-key-save").h_full().px(10).gap(6).items_center().flex_none().text_size(12)
      .bg(t.raised).text_color(isSaving ? t.muted : t.foreground)
      .when(!isSaving, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.handleSaveLinearKey(cx)))
      .when(isSaving, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900)))
      .child(isSaving ? "Checking…" : "Save");
    return v_flex().flex_none().gap(6)
      .child(h_flex().h(30).items_center().rounded(6).border(1).border_color(this.focusedInput === "linearKey" ? t.accent : t.input).bg(t.background).overflow_hidden()
        .child(h_flex().flex_1().min_w(0).px(8).items_center().child(Input.new(this.linearKeyInput).flex_1().text_size(12).text_color(t.foreground)))
        .child(div().w(1).h_full().bg(t.border))
        .child(saveButton))
      .when(this.keySave.status === "failed", (el) => el.child(div().text_size(11.5).text_color(palette(t).danger).child(this.keySave.message ?? "")))
      .child(h_flex().id("linear-key-link").gap(4).items_center().text_size(11.5).text_color(t.accent).cursor_pointer()
        .on_click((_e, cx) => cx.open_url(LINEAR_API_KEYS_URL))
        .child("Create a key in Linear: Settings › Security & access"));
  }

  // Settings' Linear section: who the key belongs to with Remove, or the key field.
  linearAccountRows() {
    const t = theme();
    const account = this.session.linearAccount;
    if (account.status === "checking") return [div().text_size(12).text_color(t.dim).child("Checking the Linear key…")];
    if (account.status !== "connected") {
      const note = account.status === "failed" ? [div().text_size(11.5).text_color(palette(t).warning).child(`Could not check the key: ${account.message ?? "unknown error"}`)] : [];
      return [...note, this.linearKeyField()];
    }
    return [h_flex().h(28).px(6).gap(8).items_center()
      .child(div().size(7).rounded(4).bg(palette(t).success))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(`Connected as ${account.name}`))
      .child(div().id("linear-key-remove").h(24).px(10).flex().items_center().rounded(6).border(1).border_color(t.border).text_size(12)
        .text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.handleRemoveLinearKey(cx))
        .child("Remove"))];
  }

  // ← Settings, the General · GitHub · Linear switch, then the picked section.
  // It takes the list's place until ← or Esc.
  render() {
    const t = theme();
    const settings = this.getSettings();
    const back = h_flex().id("settings-back").h(26).px(6).gap(6).items_center().rounded(6).cursor_pointer()
      .text_size(13).font_semibold().text_color(t.foreground).hover((s) => s.bg(t.hover)).tooltip("Back to the list (Esc)")
      .on_click((_e, cx) => { this.close(); cx.notify(); })
      .child(svg(icon("chevron-left")).size(14).text_color(t.muted))
      .child("Settings");
    return v_flex().flex_1().min_h(0)
      .child(h_flex().flex_none().h(HEADER_HEIGHT).px(GUTTER - 6).items_center().border_b(1).border_color(t.border).child(back))
      .child(div().flex_none().px(GUTTER).pt(12).pb(12).border_b(1).border_color(t.border).child(this.sectionSwitch()))
      .child(v_flex().id("settings-list").flex_1().min_h(0).overflow_y_scrollbar().px(GUTTER).pt(14).pb(14).gap(18)
        .children(this.settingsGroups(settings)));
  }

  // [⚙ General | GitHub | Linear]: a full-width segmented control. Every segment keeps a 1px
  // border (transparent when not picked), so picking one moves nothing.
  sectionSwitch() {
    const t = theme();
    return h_flex().id("settings-sections").w_full().h(SWITCH_HEIGHT).p(3).rounded(8).border(1).border_color(t.border).bg(t.background)
      .children(SECTIONS.map((section) => {
        const isOn = this.sectionId === section.id;
        return h_flex().id(`settings-section-${section.id}`).flex_1().h_full().gap(6).items_center().justify_center().rounded(6)
          .border(1).text_size(12.5)
          .when(isOn, (el) => el.bg(t.raised).border_color(t.border).text_color(t.foreground).font_medium())
          .when(!isOn, (el) => el.border_color("#00000000").text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { this.sectionId = section.id; this.openPicker = null; cx.notify(); }))
          .child(svg(icon(section.iconName)).size(13).flex_none().text_color(isOn ? t.accent : t.muted))
          .child(section.label);
      }));
  }

  // The groups of the shown section, each with a heading and a line on what it does.
  /** @param {import("./settings.js").Settings} settings */
  settingsGroups(settings) {
    switch (this.sectionId) {
      case "general": {
        /** @param {boolean} isOn */
        const isLastTab = (isOn) => isOn && !(settings.shouldShowGithub && settings.shouldShowLinear);
        return [this.settingsGroup({
          title: "Panel",
          description: "Which tabs and hints the panel shows.",
          children: [
            this.settingsToggle({
              id: "github", label: "Show the GitHub tab", isOn: settings.shouldShowGithub, isDisabled: isLastTab(settings.shouldShowGithub),
              onToggle: () => this.patchSettings({ shouldShowGithub: !settings.shouldShowGithub }),
            }),
            this.settingsToggle({
              id: "linear", label: "Show the Linear tab", isOn: settings.shouldShowLinear, isDisabled: isLastTab(settings.shouldShowLinear),
              onToggle: () => this.patchSettings({ shouldShowLinear: !settings.shouldShowLinear }),
            }),
            this.settingsToggle({ id: "hints", label: "Show key hints", isOn: settings.shouldShowKeyHints, onToggle: () => this.patchSettings({ shouldShowKeyHints: !settings.shouldShowKeyHints }) }),
          ],
        }), this.settingsGroup({
          title: "Suggested setup",
          description: "The gh44 skills from gh44-brain: plan, implement and review tickets and PRs, one skill per step.",
          children: this.gh44SetupRows(settings),
        }), this.settingsGroup({
          title: "Theme",
          description: "gh44-dark and gh44-light from gh44-theme. Run install.sh again for the gh44 code colors in Files.",
          children: this.gh44ThemeRows(),
        })];
      }
      case "github":
        return this.skillGroups({ ...SKILL_TABS[0], skills: settings.skills });
      case "linear":
        return [
          this.settingsGroup({ title: "API key", description: "Your personal Linear key. It stays on this machine, readable only by you.", children: this.linearAccountRows() }),
          ...this.skillGroups({ ...SKILL_TABS[1], skills: settings.skills }),
          this.settingsGroup({ title: "Where runs go", description: "Where a ticket's skill runs when the ticket has no worktree yet.", children: this.whereToRunRows(settings) }),
        ];
      default: {
        /** @type {never} */
        const unknownSection = this.sectionId;
        return unknownSection;
      }
    }
  }

  // Clones and installs gh44-theme or gh44-brain, then checks again what is installed.
  /** @param {{ cx: import("gpui-kit").Context, repo: Gh44Repo }} params */
  handleInstall({ cx, repo }) {
    if (this.installing.has(repo)) return;
    this.installing.add(repo);
    cx.notify();
    const { name, install } = GH44_REPOS[repo];
    cx.spawn(async (cx) => {
      const r = await install();
      this.installing.delete(repo);
      if (r.status === "success") {
        notify({ title: `${name} installed`, level: "info" });
        this.loadSkillList(cx);
      } else {
        notify({ title: `Could not install ${name}`, body: r.message || INSTALL_ERRORS[r.reason], level: "warning" });
      }
      cx.notify();
    });
  }

  // "Install gh44-…", with a spinner while it runs.
  /** @param {Gh44Repo} repo */
  installButton(repo) {
    const t = theme();
    const isInstalling = this.installing.has(repo);
    return h_flex().id(`${repo}-install`).h(30).px(10).gap(6).items_center().flex_none().self_start().rounded(6).border(1).border_color(t.accent)
      .text_size(12).text_color(isInstalling ? t.muted : t.foreground)
      .when(isInstalling, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900)))
      .when(!isInstalling, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.handleInstall({ cx, repo })))
      .child(isInstalling ? `Installing ${GH44_REPOS[repo].name}…` : `Install ${GH44_REPOS[repo].name}`);
  }

  // Installed, or a button that installs gh44-theme.
  gh44ThemeRows() {
    const t = theme();
    if (this.session.hasGh44Theme === null) return [];
    if (this.session.hasGh44Theme) {
      return [h_flex().gap(6).items_center().text_size(12).text_color(t.muted)
        .child(svg(icon("check")).size(12).text_color(palette(t).success))
        .child("Installed")];
    }
    return [this.installButton("theme")];
  }

  // A preview of the gh44 skills per tab (dim when not installed) and a button that applies them
  // to both tabs. Only the skills change: not the Linear key, the toggles or where runs go.
  /** @param {import("./settings.js").Settings} settings */
  gh44SetupRows(settings) {
    const t = theme();
    const installedSkills = this.session.installedSkills;
    const setup = getGh44Setup();
    const isInUse = isUsingGh44Setup({ skills: settings.skills });
    const count = installedSkills ? countInstalledSkills({ skills: setup, installedSkills }) : null;
    const hasMissing = count !== null && count.installed < count.total;
    /** @param {{ tab: "github" | "linear", name: string }} params */
    const skillChip = ({ tab, name }) => {
      const isInstalled = !installedSkills || installedSkills.includes(name);
      return div().id(`gh44-setup-${tab}-${name}`).h(20).px(6).flex().items_center().rounded(5).bg(t.raised).text_size(11)
        .text_color(isInstalled ? t.foreground : t.dim).when(!isInstalled, (el) => el.opacity(0.6).tooltip(`${name} is not installed`))
        .child(shortSkill(name));
    };
    const preview = v_flex().flex_none().p(10).gap(8).rounded(8).border(1).border_color(t.border)
      .children(SECTIONS.filter((s) => s.id !== "general").map((section) => {
        const tab = section.id === "github" ? "github" : "linear";
        return h_flex().gap(8).items_start()
          .child(h_flex().w(64).h(20).flex_none().gap(5).items_center().text_size(11.5).text_color(t.muted)
            .child(svg(icon(section.iconName)).size(12).flex_none())
            .child(section.label))
          .child(h_flex().flex_1().min_w(0).flex_wrap().gap(4).children(setup[tab].list.map((e) => skillChip({ tab, name: e.name }))));
      }));
    const button = hasMissing
      ? this.installButton("brain")
      : isInUse
      ? h_flex().id("gh44-setup-use").h(30).px(10).gap(6).items_center().flex_none().rounded(6).border(1).border_color(t.border)
        .text_size(12).text_color(t.muted)
        .child(svg(icon("check")).size(12).text_color(palette(t).success))
        .child("In use")
      : h_flex().id("gh44-setup-use").h(30).px(10).items_center().flex_none().rounded(6).border(1).border_color(t.accent)
        .text_size(12).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.patchSettings({ skills: getGh44Setup() }); cx.notify(); })
        .child("Use these skills");
    return [
      h_flex().id("gh44-brain-link").gap(4).items_center().text_size(11.5).text_color(t.accent).cursor_pointer()
        .on_click((_e, cx) => cx.open_url(GH44_BRAIN_URL))
        .child("About gh44-brain"),
      preview,
      h_flex().gap(10).items_center()
        .child(button)
        .when(count !== null, (el) => el.child(div().text_size(11.5).text_color(hasMissing ? palette(t).warning : t.dim)
          .child(`${count?.installed} of ${count?.total} installed`))),
      ...(hasMissing ? [div().text_size(11.5).text_color(t.dim).child("Rows skip missing skills and show \"open\" until they are installed.")] : []),
    ];
  }

  // "Where runs go": one choice; review skills never ask either way.
  /** @param {import("./settings.js").Settings} settings */
  whereToRunRows(settings) {
    return WHERE_TO_RUN_OPTIONS.map((o) => this.settingsChoice({
      id: `where-${o.id}`, label: o.label, isOn: settings.whereToRun === o.id,
      onPick: () => this.patchSettings({ whereToRun: o.id }),
    }));
  }

  // A tab's "Skills" and "Default for each row" groups.
  /** @param {{ tab: "github" | "linear", situations: { id: import("./settings.js").Situation, label: string }[], skills: import("./settings.js").Skills }} params */
  skillGroups({ tab, situations, skills }) {
    return [
      this.settingsGroup({ title: "Skills", description: "What the ▾ menu on a row offers, and the key that starts each one.", children: this.skillListRows({ tab, skills }) }),
      this.settingsGroup({
        title: "Default for each row",
        description: "The skill a row's main button runs. No skill: the button opens the PR or ticket.",
        children: situations.flatMap((situation) => this.defaultPickerRows({ tab, situation, skills })),
      }),
    ];
  }

  // A tab's skills (name, key letter, remove), then Add skill.
  /** @param {{ tab: "github" | "linear", skills: import("./settings.js").Skills }} params */
  skillListRows({ tab, skills }) {
    const t = theme();
    const list = skills[tab].list;
    /** @param {string} skill */
    const isRunnable = (skill) => canRun({ skill, installedSkills: this.session.installedSkills });
    const skillRows = list.map((entry) => h_flex().id(`skill-${tab}-${entry.name}`).h(28).px(6).gap(8).items_center().rounded(6).hover((s) => s.bg(t.surface))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(isRunnable(entry.name) ? t.foreground : t.dim).child(entry.name))
      .when(!isRunnable(entry.name), (el) => el.child(div().flex_none().text_size(11.5).text_color(palette(t).warning).child("not installed")))
      .child(this.skillKeyCell({ tab, entry }))
      .child(div().id(`skill-remove-${tab}-${entry.name}`).size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
        .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Remove this skill")
        .on_click((_e, cx) => { this.saveSkills({ tab, skills: removeSkill({ skills, tab, skill: entry.name }) }); cx.notify(); })
        .child(svg(icon("x")).size(12))));
    const empty = list.length === 0 ? [div().px(6).text_size(12).text_color(t.dim).child("No skills yet.")] : [];
    return [...empty, ...skillRows, this.addSkillRow({ tab, list })];
  }

  // The key letter: a small box; clicking it takes the next letter typed.
  /** @param {{ tab: "github" | "linear", entry: { name: string, key: string | null } }} params */
  skillKeyCell({ tab, entry }) {
    const t = theme();
    const isEditing = this.keyEditing?.tab === tab && this.keyEditing.skill === entry.name;
    if (isEditing) {
      return h_flex().flex_none().gap(4).items_center()
        .child(div().w(26).h(22).px(4).flex().items_center().rounded(5).border(1).border_color(t.accent).bg(t.background)
          .child(Input.new(this.skillKeyInput).w_full().text_size(12).font_family(MONO_FONT)))
        .child(div().id(`skill-key-clear-${tab}-${entry.name}`).h(22).px(6).flex().items_center().rounded(5).cursor_pointer().text_size(11)
          .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => {
            this.saveSkills({ tab, skills: setSkillKey({ skills: this.getSettings().skills, tab, skill: entry.name, key: null }) });
            this.keyEditing = null;
            this.focusPanel();
            cx.notify();
          })
          .child("No key"));
    }
    return div().id(`skill-key-${tab}-${entry.name}`).w(26).h(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
      .border(1).border_color(t.border).font_family(MONO_FONT).text_size(12).text_color(entry.key ? t.foreground : t.dim)
      .hover((s) => s.bg(t.hover)).tooltip(entry.key ? `Key ${entry.key}: click, then type a new letter` : "Click, then type a key letter")
      .on_click((_e, cx) => {
        this.keyEditing = { tab, skill: entry.name };
        this.skillKeyInput.set_value("");
        this.skillKeyInput.focus();
        cx.notify();
      })
      .child(entry.key ?? "–");
  }

  // "+ Add skill", or the field with the installed skills not in the list yet.
  /** @param {{ tab: "github" | "linear", list: { name: string }[] }} params */
  addSkillRow({ tab, list }) {
    const t = theme();
    if (this.addingTab !== tab) {
      return h_flex().id(`skill-add-${tab}`).h(28).px(6).gap(6).items_center().rounded(6).cursor_pointer().text_size(12.5)
        .text_color(t.accent).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          this.addingTab = tab;
          this.addSkillInput.set_value("");
          this.addSkillInput.focus();
          cx.notify();
        })
        .child("+ Add skill");
    }
    const typed = this.addSkillInput.value().trim().toLowerCase();
    const names = new Set(list.map((e) => e.name));
    const suggestions = (this.session.installedSkills ?? []).filter((name) => !names.has(name) && name.toLowerCase().includes(typed)).slice(0, SKILL_SUGGESTIONS);
    return v_flex().flex_none().gap(4)
      .child(h_flex().h(30).px(8).gap(6).items_center().rounded(6).border(1).border_color(t.accent).bg(t.background)
        .child(Input.new(this.addSkillInput).flex_1().text_size(12).text_color(t.foreground))
        .child(div().id(`skill-add-cancel-${tab}`).px(4).text_size(11.5).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { this.addingTab = null; this.focusPanel(); cx.notify(); })
          .child("Cancel")))
      .children(suggestions.map((name) => h_flex().id(`skill-suggest-${tab}-${name}`).h(26).px(8).gap(6).items_center().rounded(6).cursor_pointer()
        .text_size(12).text_color(t.foreground).hover((s) => s.bg(t.hover))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => this.handleAddSkill({ skill: name, cx }))
        .child(div().text_color(t.accent).child("+"))
        .child(name)))
      .when(suggestions.length === 0, (el) => el.child(div().px(8).text_size(11.5).text_color(t.dim)
        .child(typed ? "↵ adds it by this name" : "No more skills in ~/.claude/skills. Type a name.")))
      .when(this.isAddSkillRefused, (el) => el.child(div().px(8).text_size(11.5).text_color(palette(t).danger)
        .child("A skill name is one word: letters, digits, _ : . or -")));
  }

  // A kind of row and the skill it runs; clicking opens the choices below it.
  /** @param {{ tab: "github" | "linear", situation: { id: import("./settings.js").Situation, label: string }, skills: import("./settings.js").Skills }} params */
  defaultPickerRows({ tab, situation, skills }) {
    const t = theme();
    const pickerId = `${tab}:${situation.id}`;
    const isOpen = this.openPicker === pickerId;
    const current = getDefaultSkill({ skills, tab, situation: situation.id });
    const header = h_flex().id(`default-${pickerId}`).h(28).px(6).gap(8).items_center().rounded(6).cursor_pointer()
      .text_size(12.5).bg(isOpen ? t.hover : t.background).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.openPicker = isOpen ? null : pickerId; cx.notify(); })
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(situation.label))
      .child(div().text_color(current ? t.foreground : t.dim).child(current ? shortSkill(current) : "open"))
      .child(svg(icon(isOpen ? "chevron-up" : "chevron")).size(12).text_color(t.muted));
    if (!isOpen) return [header];
    /** @param {string | null} skill @returns {(e: unknown, cx: import("gpui-kit").Context) => void} */
    const choose = (skill) => (_e, cx) => {
      this.saveSkills({ tab, skills: setDefaultSkill({ skills, tab, situation: situation.id, skill }) });
      this.openPicker = null;
      cx.notify();
    };
    /** @param {{ id: string, label: string, isChecked: boolean, onClick: (e: unknown, cx: import("gpui-kit").Context) => void }} params */
    const option = ({ id, label, isChecked, onClick }) => h_flex().id(`default-${pickerId}-${id}`).h(26).pl(18).pr(6).gap(8).items_center().rounded(6).cursor_pointer()
      .text_size(12).text_color(t.foreground).hover((s) => s.bg(t.hover)).on_click(onClick)
      .child(svg(icon(isChecked ? "checkbox-checked" : "checkbox")).size(13).flex_none().text_color(isChecked ? t.accent : t.dim))
      .child(label);
    return [
      header,
      ...skills[tab].list.map((e) => option({ id: e.name, label: e.name, isChecked: e.name === current, onClick: choose(e.name) })),
      option({ id: "none", label: "No skill: the button opens it", isChecked: current === null, onClick: choose(null) }),
    ];
  }

  /** @param {{ title: string, description: string, children: ReturnType<typeof h_flex>[] }} params */
  settingsGroup({ title, description, children }) {
    const t = theme();
    return v_flex().flex_none().gap(6)
      .child(v_flex().gap(2)
        .child(div().text_size(11.5).font_semibold().text_color(t.foreground).child(title))
        .child(div().text_size(11.5).text_color(t.dim).child(description)))
      .children(children);
  }

  // A checkbox row. Disabled (the last shown tab): dimmed, with "Keep one tab" on hover.
  /** @param {{ id: string, label: string, isOn: boolean, isDisabled?: boolean, onToggle: () => void }} params */
  settingsToggle({ id, label, isOn, isDisabled = false, onToggle }) {
    const t = theme();
    return h_flex().id(`settings-toggle-${id}`).h(28).px(6).gap(8).items_center().rounded(6)
      .text_size(12.5).text_color(isDisabled ? t.muted : t.foreground)
      .when(isDisabled, (el) => el.tooltip("Keep one tab"))
      .when(!isDisabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { onToggle(); cx.notify(); }))
      .child(svg(icon(isOn ? "checkbox-checked" : "checkbox")).size(14).flex_none().text_color(isOn && !isDisabled ? t.accent : t.dim))
      .child(label);
  }

  // One option of a single choice: a filled dot when picked.
  /** @param {{ id: string, label: string, isOn: boolean, onPick: () => void }} params */
  settingsChoice({ id, label, isOn, onPick }) {
    const t = theme();
    return h_flex().id(`settings-choice-${id}`).h(28).px(6).gap(8).items_center().rounded(6).cursor_pointer()
      .text_size(12.5).text_color(t.foreground).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { onPick(); cx.notify(); })
      .child(div().size(14).flex_none().flex().items_center().justify_center().rounded(7).border(1.5).border_color(isOn ? t.accent : t.dim)
        .when(isOn, (el) => el.child(div().size(6).rounded(3).bg(t.accent))))
      .child(label);
  }
}

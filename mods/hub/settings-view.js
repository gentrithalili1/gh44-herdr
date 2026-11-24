// The ⚙ settings view: General · GitHub · Linear · On-call, shown in the Omnia panel in place of its list.
// It owns its inputs and edit state; the panel hands it the settings, the session and what to
// do when the Linear key changes.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, notify } from "herdr";
import { icon, palette, radioMark, stop, MONO_FONT, GUTTER } from "./ui.js";
import { loadLinearViewer, saveLinearKey, removeLinearKey } from "./linear.js";
import { loadInstalledSkills, uninstallGh44Omnia } from "./actions.js";
import { openGh44Dialog } from "./gh44-dialog.js";
import { CaseEditor } from "./case-editor.js";
import { OncallSettings } from "./oncall/settings.js";
import {
  addSkill, removeSkill, setSkillKey, isValidSkillName, GITHUB_SITUATIONS, LINEAR_SITUATIONS, ONCALL_SITUATIONS, canRunEntry, shortRepo,
  ASK_ACTION, ASK_DESCRIPTION, CONTINUE_ACTION, CONTINUE_DESCRIPTION,
} from "./settings.js";

/** @typedef {"general" | "github" | "linear" | "oncall"} SectionId */
/** @typedef {"linearKey" | "skillKey" | "addSkill" | import("./oncall/settings.js").OncallInputId} InputId */
/**
 * @typedef {{
 *   login: string | null,
 *   linearAccount: { status: "idle" | "checking" | "connected" | "missing" | "failed", name?: string, message?: string },
 *   installedSkills: string[] | null,
 *   repo: import("./settings.js").RepoSkills,
 * }} Session
 */

/** @type {{ tab: "github" | "linear" | "oncall", situations: { id: import("./settings.js").Situation, label: string }[] }[]} */
const SKILL_TABS = [
  { tab: "github", situations: GITHUB_SITUATIONS },
  { tab: "linear", situations: LINEAR_SITUATIONS },
  { tab: "oncall", situations: ONCALL_SITUATIONS },
];
/** @type {{ id: SectionId, label: string, iconName: string }[]} */
const SECTIONS = [
  { id: "general", label: "General", iconName: "settings" },
  { id: "github", label: "GitHub", iconName: "github" },
  { id: "linear", label: "Linear", iconName: "linear" },
  { id: "oncall", label: "On-call", iconName: "oncall" },
];
/** @type {{ id: import("./settings.js").WhereToRun, label: string }[]} */
const WHERE_TO_RUN_OPTIONS = [
  { id: "ask", label: "Ask every time" },
  { id: "worktree", label: "Always a new worktree" },
  { id: "here", label: "Always this space" },
];
// Installed skills offered under the Add skill field.
const SKILL_SUGGESTIONS = 6;
const LINEAR_API_KEYS_URL = "https://linear.app/settings/account/security";
const SWITCH_HEIGHT = 32;
// How long "Click again to uninstall" waits for the second click.
const UNINSTALL_CONFIRM_MS = 5_000;
/** @type {Record<"notLinked" | "start", string>} */
const UNINSTALL_ERRORS = {
  notLinked: "The hub mod is not linked from gh44-omnia, so its uninstall.sh is not known.",
  start: "uninstall.sh did not start.",
};

// No Linear key, Linear turned it down, or it is being checked. A key that could not be checked
// (offline) or was never checked (Linear tab hidden) keeps the rest shown.
/** @param {Session["linearAccount"]["status"]} status */
const isLinearKeyPending = (status) => status === "missing" || status === "checking";

// An Add skill suggestion from ~/.claude/skills: no repo.
/** @param {string} name @returns {{ name: string, repo: string | null }} */
const toInstalledCandidate = (name) => ({ name, repo: null });

export class SettingsView {
  /**
   * InputState needs a live host call, so this runs in the panel's init.
   * @param {{
   *   session: Session,
   *   getSettings: () => import("./settings.js").Settings,
   *   patchSettings: (patch: Record<string, unknown>) => void,
   *   saveSkills: (params: { tab: "github" | "linear" | "oncall", skills: import("./settings.js").Skills }) => void,
   *   onLinearKeyChange: (cx: import("gpui-kit").Context) => void,
   *   reloadRepoSkills: (cx: import("gpui-kit").Context) => void,
   *   focusPanel: () => void,
   *   openSelect: (params: { store: string, title: string, value: string | string[], options: { value: string, label: string }[], isMulti?: boolean, anchor?: import("./ui.js").Anchor | null }) => void,
   * }} host
   */
  constructor({ session, getSettings, patchSettings, saveSkills, onLinearKeyChange, reloadRepoSkills, focusPanel, openSelect }) {
    this.session = session;
    this.getSettings = getSettings;
    this.patchSettings = patchSettings;
    this.saveSkills = saveSkills;
    this.onLinearKeyChange = onLinearKeyChange;
    this.reloadRepoSkills = reloadRepoSkills;
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
    // Uninstall takes a second click within UNINSTALL_CONFIRM_MS; confirmedAt tells one click from the next.
    /** @type {{ status: "idle" | "confirming" | "starting", confirmedAt?: number }} */
    this.uninstall = { status: "idle" };
    this.linearKeyInput = InputState.new({ placeholder: "lin_api_…" });
    this.linearKeyInput.set_masked(true);
    this.linearKeyInput.on("submit", (_e, cx) => this.handleSaveLinearKey(cx));
    this.trackFocus({ input: this.linearKeyInput, id: "linearKey" });
    // The skills editor: one key letter field and one Add skill field, moved to the row being edited.
    /** @type {{ tab: "github" | "linear" | "oncall", skill: string } | null} */
    this.keyEditing = null;
    /** @type {"github" | "linear" | "oncall" | null} */
    this.addingTab = null;
    this.caseEditor = new CaseEditor({ saveSkills });
    this.skillKeyInput = InputState.new({ placeholder: "" });
    this.skillKeyInput.on("change", (_e, cx) => this.handleSkillKeyChange(cx));
    this.trackFocus({ input: this.skillKeyInput, id: "skillKey" });
    // The typed name was turned down: it is not one word.
    this.isAddSkillRefused = false;
    this.addSkillInput = InputState.new({ placeholder: "Skill name, as in /name" });
    this.addSkillInput.on("change", (_e, cx) => { this.isAddSkillRefused = false; cx.notify(); });
    this.addSkillInput.on("submit", (_e, cx) => this.handleAddSkill({ skill: this.addSkillInput.value(), repo: this.getTypedSkillRepo(), cx }));
    this.trackFocus({ input: this.addSkillInput, id: "addSkill" });
    this.oncall = new OncallSettings({
      trackFocus: (params) => this.trackFocus(params),
      isFocused: (id) => this.focusedInput === id,
      settingsGroup: (params) => this.settingsGroup(params),
      settingsToggle: (params) => this.settingsToggle(params),
      settingsChoice: (params) => this.settingsChoice(params),
      openSelect,
      skillGroups: () => this.skillGroups({ ...SKILL_TABS[2], skills: this.getSettings().skills }),
    });
  }

  isOncallShown() {
    return this.isOpen && this.sectionId === "oncall";
  }

  // Which of the view's inputs has the keyboard, so the panel's own keys stay off while typing.
  /** @param {{ input: import("gpui-base").InputState | import("gpui-base").TextareaState, id: InputId }} params */
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
  /** @param {{ cx: import("gpui-kit").Context, section?: SectionId }} params */
  open({ cx, section }) {
    this.isOpen = true;
    if (section) this.sectionId = section;
    if (this.sectionId === "oncall") this.oncall.open(cx);
    this.loadSkillList(cx);
    this.reloadRepoSkills(cx);
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
    this.caseEditor.collapse();
    this.focusPanel();
  }

  // A skill added to ~/.claude/skills shows up the next time the settings open.
  /** @param {import("gpui-kit").Context} cx */
  loadSkillList(cx) {
    cx.spawn(async (cx) => {
      this.session.installedSkills = (await loadInstalledSkills()) ?? this.session.installedSkills;
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

  // A typed name only the focused repo has is added as that repo's skill.
  getTypedSkillRepo() {
    const name = this.addSkillInput.value().trim();
    const { repo, installedSkills } = this.session;
    const isRepoOnly = Boolean(repo.skills?.includes(name)) && !installedSkills?.includes(name);
    return isRepoOnly ? repo.name : null;
  }

  /** @param {{ skill: string, repo: string | null, cx: import("gpui-kit").Context }} params */
  handleAddSkill({ skill, repo, cx }) {
    const name = skill.trim();
    if (!this.addingTab || !name) return;
    if (!isValidSkillName(name)) {
      this.isAddSkillRefused = true;
      cx.notify();
      return;
    }
    this.saveSkills({ tab: this.addingTab, skills: addSkill({ skills: this.getSettings().skills, tab: this.addingTab, skill: name, repo }) });
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

  // The General · GitHub · Linear switch, then the picked section.
  // It takes the list's place until Esc or ⚙.
  render() {
    const t = theme();
    const settings = this.getSettings();
    // A case entry being dragged drops on release over a case row (it handles it first);
    // a release anywhere else cancels the drag.
    return v_flex().flex_1().min_h(0)
      .on_mouse_up("left", (_e, cx) => this.caseEditor.cancelDrag(cx))
      .child(div().flex_none().px(GUTTER).pt(12).pb(12).border_b(1).border_color(t.border).child(this.sectionSwitch()))
      .child(v_flex().id("settings-list").flex_1().min_h(0).overflow_y_scrollbar().px(GUTTER).pt(14).pb(14).gap(18)
        .children(this.settingsGroups(settings)))
      // General keeps Uninstall pinned at the bottom, below the scrolling groups.
      .when(this.sectionId === "general", (el) => el.child(div().flex_none().px(GUTTER).pt(14).pb(14).border_t(1).border_color(t.border)
        .child(this.settingsGroup({
          title: "Uninstall",
          description: "Removes the gh44-omnia layout, mods and themes, and puts your keys and settings back from their backup.",
          children: [this.uninstallButton()],
        }))));
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
            .on_click((_e, cx) => {
              this.sectionId = section.id;
              this.caseEditor.collapse();
              if (section.id === "oncall") this.oncall.open(cx);
              cx.notify();
            }))
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
            this.settingsToggle({ id: "oncall", label: "Show the On-call tab", isOn: settings.shouldShowOncall, onToggle: () => this.patchSettings({ shouldShowOncall: !settings.shouldShowOncall }) }),
            this.settingsToggle({ id: "hints", label: "Show key hints", isOn: settings.shouldShowKeyHints, onToggle: () => this.patchSettings({ shouldShowKeyHints: !settings.shouldShowKeyHints }) }),
          ],
        }), this.gh44Row()];
      }
      case "github":
        return this.skillGroups({ ...SKILL_TABS[0], skills: settings.skills });
      case "linear":
        return [
          this.settingsGroup({ title: "API key", description: "Your personal Linear key. It stays on this machine, readable only by you.", children: this.linearAccountRows() }),
          // Without a working key (or while it is checked) only the key shows.
          ...(isLinearKeyPending(this.session.linearAccount.status) ? [] : [
            ...this.skillGroups({ ...SKILL_TABS[1], skills: settings.skills }),
            this.settingsGroup({ title: "Where runs go", description: "Where a ticket's skill runs when the ticket has no worktree yet.", children: this.whereToRunRows(settings) }),
          ]),
        ];
      case "oncall":
        return this.oncall.groups();
      default: {
        /** @type {never} */
        const unknownSection = this.sectionId;
        return unknownSection;
      }
    }
  }

  // gh44 extras: a line on what they are and View, which opens the gh44 dialog.
  gh44Row() {
    const t = theme();
    return h_flex().flex_none().gap(10).items_center()
      .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.dim).child("Optional gh44 skills and theme."))
      .child(h_flex().id("gh44-view").h(24).px(10).flex_none().items_center().rounded(6).border(1).border_color(t.border)
        .text_size(12).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click(() => openGh44Dialog())
        .child("View"));
  }

  // First click: asks for a second one within UNINSTALL_CONFIRM_MS. Second click: runs uninstall.sh.
  /** @param {import("gpui-kit").Context} cx */
  handleUninstall(cx) {
    const status = this.uninstall.status;
    switch (status) {
      case "idle": {
        const confirmedAt = Date.now();
        this.uninstall = { status: "confirming", confirmedAt };
        cx.spawn(async (cx) => {
          await cx.sleep(UNINSTALL_CONFIRM_MS);
          if (this.uninstall.confirmedAt !== confirmedAt || this.uninstall.status !== "confirming") return;
          this.uninstall = { status: "idle" };
          cx.notify();
        });
        break;
      }
      case "confirming":
        this.uninstall = { status: "starting" };
        cx.spawn(async (cx) => {
          const r = await uninstallGh44Omnia();
          this.uninstall = { status: "idle" };
          if (r.status === "started") notify({ title: "Uninstalling gh44-omnia", body: "Herdr switches to its main layout.", level: "info" });
          else notify({ title: "Could not uninstall gh44-omnia", body: r.message || UNINSTALL_ERRORS[r.reason], level: "warning" });
          cx.notify();
        });
        break;
      case "starting":
        return;
      default: {
        /** @type {never} */
        const unknownStatus = status;
        return unknownStatus;
      }
    }
    cx.notify();
  }

  // A red button; its label asks for the second click while it waits for one.
  uninstallButton() {
    const t = theme();
    const danger = palette(t).danger;
    const status = this.uninstall.status;
    const label = status === "confirming" ? "Click again to uninstall" : status === "starting" ? "Uninstalling…" : "Uninstall gh44-omnia";
    return h_flex().id("gh44-uninstall").h(28).px(12).flex_none().self_start().items_center().rounded(6).border(1).border_color(danger)
      .text_size(12).text_color(danger).font_medium()
      .when(status === "confirming", (el) => el.bg(t.hover))
      .when(status !== "starting", (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.handleUninstall(cx)))
      .child(label);
  }

  // "Where runs go": one choice; review skills never ask either way.
  /** @param {import("./settings.js").Settings} settings */
  whereToRunRows(settings) {
    return WHERE_TO_RUN_OPTIONS.map((o) => this.settingsChoice({
      id: `where-${o.id}`, label: o.label, isOn: settings.whereToRun === o.id,
      onPick: () => this.patchSettings({ whereToRun: o.id }),
    }));
  }

  // A tab's "Actions" and "By case" groups.
  /** @param {{ tab: "github" | "linear" | "oncall", situations: { id: import("./settings.js").Situation, label: string }[], skills: import("./settings.js").Skills }} params */
  skillGroups({ tab, situations, skills }) {
    return [
      this.settingsGroup({ title: "Actions", description: "What the ▾ menu on a row offers, and the key that starts each one.", children: this.skillListRows({ tab, skills }) }),
      this.settingsGroup({
        title: "By case",
        description: "What each kind of PR or ticket runs and shows.",
        children: this.caseEditor.rows({ tab, situations, skills }),
      }),
    ];
  }

  // A tab's actions (name, key letter, remove), then Add skill. Ask is built in: no remove.
  // A repo skill carries its repo's name; rows offer it only while that repo is focused.
  /** @param {{ tab: "github" | "linear" | "oncall", skills: import("./settings.js").Skills }} params */
  skillListRows({ tab, skills }) {
    const t = theme();
    const list = skills[tab].list;
    const { installedSkills, repo } = this.session;
    const skillRows = list.map((entry) => {
      const isAsk = entry.name === ASK_ACTION || entry.name === CONTINUE_ACTION;
      const isOtherRepo = Boolean(entry.repo) && entry.repo !== repo.name;
      const isRunnable = isOtherRepo || canRunEntry({ entry, installedSkills, repo });
      return h_flex().id(`skill-${tab}-${entry.name}`).h(28).px(6).gap(8).items_center().rounded(6).hover((s) => s.bg(t.surface))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(isRunnable && !isOtherRepo ? t.foreground : t.dim).child(entry.name))
        .when(Boolean(entry.repo), (el) => el.child(this.repoTag({ repo: entry.repo ?? "", isCurrent: !isOtherRepo })))
        .when(!isRunnable, (el) => el.child(div().flex_none().text_size(11.5).text_color(palette(t).warning).child(entry.repo ? "not in repo" : "not installed")))
        .when(isAsk, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).tooltip(entry.name === ASK_ACTION ? ASK_DESCRIPTION : CONTINUE_DESCRIPTION).child("built in")))
        .child(this.skillKeyCell({ tab, entry }))
        .child(isAsk ? div().size(22).flex_none() : this.removeSkillButton({ tab, skills, skill: entry.name }));
    });
    return [...skillRows, this.addSkillRow({ tab, list })];
  }

  // The repo a skill belongs to; dim when it is not the focused one.
  /** @param {{ repo: string, isCurrent: boolean }} params */
  repoTag({ repo, isCurrent }) {
    const t = theme();
    return div().flex_none().px(6).h(18).flex().items_center().rounded(4).border(1).border_color(t.border).text_size(11)
      .text_color(isCurrent ? t.muted : t.dim).tooltip(`Only in ${repo}`)
      .child(shortRepo(repo));
  }

  /** @param {{ tab: "github" | "linear" | "oncall", skills: import("./settings.js").Skills, skill: string }} params */
  removeSkillButton({ tab, skills, skill }) {
    const t = theme();
    return div().id(`skill-remove-${tab}-${skill}`).size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
      .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Remove this skill")
      .on_click((_e, cx) => { this.saveSkills({ tab, skills: removeSkill({ skills, tab, skill }) }); cx.notify(); })
      .child(svg(icon("x")).size(12));
  }

  // The key letter: a small box; clicking it takes the next letter typed.
  /** @param {{ tab: "github" | "linear" | "oncall", entry: { name: string, key: string | null } }} params */
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

  // "+ Add skill", or the field with the focused repo's skills and the installed ones not in the list yet.
  /** @param {{ tab: "github" | "linear" | "oncall", list: { name: string }[] }} params */
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
    const { repo, installedSkills } = this.session;
    /** @type {{ name: string, repo: string | null }[]} */
    const candidates = [
      ...(repo.name ? (repo.skills ?? []).map((name) => ({ name, repo: repo.name })) : []),
      ...(installedSkills ?? []).filter((name) => !repo.skills?.includes(name)).map(toInstalledCandidate),
    ];
    const suggestions = candidates.filter((c) => !names.has(c.name) && c.name.toLowerCase().includes(typed)).slice(0, SKILL_SUGGESTIONS);
    return v_flex().flex_none().gap(4)
      .child(h_flex().h(30).px(8).gap(6).items_center().rounded(6).border(1).border_color(t.accent).bg(t.background)
        .child(Input.new(this.addSkillInput).flex_1().text_size(12).text_color(t.foreground))
        .child(div().id(`skill-add-cancel-${tab}`).px(4).text_size(11.5).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { this.addingTab = null; this.focusPanel(); cx.notify(); })
          .child("Cancel")))
      .children(suggestions.map((c) => h_flex().id(`skill-suggest-${tab}-${c.name}`).h(26).px(8).gap(6).items_center().rounded(6).cursor_pointer()
        .text_size(12).text_color(t.foreground).hover((s) => s.bg(t.hover))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => this.handleAddSkill({ skill: c.name, repo: c.repo, cx }))
        .child(div().text_color(t.accent).child("+"))
        .child(div().flex_1().min_w(0).truncate().child(c.name))
        .when(Boolean(c.repo), (el) => el.child(this.repoTag({ repo: c.repo ?? "", isCurrent: true })))))
      .when(suggestions.length === 0, (el) => el.child(div().px(8).text_size(11.5).text_color(t.dim)
        .child(typed ? "↵ adds it by this name" : "No more skills in ~/.claude/skills or this repo's .claude. Type a name.")))
      .when(this.isAddSkillRefused, (el) => el.child(div().px(8).text_size(11.5).text_color(palette(t).danger)
        .child("A skill name is one word: letters, digits, _ : . or -")));
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
  /** @param {{ id: string, label: string, isOn: boolean, isDisabled?: boolean, onToggle: (cx: import("gpui-kit").Context) => void }} params */
  settingsToggle({ id, label, isOn, isDisabled = false, onToggle }) {
    const t = theme();
    return h_flex().id(`settings-toggle-${id}`).h(28).px(6).gap(8).items_center().rounded(6)
      .text_size(12.5).text_color(isDisabled ? t.muted : t.foreground)
      .when(isDisabled, (el) => el.tooltip("Keep one tab"))
      .when(!isDisabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { onToggle(cx); cx.notify(); }))
      .child(svg(icon(isOn ? "checkbox-checked" : "checkbox")).size(14).flex_none().text_color(isOn && !isDisabled ? t.accent : t.dim))
      .child(label);
  }

  // One option of a single choice: a filled dot when picked.
  /** @param {{ id: string, label: string, isOn: boolean, onPick: (cx: import("gpui-kit").Context) => void }} params */
  settingsChoice({ id, label, isOn, onPick }) {
    const t = theme();
    return h_flex().id(`settings-choice-${id}`).h(28).px(6).gap(8).items_center().rounded(6).cursor_pointer()
      .text_size(12.5).text_color(t.foreground).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { onPick(cx); cx.notify(); })
      .child(radioMark({ t, isOn }))
      .child(label);
  }
}

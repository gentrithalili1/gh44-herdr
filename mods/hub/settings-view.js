// The ⚙ settings view: General · GitHub · Linear · On-call, shown in the Omnia panel in place of its list.
// Groups are bays of strips and control rows (controls.js). It owns its inputs and edit state; the
// panel hands it the settings, the session, what to do when the Linear key changes, and how to
// count a case's rows and open its editor.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, notify, shared, setShared, run, layout } from "herdr";
import { icon, palette, stop, GUTTER } from "./ui.js";
import {
  bay, controlRow, toggleRow, radioRow, selectButton, getPickedText, button, statusLine, listTag, keyCell, keyCellEditing, fieldBox, linkLine, holderStrip,
} from "./controls.js";
import { loadLinearViewer, saveLinearKey, removeLinearKey } from "./data.js";
import { loadInstalledSkills, uninstallGh44Omnia } from "./actions.js";
import { Gh44Setup } from "./gh44-dialog.js";
import { caseStrips } from "./case-editor.js";
import { OncallSettings } from "./oncall/settings.js";
import { OMNIA_SIDEBAR_STORE, isOmniaSidebarOn, getSidebarLayout } from "./omnia-sidebar.js";
import {
  addSkill, removeSkill, setSkillKey, isValidSkillName, getSkillCandidates, GITHUB_SITUATIONS, LINEAR_SITUATIONS, ONCALL_SITUATIONS, canRunEntry, shortRepo,
  getLinkEntry, isLinkEntry, ASK_ACTION, ASK_DESCRIPTION, CONTINUE_ACTION, CONTINUE_DESCRIPTION, LINK_ENTRIES,
} from "./settings.js";

/** @typedef {"general" | "github" | "linear" | "oncall"} SectionId */
/** @typedef {"linearKey" | "skillKey" | "addSkill" | import("./oncall/settings.js").OncallInputId} InputId */
/** @typedef {"github" | "linear" | "oncall"} SkillTab */
/** @typedef {import("./settings.js").Situation} Situation */
/** @typedef {{ value: string, label: string }} SelectOption */
/**
 * @typedef {{
 *   login: string | null,
 *   linearAccount: { status: "idle" | "checking" | "connected" | "missing" | "failed", name?: string, message?: string },
 *   installedSkills: string[] | null,
 *   repo: import("./settings.js").RepoSkills,
 * }} Session
 */

/** @type {{ tab: SkillTab, situations: { id: Situation, label: string }[] }[]} */
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
/** @type {{ value: import("./settings.js").RowClick, label: string }[]} */
const ROW_CLICK_OPTIONS = [
  { value: "details", label: "Open details" },
  { value: "select", label: "Select" },
];
// Where a settings select leaves its pick; the view reads it back each tick.
const ROW_CLICK_SELECT = "hub.rowClickSelect";
const START_COLLAPSED_SELECT = "hub.startCollapsedSelect";
// Installed skills offered under the Add skill field.
const SKILL_SUGGESTIONS = 6;
const LINEAR_API_KEYS_URL = "https://linear.app/settings/account/security";
const SWITCH_HEIGHT = 32;
const LAST_TAB_HELP = "The last tab on can't be turned off";
// How long "Click again to uninstall" waits for the second click.
const UNINSTALL_CONFIRM_MS = 5_000;
/** @type {Record<"notLinked" | "start", string>} */
const UNINSTALL_ERRORS = {
  notLinked: "The hub mod is not linked from gh44-omnia, so its uninstall.sh is not known.",
  start: "uninstall.sh did not start.",
};

// Puts the other pair of mods in the sidebar blocks of the shown layout, and keeps the choice.
const handleOmniaSidebarToggle = () => {
  const isOmnia = !isOmniaSidebarOn(shared(OMNIA_SIDEBAR_STORE));
  const next = getSidebarLayout({ layout: layout(), isOmnia });
  if (next) run("layout.set", { layout: next });
  setShared(OMNIA_SIDEBAR_STORE, isOmnia);
};

// No Linear key, Linear turned it down, or it is being checked. A key that could not be checked
// (offline) or was never checked (Linear tab hidden) keeps the rest shown.
/** @param {Session["linearAccount"]["status"]} status */
const isLinearKeyPending = (status) => status === "missing" || status === "checking";

/** @param {{ a: string[], b: string[] }} params */
const isSameList = ({ a, b }) => a.length === b.length && a.every((value, i) => value === b[i]);

export class SettingsView {
  /**
   * InputState needs a live host call, so this runs in the panel's init.
   * @param {{
   *   session: Session,
   *   getSettings: () => import("./settings.js").Settings,
   *   patchSettings: (patch: Record<string, unknown>) => void,
   *   saveSkills: (params: { tab: SkillTab, skills: import("./settings.js").Skills }) => void,
   *   onLinearKeyChange: (cx: import("gpui-kit").Context) => void,
   *   reloadRepoSkills: (cx: import("gpui-kit").Context) => void,
   *   focusPanel: () => void,
   *   openSelect: (params: { store: string, title: string, value: string | string[], options: SelectOption[], isMulti?: boolean, anchor?: import("./ui.js").Anchor | null }) => void,
   *   openCaseEditor: (params: { tab: SkillTab, situation: Situation }) => void,
   *   getCaseMatches: (params: { tab: SkillTab, situation: Situation }) => { count: number, refs: string[] } | null,
   *   getGroupOptions: () => SelectOption[],
   * }} host
   */
  constructor({ session, getSettings, patchSettings, saveSkills, onLinearKeyChange, reloadRepoSkills, focusPanel, openSelect, openCaseEditor, getCaseMatches, getGroupOptions }) {
    this.session = session;
    this.getSettings = getSettings;
    this.patchSettings = patchSettings;
    this.saveSkills = saveSkills;
    this.onLinearKeyChange = onLinearKeyChange;
    this.reloadRepoSkills = reloadRepoSkills;
    this.focusPanel = focusPanel;
    this.openSelect = openSelect;
    this.openCaseEditor = openCaseEditor;
    this.getCaseMatches = getCaseMatches;
    this.getGroupOptions = getGroupOptions;
    // The selects opened from here: store -> how its pick is saved. Read back each tick.
    /** @type {Map<string, (value: unknown) => void>} */
    this.openSelects = new Map();
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
    this.gh44 = new Gh44Setup({ getSettings, patchSettings });
    this.linearKeyInput = InputState.new({ placeholder: "lin_api_…" });
    this.linearKeyInput.set_masked(true);
    this.linearKeyInput.on("submit", (_e, cx) => this.handleSaveLinearKey(cx));
    this.trackFocus({ input: this.linearKeyInput, id: "linearKey" });
    // The skills editor: one key letter field and one Add skill field, moved to the row being edited.
    /** @type {{ tab: SkillTab, skill: string } | null} */
    this.keyEditing = null;
    /** @type {SkillTab | null} */
    this.addingTab = null;
    this.skillKeyInput = InputState.new({ placeholder: "" });
    this.skillKeyInput.on("change", (_e, cx) => this.handleSkillKeyChange(cx));
    this.trackFocus({ input: this.skillKeyInput, id: "skillKey" });
    // The typed name was turned down: it is not one word.
    this.isAddSkillRefused = false;
    // Add a link… was picked: the field offers the link entries instead of skills.
    this.isPickingLink = false;
    this.addSkillInput = InputState.new({ placeholder: "Search skills, or type a name" });
    this.addSkillInput.on("change", (_e, cx) => { this.isAddSkillRefused = false; cx.notify(); });
    this.addSkillInput.on("submit", (_e, cx) => this.handleAddSkill({ skill: this.addSkillInput.value(), repo: this.getTypedSkillRepo(), cx }));
    this.trackFocus({ input: this.addSkillInput, id: "addSkill" });
    this.oncall = new OncallSettings({
      trackFocus: (params) => this.trackFocus(params),
      isFocused: (id) => this.focusedInput === id,
      openSelect,
      skillGroups: () => this.skillGroups({ ...SKILL_TABS[2], skills: this.getSettings().skills }),
    });
  }

  isOncallShown() {
    return this.isOpen && this.sectionId === "oncall";
  }

  // Called every panel tick: saves the picks of the selects opened from here.
  /** @param {import("gpui-kit").Context} cx */
  tick(cx) {
    if (this.isOncallShown()) this.oncall.tick(cx);
    for (const [store, apply] of this.openSelects) {
      const saved = shared(store);
      if (saved && typeof saved === "object" && "value" in saved) apply(saved.value);
    }
  }

  /** @param {{ store: string, title: string, value: string | string[], options: SelectOption[], isMulti?: boolean, anchor: import("./ui.js").Anchor | null, apply: (value: unknown) => void }} params */
  openSettingSelect({ store, title, value, options, isMulti = false, anchor, apply }) {
    this.openSelects.set(store, apply);
    this.openSelect({ store, title, value, options, isMulti, anchor });
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
    this.gh44.load(cx);
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
    this.openSelects.clear();
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
    if (!isValidSkillName(name) && !isLinkEntry(name)) {
      this.isAddSkillRefused = true;
      cx.notify();
      return;
    }
    this.saveSkills({ tab: this.addingTab, skills: addSkill({ skills: this.getSettings().skills, tab: this.addingTab, skill: name, repo }) });
    this.addSkillInput.set_value("");
    this.addingTab = null;
    this.isPickingLink = false;
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
      .children(this.linearKeyField());
  }

  // The secret field: [lin_api_••••] [Save], Linear's answer when it turns a key down, and where to make one.
  linearKeyField() {
    const t = theme();
    const isSaving = this.keySave.status === "saving";
    return [
      h_flex().flex_none().gap(6).items_center()
        .child(div().flex_1().min_w(0).child(fieldBox({
          id: "linear-key", isFocused: this.focusedInput === "linearKey",
          input: Input.new(this.linearKeyInput).flex_1().text_size(12).text_color(t.foreground),
        })))
        .child(button({
          id: "linear-key-save", label: isSaving ? "Checking…" : "Save", variant: isSaving ? "busy" : "primary",
          onClick: (cx) => this.handleSaveLinearKey(cx),
        })),
      ...(this.keySave.status === "failed" ? [div().text_size(11.5).text_color(palette(t).danger).child(this.keySave.message ?? "")] : []),
      linkLine({ id: "linear-key-link", label: "Create a key in Linear ↗", url: LINEAR_API_KEYS_URL }),
    ];
  }

  // The API key's states: checking, connected with Remove, rejected or missing with the field.
  linearAccountRows() {
    const t = theme();
    const account = this.session.linearAccount;
    switch (account.status) {
      case "checking": return [statusLine({ id: "linear-key-checking", tone: "checking", text: "Checking the key…" })];
      case "connected": return [statusLine({
        id: "linear-key-connected", tone: "connected", text: `Connected as ${account.name}`,
        action: button({ id: "linear-key-remove", label: "Remove", onClick: (cx) => this.handleRemoveLinearKey(cx) }),
      })];
      case "missing": return [
        ...(account.message ? [statusLine({ id: "linear-key-rejected", tone: "rejected", text: "Key rejected by Linear", help: "Paste a new one." })] : []),
        ...this.linearKeyField(),
      ];
      case "failed": return [
        div().text_size(11.5).text_color(palette(t).warning).child(`Could not check the key: ${account.message ?? "unknown error"}`),
        ...this.linearKeyField(),
      ];
      case "idle": return this.linearKeyField();
      default: {
        /** @type {never} */
        const unknownStatus = account.status;
        return unknownStatus;
      }
    }
  }

  // The General · GitHub · Linear · On-call switch, then the picked section.
  // It takes the list's place until Esc or ⚙.
  render() {
    const t = theme();
    const settings = this.getSettings();
    return v_flex().flex_1().min_h(0)
      .child(div().flex_none().px(GUTTER).pt(12).pb(12).border_b(1).border_color(t.border).child(this.sectionSwitch()))
      .child(v_flex().id("settings-list").flex_1().min_h(0).overflow_y_scrollbar().px(GUTTER).pt(14).pb(14).gap(18)
        .children(this.settingsGroups(settings)));
  }

  // [⚙ General | GitHub | Linear]: a full-width segmented control. Every segment keeps a 1px
  // border (no color, so transparent, when not picked), so picking one moves nothing.
  sectionSwitch() {
    const t = theme();
    return h_flex().id("settings-sections").w_full().h(SWITCH_HEIGHT).p(3).rounded(8).border(1).border_color(t.border).bg(t.background)
      .children(SECTIONS.map((section) => {
        const isOn = this.sectionId === section.id;
        return h_flex().id(`settings-section-${section.id}`).flex_1().h_full().gap(6).items_center().justify_center().rounded(6)
          .border(1).text_size(12.5)
          .when(isOn, (el) => el.bg(t.raised).border_color(t.border).text_color(t.foreground).font_medium())
          .when(!isOn, (el) => el.text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => {
              this.sectionId = section.id;
              this.keyEditing = null;
              this.addingTab = null;
              if (section.id === "oncall") this.oncall.open(cx);
              cx.notify();
            }))
          .child(svg(icon(section.iconName)).size(13).flex_none().text_color(isOn ? t.accent : t.muted))
          .child(section.label);
      }));
  }

  // The bays of the shown section.
  /** @param {import("./settings.js").Settings} settings */
  settingsGroups(settings) {
    switch (this.sectionId) {
      case "general": return this.generalGroups(settings);
      case "github":
        return this.skillGroups({ ...SKILL_TABS[0], skills: settings.skills });
      case "linear":
        return [
          bay({ title: "API key", description: "Your personal Linear key. It stays on this machine, readable only by you.", children: this.linearAccountRows() }),
          // Without a working key (or while it is checked) only the key shows.
          ...(isLinearKeyPending(this.session.linearAccount.status) ? [] : [
            ...this.skillGroups({ ...SKILL_TABS[1], skills: settings.skills }),
            bay({ title: "Where runs go", description: "Where a ticket's skill runs when the ticket has no worktree yet. A case can set its own.", children: this.whereToRunRows(settings) }),
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

  /** @param {import("./settings.js").Settings} settings */
  generalGroups(settings) {
    /** @param {boolean} isOn */
    const isLastTab = (isOn) => isOn && !(settings.shouldShowGithub && settings.shouldShowLinear);
    /** @param {{ id: string, label: string, isOn: boolean, key: string }} params */
    const tabToggle = ({ id, label, isOn, key }) => toggleRow({
      id, label, isOn, isDisabled: isLastTab(isOn), help: isLastTab(isOn) ? LAST_TAB_HELP : null, onToggle: () => this.patchSettings({ [key]: !isOn }),
    });
    return [
      bay({
        title: "Panel", description: "Which tabs and filters the panel shows.",
        children: [
          tabToggle({ id: "github", label: "Show the GitHub tab", isOn: settings.shouldShowGithub, key: "shouldShowGithub" }),
          tabToggle({ id: "linear", label: "Show the Linear tab", isOn: settings.shouldShowLinear, key: "shouldShowLinear" }),
          toggleRow({ id: "oncall", label: "Show the On-call tab", isOn: settings.shouldShowOncall, onToggle: () => this.patchSettings({ shouldShowOncall: !settings.shouldShowOncall }) }),
          toggleRow({ id: "filter-chips", label: "Show active filters inline", isOn: settings.shouldShowFilterChips, onToggle: () => this.patchSettings({ shouldShowFilterChips: !settings.shouldShowFilterChips }) }),
        ],
      }),
      bay({
        title: "Sidebar", description: "Spaces and agents on the left.",
        children: [toggleRow({
          id: "omnia-sidebar", label: "Omnia sidebar", help: "Leads, agent kinds and colors. Off: Herdr's own spaces and agents lists.",
          isOn: isOmniaSidebarOn(shared(OMNIA_SIDEBAR_STORE)), onToggle: () => handleOmniaSidebarToggle(),
        })],
      }),
      bay({
        title: "Rows", description: "What a GitHub or Linear row does. Space opens its details either way.",
        children: [
          controlRow({ id: "row-click", label: "Click on a row", control: this.rowClickSelect(settings) }),
          toggleRow({
            id: "notify-blocked", label: "Notify when an agent needs you", help: "Once, with the row it works on.",
            isOn: settings.shouldNotifyBlocked, onToggle: () => this.patchSettings({ shouldNotifyBlocked: !settings.shouldNotifyBlocked }),
          }),
          controlRow({ id: "start-collapsed", label: "Start collapsed", help: "Groups that start closed when the panel loads.", control: this.startCollapsedSelect(settings) }),
        ],
      }),
      bay({
        title: "gh44 setup", description: "The gh44-brain skills: plan, implement and review tickets and PRs, one skill per step.",
        children: this.gh44.cards(),
      }),
      bay({
        title: "Uninstall",
        children: [controlRow({
          id: "uninstall", label: "Remove gh44-omnia", help: "Herdr switches to its main layout; your old keys and settings come back from their backup.",
          control: this.uninstallButton(),
        })],
      }),
    ];
  }

  /** @param {import("./settings.js").Settings} settings */
  rowClickSelect(settings) {
    const label = ROW_CLICK_OPTIONS.find((o) => o.value === settings.rowClick)?.label ?? "";
    return selectButton({
      id: "row-click", text: label,
      onOpen: ({ anchor }) => this.openSettingSelect({
        store: ROW_CLICK_SELECT, title: "Click on a row", value: settings.rowClick, options: ROW_CLICK_OPTIONS, anchor,
        apply: (value) => {
          const option = ROW_CLICK_OPTIONS.find((o) => o.value === value);
          if (option && option.value !== this.getSettings().rowClick) this.patchSettings({ rowClick: option.value });
        },
      }),
    });
  }

  // The groups listed here start collapsed; picked ones stay listed even when no row has them now.
  /** @param {import("./settings.js").Settings} settings */
  startCollapsedSelect(settings) {
    const known = this.getGroupOptions();
    const options = [...known, ...settings.startCollapsed.filter((id) => !known.some((o) => o.value === id)).map((id) => ({ value: id, label: id }))];
    const picked = getPickedText(settings.startCollapsed.map((id) => options.find((o) => o.value === id)?.label ?? id));
    return selectButton({
      id: "start-collapsed", ...picked,
      onOpen: ({ anchor }) => this.openSettingSelect({
        store: START_COLLAPSED_SELECT, title: "Start collapsed", value: settings.startCollapsed, options, isMulti: true, anchor,
        apply: (value) => {
          const ids = Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
          if (!isSameList({ a: ids, b: this.getSettings().startCollapsed })) this.patchSettings({ startCollapsed: ids });
        },
      }),
    });
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

  // A danger button; filled, it asks for the second click while it waits for one.
  uninstallButton() {
    const status = this.uninstall.status;
    switch (status) {
      case "idle": return button({ id: "gh44-uninstall", label: "Uninstall", variant: "danger", onClick: (cx) => this.handleUninstall(cx) });
      case "confirming": return button({ id: "gh44-uninstall", label: "Click again to uninstall", variant: "dangerConfirm", onClick: (cx) => this.handleUninstall(cx) });
      case "starting": return button({ id: "gh44-uninstall", label: "Uninstalling…", variant: "busy" });
      default: {
        /** @type {never} */
        const unknownStatus = status;
        return unknownStatus;
      }
    }
  }

  // "Where runs go": one choice (review skills never ask either way), and whether implement moves the ticket.
  /** @param {import("./settings.js").Settings} settings */
  whereToRunRows(settings) {
    return [
      ...WHERE_TO_RUN_OPTIONS.map((o) => radioRow({
        id: `where-${o.id}`, label: o.label, isOn: settings.whereToRun === o.id,
        onPick: () => this.patchSettings({ whereToRun: o.id }),
      })),
      toggleRow({
        id: "move-in-progress", label: "Move to In progress when implement starts", help: "A ticket in Backlog or Todo moves once its work skill starts.",
        isOn: settings.shouldMoveToInProgress, onToggle: () => this.patchSettings({ shouldMoveToInProgress: !settings.shouldMoveToInProgress }),
      }),
    ];
  }

  // A tab's Actions and By case bays.
  /** @param {{ tab: SkillTab, situations: { id: Situation, label: string }[], skills: import("./settings.js").Skills }} params */
  skillGroups({ tab, situations, skills }) {
    return [
      bay({
        title: "Actions", count: skills[tab].list.length, description: "What the ▾ menu on a row offers, and the key that starts each one.",
        children: this.skillListRows({ tab, skills }),
      }),
      bay({
        title: "By case", count: situations.length, description: "What each kind of row suggests, in order. Click a case to edit it.",
        children: caseStrips({ tab, skills, getMatches: this.getCaseMatches, onOpen: this.openCaseEditor }),
      }),
    ];
  }

  // A tab's actions as strips (name with its tags, key cell, remove), then Add skill. Built-in
  // actions have no remove. A repo skill carries its repo's name; rows offer it only in that repo.
  /** @param {{ tab: SkillTab, skills: import("./settings.js").Skills }} params */
  skillListRows({ tab, skills }) {
    const t = theme();
    const list = skills[tab].list;
    const { installedSkills, repo } = this.session;
    const skillRows = list.map((entry) => {
      const isBuiltIn = entry.name === ASK_ACTION || entry.name === CONTINUE_ACTION;
      const isOtherRepo = Boolean(entry.repo) && entry.repo !== repo.name;
      const isRunnable = isOtherRepo || canRunEntry({ entry, installedSkills, repo });
      const link = getLinkEntry(entry.name);
      return holderStrip({
        id: `skill-${tab}-${entry.name}`, tone: "neutral", iconName: link?.icon ?? "play",
        body: h_flex().min_w(0).gap(6).items_center()
          .child(div().min_w(0).truncate().text_size(12.5).text_color(isRunnable && !isOtherRepo ? t.foreground : t.dim).child(link?.label ?? entry.name))
          .when(Boolean(entry.repo), (el) => el.child(listTag({ kind: "repo", text: shortRepo(entry.repo ?? ""), tip: `Only in ${entry.repo}`, isDim: isOtherRepo })))
          .when(!isRunnable, (el) => el.child(listTag({ kind: entry.repo ? "notInRepo" : "notInstalled" })))
          .when(isBuiltIn, (el) => el.child(listTag({ kind: "builtIn", tip: entry.name === ASK_ACTION ? ASK_DESCRIPTION : CONTINUE_DESCRIPTION }))),
        trailing: h_flex().gap(4).items_center()
          .child(this.skillKeyCell({ tab, entry }))
          .child(isBuiltIn ? div().size(22).flex_none() : this.removeSkillButton({ tab, skills, skill: entry.name })),
      });
    });
    return [...skillRows, ...this.addSkillRows({ tab, list })];
  }

  /** @param {{ tab: SkillTab, skills: import("./settings.js").Skills, skill: string }} params */
  removeSkillButton({ tab, skills, skill }) {
    const t = theme();
    return div().id(`skill-remove-${tab}-${skill}`).size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
      .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Remove this skill")
      .on_click((_e, cx) => { this.saveSkills({ tab, skills: removeSkill({ skills, tab, skill }) }); cx.notify(); })
      .child(svg(icon("x")).size(12));
  }

  // The key cell: idle shows the letter; clicking it takes the next letter typed, or "No key".
  /** @param {{ tab: SkillTab, entry: { name: string, key: string | null } }} params */
  skillKeyCell({ tab, entry }) {
    const t = theme();
    const isEditing = this.keyEditing?.tab === tab && this.keyEditing.skill === entry.name;
    if (isEditing) {
      return h_flex().flex_none().gap(4).items_center()
        .child(keyCellEditing({ input: Input.new(this.skillKeyInput).w_full().text_size(12).text_color(t.foreground) }))
        .child(div().on_mouse_down("left", stop).child(button({
          id: `skill-key-clear-${tab}-${entry.name}`, label: "No key", variant: "ghost",
          onClick: () => {
            this.saveSkills({ tab, skills: setSkillKey({ skills: this.getSettings().skills, tab, skill: entry.name, key: null }) });
            this.keyEditing = null;
            this.focusPanel();
          },
        })));
    }
    return keyCell({
      id: `skill-key-${tab}-${entry.name}`, letter: entry.key,
      tip: entry.key ? `Key ${entry.key}: click, then type a new letter` : "Click, then type a key letter",
      onClick: () => {
        this.keyEditing = { tab, skill: entry.name };
        this.skillKeyInput.set_value("");
        this.skillKeyInput.focus();
      },
    });
  }

  // "+ Add skill", or a search over the focused repo's skills and the installed ones not in the list
  // yet. On GitHub, Add a link… swaps them for the link entries not in the list.
  /** @param {{ tab: SkillTab, list: { name: string }[] }} params */
  addSkillRows({ tab, list }) {
    const t = theme();
    if (this.addingTab !== tab) {
      return [h_flex().id(`skill-add-${tab}`).h(30).flex_none().px(6).gap(6).items_center().rounded(4).cursor_pointer().text_size(12.5)
        .text_color(t.accent).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          this.addingTab = tab;
          this.isPickingLink = false;
          this.addSkillInput.set_value("");
          this.addSkillInput.focus();
          cx.notify();
        })
        .child("+ Add skill")];
    }
    const typed = this.addSkillInput.value().trim();
    const { repo, installedSkills } = this.session;
    const names = list.map((e) => e.name);
    const links = tab === "github" ? LINK_ENTRIES.filter((e) => isLinkEntry(e.name) && !names.includes(e.name)) : [];
    const suggestions = this.isPickingLink ? [] : getSkillCandidates({ names, installedSkills, repo, typed }).slice(0, SKILL_SUGGESTIONS);
    /** @param {{ id: string, iconName: string, label: string, tag: ReturnType<typeof div>, onClick: (cx: import("gpui-kit").Context) => void }} params */
    const option = ({ id, iconName, label, tag, onClick }) => h_flex().id(id).h(26).px(8).gap(6).items_center().rounded(5).cursor_pointer()
      .text_size(12).text_color(t.foreground).hover((st) => st.bg(t.hover))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => onClick(cx))
      .child(svg(icon(iconName)).size(10).flex_none().text_color(iconName === "play" ? t.accent : t.muted))
      .child(div().flex_1().min_w(0).truncate().child(label))
      .child(tag);
    const linkOptions = this.isPickingLink
      ? links.map((e) => option({ id: `skill-link-${tab}-${e.id}`, iconName: e.icon, label: e.label, tag: listTag({ kind: "link" }), onClick: (cx) => this.handleAddSkill({ skill: e.name, repo: null, cx }) }))
      : [];
    const addLink = !this.isPickingLink && links.length > 0
      ? [option({ id: `skill-add-link-${tab}`, iconName: "link", label: "Add a link…", tag: div(), onClick: (cx) => { this.isPickingLink = true; cx.notify(); } })]
      : [];
    return [
      fieldBox({
        id: `skill-add-${tab}`, isFocused: this.focusedInput === "addSkill", iconName: "search",
        input: Input.new(this.addSkillInput).flex_1().text_size(12).text_color(t.foreground),
        trailing: div().id(`skill-add-cancel-${tab}`).px(8).text_size(11.5).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { this.addingTab = null; this.focusPanel(); cx.notify(); })
          .child("Cancel"),
      }),
      v_flex().flex_none().p(3).gap(1).rounded(6).border(1).border_color(t.border).bg(t.popover)
        .children(suggestions.map((c) => option({
          id: `skill-suggest-${tab}-${c.name}`, iconName: "play", label: c.name,
          tag: c.repo ? listTag({ kind: "repo", text: shortRepo(c.repo) }) : listTag({ kind: "installed" }),
          onClick: (cx) => this.handleAddSkill({ skill: c.name, repo: c.repo, cx }),
        })))
        .children(linkOptions)
        .children(addLink)
        .when(suggestions.length === 0 && !this.isPickingLink, (el) => el.child(div().px(8).py(4).text_size(11.5).text_color(t.dim)
          .child(typed ? "↵ adds it by this name" : "No more skills in ~/.claude/skills or this repo's .claude. Type a name.")))
        .when(this.isAddSkillRefused, (el) => el.child(div().px(8).py(4).text_size(11.5).text_color(palette(t).danger)
          .child("A skill name is one word: letters, digits, _ : . or -"))),
    ];
  }
}

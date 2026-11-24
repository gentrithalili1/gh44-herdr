// The settings' On-call section: the tracker token, the org and projects to watch, how often,
// and the on-call switch that starts or stops the background service.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, notify, pickFolder, shared, setShared } from "herdr";
import { ONCALL_SHOW_TODAY_STORE, isTodayShown } from "./decisions.js";
import { openOncallTextDialog, ONCALL_TEXT_SAVED_STORE } from "./text-dialog.js";
import { icon, palette, stop, toAnchor, MONO_FONT } from "../ui.js";
import {
  POLL_MINUTES, CATCH_UP_HOURS, NOTIFY_SEVERITY_OPTIONS, PRIORITIES, MODELS, NUDGE_SUGGESTIONS, NEVER_SUGGESTIONS,
  DOMAIN_MODEL, BUILT_IN_TRIAGE_SKILL, getMissingSetup, setOrg, pickProjects, pickSome, parseEnvironments, addRule, toggleRule, removeRule,
} from "./config.js";
import {
  loadOncallConfig, saveOncallConfig, hasTrackerToken, saveTrackerToken, removeTrackerToken, loadTrackerAccount,
  loadTrackerProjects, loadServiceStatus, startOncall, stopOncall, playAlertSound, loadPreview, testDomain, scanRepo,
} from "./client.js";
import { loadInstalledSkills, loadRepoSkills } from "../actions.js";
import { isValidSkillName } from "../settings.js";
import { getProvider } from "./providers/catalog.js";

/** @typedef {"trackerToken" | "nudgeRules" | "neverRules" | "environments"} OncallInputId */
// Long texts show this many lines in settings; the rest opens in a dialog.
const PREVIEW_LINES = 3;
/** @param {string} text */
const capitalize = (text) => `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;

/** @typedef {import("./config.js").OncallConfig} OncallConfig */
/** @typedef {import("./config.js").Org} Org */
/** @typedef {import("./config.js").Project} Project */

// While the section shows, the service's status is read this often.
const STATUS_REFRESH_MS = 5_000;
// The token and the org's projects are checked again on opening only when older than this; until
// then, and while a check runs, the last answer stays on screen so nothing jumps.
const ACCOUNT_REFRESH_MS = 10 * 60_000;
const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;
const SPINNER = "mods/workspace-chrome/spinner.svg";
// Where the triage skill and project selects put their picks.
const TRIAGE_SKILL_SELECT = "hub.oncall.triageSkillSelect";
const PROJECTS_SELECT = "hub.oncall.projectsSelect";
// The other settings picked from a select: each one's shared store.
const SETTING_SELECTS = {
  notify: "hub.oncall.notifySelect",
  model: "hub.oncall.modelSelect",
  priorities: "hub.oncall.prioritiesSelect",
  poll: "hub.oncall.pollSelect",
  catchUp: "hub.oncall.catchUpSelect",
};
/** @typedef {keyof typeof SETTING_SELECTS} SettingSelect */
// Picked projects named on the closed project select before it says "+N more".
const PROJECTS_NAMED = 3;
/** @type {import("./config.js").SetupStep[]} */
const SETUP_STEPS = ["token", "org", "projects", "repo", "domain"];
/** @type {Record<import("./config.js").SetupStep, string>} */
const MISSING_SETUP = {
  token: "Save a token for your issue tracker first.",
  org: "Pick an organization.",
  projects: "Pick at least one project.",
  repo: "Pick the repo you are on call for.",
  domain: "Describe your domain: what is yours.",
};

// "40s ago", "3m ago"; "in 1m" for a time ahead.
/** @param {string | null} iso */
const formatRelative = (iso) => {
  const ms = Date.parse(iso ?? "") - Date.now();
  if (!Number.isFinite(ms)) return null;
  const abs = Math.abs(ms);
  const text = abs < MINUTE_MS ? `${Math.max(1, Math.round(abs / SECOND_MS))}s` : `${Math.round(abs / MINUTE_MS)}m`;
  return ms < 0 ? `${text} ago` : `in ${text}`;
};

export class OncallSettings {
  /**
   * @param {{
   *   trackFocus: (params: { input: import("gpui-base").InputState | import("gpui-base").TextareaState, id: OncallInputId }) => void,
   *   isFocused: (id: OncallInputId) => boolean,
   *   settingsGroup: (params: { title: string, description: string, children: any[] }) => any,
   *   settingsToggle: (params: { id: string, label: string, isOn: boolean, onToggle: (cx: import("gpui-kit").Context) => void }) => any,
   *   settingsChoice: (params: { id: string, label: string, isOn: boolean, onPick: (cx: import("gpui-kit").Context) => void }) => any,
   *   openSelect: (params: { store: string, title: string, value: string | string[], options: { value: string, label: string }[], isMulti?: boolean, anchor?: import("../ui.js").Anchor | null }) => void,
   *   skillGroups: () => any[],
   * }} host
   */
  constructor(host) {
    this.host = host;
    /** @type {OncallConfig | null} */
    this.config = null;
    /** @type {{ status: "idle" | "checking" | "connected" | "missing" | "failed", user?: string | null, orgs?: Org[], message?: string }} */
    this.account = { status: "idle" };
    // When the token was last checked, and whether a check runs now.
    this.accountCheckedAt = 0;
    this.isAccountChecking = false;
    // Each org's loaded projects and when, so switching orgs back and forth shows them at once.
    /** @type {Map<string, { items: Project[], at: number }>} */
    this.projectsByOrg = new Map();
    // The orgs whose projects are loading now.
    /** @type {Set<string>} */
    this.projectsLoading = new Set();
    /** @type {{ status: "idle" | "loading" | "success" | "failed", items: Project[], message?: string }} */
    this.projects = { status: "idle", items: [] };
    /** @type {import("./client.js").ServiceStatus | null} */
    this.service = null;
    this.statusReadAt = 0;
    /** @type {{ status: "idle" | "saving" | "failed", message?: string }} */
    this.tokenSave = { status: "idle" };
    /** @type {"idle" | "starting" | "stopping"} */
    this.switching = "idle";
    // "Preview next check": what it would do, without the AI.
    /** @type {{ status: "idle" | "loading" | "success" | "failed", text?: string, lines?: string[] }} */
    this.preview = { status: "idle" };
    /** @type {{ status: "idle" | "loading" | "success" | "failed", text?: string, lines?: { mine: string, text: string }[] }} */
    this.domainTest = { status: "idle" };
    this.isAdvancedOpen = false;
    this.tokenInput = InputState.new({ placeholder: "Paste the token…" });
    this.tokenInput.set_masked(true);
    this.tokenInput.on("submit", (_e, cx) => this.handleSaveToken(cx));
    host.trackFocus({ input: this.tokenInput, id: "trackerToken" });
    this.nudgeInput = InputState.new({ placeholder: "Describe when you want a nudge…" });
    this.nudgeInput.on("submit", (_e, cx) => this.handleAddRule({ cx, list: "nudgeRules", text: this.nudgeInput.value() }));
    host.trackFocus({ input: this.nudgeInput, id: "nudgeRules" });
    this.neverInput = InputState.new({ placeholder: "Describe what never deserves a nudge…" });
    this.neverInput.on("submit", (_e, cx) => this.handleAddRule({ cx, list: "neverRules", text: this.neverInput.value() }));
    host.trackFocus({ input: this.neverInput, id: "neverRules" });
    // The repo scan: CODEOWNERS and the SDK's noise rules read by code, then a short AI summary.
    /** @type {{ status: "idle" | "scanning" | "failed", message?: string }} */
    this.scan = { status: "idle" };
    // The last save from the long-text dialog this view has read.
    this.textSavedAt = shared(ONCALL_TEXT_SAVED_STORE);
    // The skills the triage skill list offers: ~/.claude/skills and the repo's own.
    /** @type {{ installed: string[], repo: string[] }} */
    this.skillChoices = { installed: [], repo: [] };
    // The select is open: its pick is read back on the next tick.
    this.isSkillSelectOpen = false;
    // The project select stays open while you tick projects: every change is read back.
    this.isProjectSelectOpen = false;
    // The setting selects opened since the section opened: their picks are read back on each tick.
    /** @type {Set<SettingSelect>} */
    this.openSettingSelects = new Set();
    // The select field pressed last: its menu opens under it.
    /** @type {import("../ui.js").Anchor | null} */
    this.selectAnchor = null;
    this.envInput = InputState.new({ placeholder: "production" });
    /** @type {[import("gpui-base").InputState, "environments"][]} */
    const textFields = [[this.envInput, "environments"]];
    for (const [input, id] of textFields) {
      input.on("change", (_e, cx) => cx.notify());
      // An input keeps one handler per event, and blur tracks focus: Enter saves.
      input.on("submit", (_e, cx) => this.handleSaveText({ cx, id }));
      host.trackFocus({ input, id });
    }
  }

  // Everything fresh: the saved setup, who the token is, the org's projects and the service.
  /** @param {import("gpui-kit").Context} cx */
  open(cx) {
    cx.spawn(async (cx) => {
      this.config = await loadOncallConfig();
      this.fillTextFields();
      cx.notify();
      void this.loadSkillChoices({ cx, folder: this.config.codeFolder });
      // A repo saved before the scan existed, or whose scan failed, gets one now.
      if (this.config.codeFolder && !this.config.repoProfile) void this.runScan(cx);
      await Promise.all([this.loadAccount(cx), this.loadProjects(cx), this.refreshStatus(cx)]);
    });
  }

  // The skills a triage can run: ~/.claude/skills and the code folder's own .claude.
  /** @param {{ cx: import("gpui-kit").Context, folder: string | null }} params */
  async loadSkillChoices({ cx, folder }) {
    const [installed, repo] = await Promise.all([loadInstalledSkills(), loadRepoSkills({ folder })]);
    this.skillChoices = { installed: installed ?? [], repo: repo ?? [] };
    cx.notify();
  }

  // A select's value, as it saved it in shared(store).
  /** @param {string} store @returns {unknown} */
  readSelect(store) {
    const saved = shared(store);
    return saved && typeof saved === "object" && "value" in saved ? saved.value : null;
  }

  // The project select's ticks, once they differ from the saved projects.
  /** @param {import("gpui-kit").Context} cx */
  applyProjectPick(cx) {
    if (!this.isProjectSelectOpen || !this.config) return;
    const picked = this.readSelect(PROJECTS_SELECT);
    if (!Array.isArray(picked)) return;
    const ids = picked.filter((id) => typeof id === "string");
    const savedIds = this.config.projects.map((p) => p.id);
    if ([...ids].sort().join() === [...savedIds].sort().join()) return;
    this.saveConfig({ cx, next: pickProjects({ config: this.config, ids, projects: this.projects.items }) });
  }

  // The setting selects' picks, saved once they differ from the config.
  /** @param {import("gpui-kit").Context} cx */
  applySettingPicks(cx) {
    const config = this.config;
    if (!config) return;
    for (const select of this.openSettingSelects) {
      const next = this.applySettingPick({ config, select, picked: this.readSelect(SETTING_SELECTS[select]) });
      if (next !== config && JSON.stringify(next) !== JSON.stringify(config)) {
        this.saveConfig({ cx, next });
        return;
      }
    }
  }

  // The config with one select's pick in it; the same config for a pick it does not know.
  /** @param {{ config: OncallConfig, select: SettingSelect, picked: unknown }} params @returns {OncallConfig} */
  applySettingPick({ config, select, picked }) {
    const list = Array.isArray(picked) ? picked : [];
    switch (select) {
      case "notify": {
        const severities = pickSome({ picked: list, order: NOTIFY_SEVERITY_OPTIONS });
        return severities ? { ...config, notifySeverities: severities } : config;
      }
      case "priorities": {
        const priorities = pickSome({ picked: list, order: PRIORITIES });
        return priorities ? { ...config, aiPriorities: priorities } : config;
      }
      case "model": {
        const model = MODELS.find((m) => m.id === picked)?.id;
        return model ? { ...config, model } : config;
      }
      case "poll": {
        const minutes = POLL_MINUTES.find((m) => String(m) === picked);
        return minutes ? { ...config, pollMinutes: minutes } : config;
      }
      case "catchUp": {
        const hours = CATCH_UP_HOURS.find((h) => String(h) === picked);
        return hours ? { ...config, catchUpHours: hours } : config;
      }
      default: {
        /** @type {never} */
        const unknownSelect = select;
        return unknownSelect;
      }
    }
  }

  // The triage skill select's pick, once it differs from the saved skill.
  /** @param {import("gpui-kit").Context} cx */
  applySkillPick(cx) {
    if (!this.isSkillSelectOpen || !this.config) return;
    const picked = this.readSelect(TRIAGE_SKILL_SELECT);
    if (typeof picked !== "string" || picked === this.config.triageSkill) return;
    this.isSkillSelectOpen = false;
    this.handlePickSkill({ cx, skill: picked });
  }

  /** @param {{ cx: import("gpui-kit").Context, skill: string }} params */
  handlePickSkill({ cx, skill }) {
    const config = this.config;
    if (!config || !isValidSkillName(skill)) return;
    if (skill !== config.triageSkill) this.saveConfig({ cx, next: { ...config, triageSkill: skill } });
    cx.notify();
  }

  /** @param {import("gpui-kit").Context} cx */
  async loadAccount(cx) {
    if (this.isAccountChecking || Date.now() - this.accountCheckedAt < ACCOUNT_REFRESH_MS) return;
    this.isAccountChecking = true;
    // Only the first check shows "Checking"; later ones keep the last answer on screen.
    if (this.account.status === "idle") {
      this.account = { status: "checking" };
      cx.notify();
    }
    const r = await loadTrackerAccount();
    this.isAccountChecking = false;
    this.accountCheckedAt = Date.now();
    if (r.status === "success") this.account = { status: "connected", user: r.user, orgs: r.orgs };
    else if (r.reason === "auth") this.account = { status: "missing", message: r.message };
    // A check that failed for another reason (offline) keeps a working token's settings on screen.
    else if (this.account.status !== "connected") this.account = { status: "failed", message: r.message };
    cx.notify();
  }

  /** @param {import("gpui-kit").Context} cx */
  async loadProjects(cx) {
    const org = this.config?.org?.slug ?? null;
    if (!org || !(await hasTrackerToken())) {
      this.projects = { status: "idle", items: [] };
      this.projectsByOrg.clear();
      cx.notify();
      return;
    }
    // Whatever is known for this org shows right away; a fresh list needs no reload.
    const cached = this.projectsByOrg.get(org);
    this.projects = cached ? { status: "success", items: cached.items } : { status: "loading", items: [] };
    cx.notify();
    if ((cached && Date.now() - cached.at < ACCOUNT_REFRESH_MS) || this.projectsLoading.has(org)) return;
    this.projectsLoading.add(org);
    const r = await loadTrackerProjects();
    this.projectsLoading.delete(org);
    if (r.status === "success") this.projectsByOrg.set(org, { items: r.projects, at: Date.now() });
    // Another org picked meanwhile: its own load fills the screen.
    if (this.config?.org?.slug !== org) return;
    this.projects = r.status === "success" ? { status: "success", items: r.projects } : { status: "failed", items: cached?.items ?? [], message: r.message };
    cx.notify();
  }

  /** @param {import("gpui-kit").Context} cx */
  async refreshStatus(cx) {
    this.statusReadAt = Date.now();
    this.service = await loadServiceStatus();
    cx.notify();
  }

  // Called every panel tick while the section shows.
  /** @param {import("gpui-kit").Context} cx */
  tick(cx) {
    this.applySkillPick(cx);
    this.applyProjectPick(cx);
    this.applySettingPicks(cx);
    this.applyTextSave(cx);
    if (Date.now() - this.statusReadAt < STATUS_REFRESH_MS) return;
    this.statusReadAt = Date.now();
    cx.spawn(async (cx) => this.refreshStatus(cx));
  }

  // A save in the long-text dialog: read the config again.
  /** @param {import("gpui-kit").Context} cx */
  applyTextSave(cx) {
    const savedAt = shared(ONCALL_TEXT_SAVED_STORE);
    if (savedAt === this.textSavedAt) return;
    this.textSavedAt = savedAt;
    cx.spawn(async (cx) => {
      this.config = await loadOncallConfig();
      cx.notify();
    });
  }

  /** @param {{ cx: import("gpui-kit").Context, next: OncallConfig }} params */
  saveConfig({ cx, next }) {
    this.config = next;
    cx.notify();
    cx.spawn(async () => {
      const r = await saveOncallConfig(next);
      if (r.status !== "success") notify({ title: "Could not save the On-call setup", body: r.message, level: "warning" });
    });
  }

  /** @param {import("gpui-kit").Context} cx */
  handleSaveToken(cx) {
    const token = this.tokenInput.value();
    if (!token.trim() || this.tokenSave.status === "saving") return;
    this.tokenSave = { status: "saving" };
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await saveTrackerToken(token);
      if (r.status === "success") {
        this.tokenSave = { status: "idle" };
        this.tokenInput.set_value("");
        this.account = { status: "connected", user: r.user, orgs: r.orgs };
        this.accountCheckedAt = Date.now();
        // One org: picked for you.
        if (!this.config?.org && r.orgs.length === 1 && this.config) await this.pickOrg({ cx, org: r.orgs[0] });
      } else {
        this.tokenSave = { status: "failed", message: r.message ?? `${this.tracker.name} did not accept this token` };
      }
      cx.notify();
    });
  }

  /** @param {import("gpui-kit").Context} cx */
  handleRemoveToken(cx) {
    cx.spawn(async (cx) => {
      if (this.config?.isOn) await this.switchOncall({ cx, isOn: false });
      const r = await removeTrackerToken();
      if (r.status === "success") {
        this.account = { status: "missing" };
        this.accountCheckedAt = Date.now();
        this.projects = { status: "idle", items: [] };
        this.projectsByOrg.clear();
      } else {
        notify({ title: `Could not remove the ${this.tracker.name} token`, body: r.message, level: "warning" });
      }
      cx.notify();
    });
  }

  /** @param {{ cx: import("gpui-kit").Context, org: Org }} params */
  async pickOrg({ cx, org }) {
    if (!this.config) return;
    const next = setOrg({ config: this.config, org });
    if (next === this.config) return;
    this.config = next;
    cx.notify();
    const r = await saveOncallConfig(next);
    if (r.status !== "success") notify({ title: "Could not save the On-call setup", body: r.message, level: "warning" });
    await this.loadProjects(cx);
  }

  /** @param {{ cx: import("gpui-kit").Context, isOn: boolean }} params */
  async switchOncall({ cx, isOn }) {
    if (!this.config || this.switching !== "idle") return;
    this.switching = isOn ? "starting" : "stopping";
    cx.notify();
    const r = isOn ? await startOncall(this.config) : await stopOncall(this.config);
    this.switching = "idle";
    if (r.status === "success") {
      this.config = r.config;
      notify({ title: isOn ? "You are on call" : "Off call", body: isOn ? `${this.tracker.name} is checked in the background.` : "No more checks or alerts.", level: "info" });
    } else {
      notify({ title: isOn ? "Could not start On-call" : "Could not stop On-call", body: r.message, level: "warning" });
    }
    await this.refreshStatus(cx);
  }

  // The issue tracker the setup is for: names, token help and labels (providers/catalog.js).
  get tracker() {
    return getProvider(this.config?.provider);
  }

  // ---------- view ----------

  /** @returns {any[]} */
  groups() {
    const config = this.config;
    if (!config) return [div().text_size(12).text_color(theme().dim).child("Loading…")];
    const tracker = this.tracker;
    const isConnected = this.account.status === "connected";
    const group = this.host.settingsGroup;
    const advanced = [
      this.sectionTitle("Rules"),
      group({ title: "Notify me when…", description: "Plain language. The AI checks every issue against these. With none on, any real defect counts.", children: this.ruleRows({ config, list: "nudgeRules" }) }),
      group({ title: "Never notify me for…", description: "Checked before the rules above. A match never notifies you.", children: this.ruleRows({ config, list: "neverRules" }) }),
      this.sectionTitle("Checks"),
      group({
        title: `${tracker.priorityLabel} for AI`, description: `Issues with another ${tracker.priorityLabel} skip the AI and never notify you.`,
        children: [this.settingSelect({
          select: "priorities", title: `${tracker.priorityLabel} for AI`, isMulti: true, value: config.aiPriorities,
          options: PRIORITIES.map((p) => ({ value: p, label: capitalize(p) }))
        })],
      }),
      group({ title: "Environments", description: "Only events from these environments, comma separated. Empty: all of them.", children: [this.textField({ id: "environments", input: this.envInput })] }),
      group({
        title: "Check every", description: `How often the service asks ${tracker.name}. A change applies after the next check.`,
        children: [this.settingSelect({
          select: "poll", title: "Check every", isMulti: false, value: [String(config.pollMinutes)],
          options: POLL_MINUTES.map((m) => ({ value: String(m), label: m === 1 ? "1 minute" : `${m} minutes` }))
        })],
      }),
      group({
        title: "Look back", description: "Issues seen in this window are checked, also what changed while you were off call.",
        children: [this.settingSelect({
          select: "catchUp", title: "Look back", isMulti: false, value: [String(config.catchUpHours)],
          options: CATCH_UP_HOURS.map((h) => ({ value: String(h), label: h === 1 ? "Last hour" : `Last ${h} hours` }))
        })],
      }),
    ];
    // Setup shows one step at a time: a step appears once the one before it is done, and the
    // rest of the settings once all of them are.
    const missing = getMissingSetup({ config, hasToken: isConnected });
    /** @param {import("./config.js").SetupStep} step */
    const isReached = (step) => missing === null || SETUP_STEPS.indexOf(step) <= SETUP_STEPS.indexOf(missing);
    const setup = [
      group({ title: `${tracker.name} token`, description: `${tracker.token.help} It stays on this machine, readable only by you.`, children: this.tokenRows() }),
      ...(isReached("org") ? [group({ title: tracker.orgLabel, description: `The ${tracker.name} ${tracker.orgLabel.toLowerCase()} to watch.`, children: this.orgRows(config) })] : []),
      ...(isReached("projects") ? [group({ title: tracker.projectsLabel, description: `Only these ${tracker.projectsLabel.toLowerCase()}' issues reach you.`, children: this.projectRows(config) })] : []),
      ...(isReached("repo") ? [group({ title: "Repo", description: "The checkout you are on call for: the AI reads it to find the cause and owner, and Continue in Claude opens there.", children: this.repoRows(config) })] : []),
      ...(isReached("domain") && config.codeFolder ? [group({ title: "Repo profile", description: "What the scan learned: CODEOWNERS and the noise rules of your ${tracker.setupScan.sdkName} setup read exactly, and a short AI summary. Every triage reads it.", children: this.profileRows(config) })] : []),
      ...(isReached("domain") ? [group({
        title: "My domain",
        description: `What you are on call for. Before the full triage, a quick ${capitalize(DOMAIN_MODEL)} check (about a cent) drops issues outside it, so other teams' errors never nudge you.`,
        children: this.domainRows(config),
      })] : []),
    ];
    if (missing !== null) {
      const step = SETUP_STEPS.indexOf(missing) + 1;
      return [
        group({ title: "Set up On-call", description: `Step ${step} of ${SETUP_STEPS.length}: ${MISSING_SETUP[missing]}`, children: [] }),
        ...setup,
      ];
    }
    return [
      group({ title: "On call", description: `While on, ${tracker.name} is checked in the background, even with Herdr closed.`, children: this.switchRows(config) }),
      ...setup,
      this.sectionTitle("AI"),
      group({ title: "Triage skill", description: "The skill that guides the AI's investigation. The default, oncall-triage, ships with gh44-herdr; pick any of your own instead.", children: [this.triageSkillSelect(config)] }),
      group({
        title: "AI model", description: "The Claude model that triages. Bigger looks deeper and costs more.",
        children: [this.settingSelect({
          select: "model", title: "AI model", isMulti: false, value: [config.model],
          options: MODELS.map((m) => ({ value: m.id, label: `${m.label} · ${m.description}` }))
        })],
      }),
      this.sectionTitle("Notifications"),
      group({
        title: "Notify me for", description: "The severities the AI gives that notify you.",
        children: [this.settingSelect({
          select: "notify", title: "Notify me for", isMulti: true, value: config.notifySeverities,
          options: NOTIFY_SEVERITY_OPTIONS.map((v) => ({ value: v, label: capitalize(v) }))
        })],
      }),
      group({
        title: "Alert sound", description: "A soft chime with each notification.",
        children: [h_flex().gap(8).items_center()
          .child(div().flex_1().child(this.host.settingsToggle({ id: "oncall-sound", label: "Play a sound", isOn: config.isSoundOn, onToggle: (cx) => this.saveConfig({ cx, next: { ...config, isSoundOn: !config.isSoundOn } }) })))
          .child(this.button({ id: "oncall-sound-test", label: "Test", onClick: () => { void playAlertSound(); } }))
          .child(this.button({ id: "oncall-toast-test", label: "Send a test notification", onClick: () => this.handleTestNudge(config) }))],
      }),
      this.sectionTitle("On-call tab"),
      group({
        title: "Today", description: "What the tab shows above the list.",
        children: [this.host.settingsToggle({
          id: "oncall-show-today", label: "Show today's numbers", isOn: isTodayShown(shared(ONCALL_SHOW_TODAY_STORE)),
          onToggle: () => setShared(ONCALL_SHOW_TODAY_STORE, !isTodayShown(shared(ONCALL_SHOW_TODAY_STORE))),
        })],
      }),
      this.sectionTitle("Row actions"),
      ...this.host.skillGroups(),
      this.advancedToggle(),
      ...(this.isAdvancedOpen ? advanced : []),
    ];
  }

  // "Advanced ▸": the rules and the checks, folded away until asked for.
  advancedToggle() {
    const t = theme();
    return h_flex().id("oncall-advanced").flex_none().h(32).px(6).gap(6).items_center().rounded(6).cursor_pointer()
      .border_t(1).border_color(t.border).text_size(12.5).text_color(t.foreground).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.isAdvancedOpen = !this.isAdvancedOpen; cx.notify(); })
      .child(svg(icon(this.isAdvancedOpen ? "chevron" : "chevron-right")).size(12).text_color(t.muted))
      .child(div().flex_1().child("Advanced"))
      .child(div().text_size(11.5).text_color(t.dim).child("rules, priority, environments, timing"));
  }

  // [Preview next check] and its answer: how many issues, what the AI would look at, what is filtered.
  previewRows() {
    const t = theme();
    const preview = this.preview;
    const button = this.button({ id: "oncall-preview", label: preview.status === "loading" ? `Checking ${this.tracker.name}…` : "Preview next check", onClick: (cx) => this.handlePreview(cx) });
    const head = h_flex().gap(8).items_center()
      .child(div().flex_1().min_w(0).text_size(11.5).text_color(preview.status === "failed" ? palette(t).warning : t.dim)
        .child(preview.text ?? "See what a check would do, without running the AI."))
      .child(button);
    const lines = (preview.lines ?? []).map((line, i) => div().id(`oncall-preview-${i}`).px(6).text_size(11.5).text_color(t.muted).truncate().child(line));
    return [head, ...lines];
  }

  /** @param {import("gpui-kit").Context} cx */
  handlePreview(cx) {
    if (this.preview.status === "loading") return;
    this.preview = { status: "loading" };
    cx.spawn(async (cx) => {
      const r = await loadPreview();
      if (r.status !== "success") {
        this.preview = { status: "failed", text: r.message ?? "The preview failed" };
      } else {
        const later = Math.max(0, r.toAi.length - r.aiPerCheck);
        this.preview = {
          status: "success",
          text: `${r.issues} issues · ${r.toAi.length} for the AI${later ? ` (${r.aiPerCheck} per check)` : ""} · ${r.filtered.length} filtered · ${r.decided} already decided`,
          lines: [...r.toAi.map((w) => `AI · ${w.shortId} (${w.trigger}): ${w.title}`), ...r.filtered.map((w) => `skip · ${w.shortId}: ${w.reason}`)],
        };
      }
      cx.notify();
    });
  }

  // The system folder picker; a new repo drops the old profile and is scanned at once.
  /** @param {import("gpui-kit").Context} cx */
  handlePickRepo(cx) {
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: "Use this repo" });
      if (!folder || !this.config || folder === this.config.codeFolder) return;
      /** @type {OncallConfig} */
      const next = { ...this.config, codeFolder: folder, repoProfile: null };
      this.config = next;
      cx.notify();
      const saved = await saveOncallConfig(next);
      if (saved.status !== "success") {
        notify({ title: "Could not save the On-call setup", body: saved.message, level: "warning" });
        return;
      }
      void this.loadSkillChoices({ cx, folder });
      await this.runScan(cx);
    });
  }

  // Scans the saved repo; the profile lands in the config and the summary field.
  /** @param {import("gpui-kit").Context} cx */
  async runScan(cx) {
    if (this.scan.status === "scanning") return;
    this.scan = { status: "scanning" };
    cx.notify();
    const r = await scanRepo();
    if (r.status !== "success") {
      this.scan = { status: "failed", message: r.message ?? "The scan failed" };
      cx.notify();
      return;
    }
    this.scan = { status: "idle" };
    if (this.config && this.config.codeFolder === r.profile.folder) {
      this.saveConfig({ cx, next: { ...this.config, repoProfile: r.profile } });
    }
    cx.notify();
  }

  // The picked repo's path with Change, or Pick folder.
  /** @param {OncallConfig} config */
  repoRows(config) {
    const t = theme();
    return [h_flex().h(28).px(6).gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_family(MONO_FONT).text_color(config.codeFolder ? t.foreground : t.dim)
        .child(config.codeFolder ?? "No repo picked"))
      .child(this.button({ id: "oncall-repo-pick", label: config.codeFolder ? "Change…" : "Pick folder…", onClick: (cx) => this.handlePickRepo(cx) }))];
  }

  // The scan's status and counts with Rescan, then the summary to read and edit.
  /** @param {OncallConfig} config */
  profileRows(config) {
    const t = theme();
    const colors = palette(t);
    const profile = config.repoProfile;
    const isScanning = this.scan.status === "scanning";
    /** @param {number} n @param {string} word */
    const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    const status = (() => {
      if (isScanning) return `Scanning: reading CODEOWNERS and the ${this.tracker.setupScan.sdkName} setup, then a short Haiku read of the repo. About a minute.`;
      if (this.scan.status === "failed") return `Scan failed: ${this.scan.message ?? "unknown error"}`;
      if (!profile) return "Not scanned yet.";
      const owners = profile.codeowners ? count(profile.codeowners.split("\n").length, "CODEOWNERS line") : "no CODEOWNERS";
      const cost = profile.costUsd === null ? "" : ` · $${profile.costUsd.toFixed(3)}`;
      return `Scanned ${formatRelative(profile.scannedAt) ?? profile.scannedAt.slice(0, 10)} · ${owners} · ${count(Object.values(profile.noiseRules).flat().length, "noise rule")}${cost}`;
    })();
    const statusRow = h_flex().gap(8).items_center()
      .when(isScanning, (el) => el.child(svg(SPINNER).size(12).flex_none().text_color(t.working).spin(900)))
      .child(div().flex_1().min_w(0).text_size(11.5).text_color(this.scan.status === "failed" ? colors.warning : t.dim).child(status))
      .when(!isScanning, (el) => el.child(this.button({ id: "oncall-repo-scan", label: profile ? "Rescan" : "Scan", onClick: (cx) => { void this.runScan(cx); } })));
    if (!profile) return [statusRow];
    return [statusRow, this.textPreview({ id: "oncall-profile", text: profile.summary, isMono: false, field: "summary" })];
  }

  /** @param {OncallConfig} config */
  domainRows(config) {
    const t = theme();
    const lines = config.domain ? config.domain.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length : 0;
    return [
      ...(config.domain ? [this.textPreview({ id: "oncall-domain", text: config.domain, isMono: true, field: "domain" })] : []),
      h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.dim)
          .child(config.domain ? `${lines} line${lines === 1 ? "" : "s"} · the check runs on every new issue` : "Not set yet: On-call starts once it is"))
        .when(!config.domain, (el) => el.child(this.button({ id: "oncall-domain-write", label: "Write domain…", onClick: () => openOncallTextDialog("domain") })))
        .when(Boolean(config.domain), (el) => el.child(this.button({
          id: "oncall-domain-test", label: this.domainTest.status === "loading" ? "Testing…" : "Test on recent issues", onClick: (cx) => this.handleTestDomain(cx),
        }))),
      ...this.domainTestRows(),
    ];
  }

  // The first lines of a long text, with "+N more lines" and an Edit button that opens it in a dialog.
  /** @param {{ id: string, text: string, isMono: boolean, field: import("./text-dialog.js").OncallTextField }} params */
  textPreview({ id, text, isMono, field }) {
    const t = theme();
    const lines = text.split("\n").filter((l) => l.trim());
    const hidden = lines.length - PREVIEW_LINES;
    return h_flex().id(id).gap(10).items_start().rounded(6).border(1).border_color(t.border).px(8).py(6).bg(t.background)
      .child(v_flex().flex_1().min_w(0).gap(1).text_size(12).text_color(t.muted).when(isMono, (el) => el.font_family(MONO_FONT))
        .children(lines.slice(0, PREVIEW_LINES).map((line) => div().truncate().child(line)))
        .when(hidden > 0, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(`+${hidden} more line${hidden === 1 ? "" : "s"}`))))
      .child(this.button({ id: `${id}-edit`, label: "Edit…", onClick: () => openOncallTextDialog(field) }));
  }

  domainTestRows() {
    const t = theme();
    const colors = palette(t);
    const test = this.domainTest;
    if (test.status === "idle") return [];
    if (test.status === "loading") return [div().px(6).text_size(11.5).text_color(t.dim).child("Asking the cheap model about the latest issues…")];
    /** @type {Record<string, string>} */
    const tone = { yes: colors.success, no: colors.danger, unclear: colors.warning };
    return [
      div().px(6).text_size(11.5).text_color(test.status === "failed" ? colors.warning : t.dim).child(test.text ?? ""),
      ...(test.lines ?? []).map((line, i) => h_flex().id(`oncall-domain-line-${i}`).px(6).gap(6).items_start()
        .child(div().flex_none().w(52).text_size(11.5).font_semibold().text_color(tone[line.mine] ?? t.dim).child(line.mine))
        .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.muted).child(line.text))),
    ];
  }

  /** @param {import("gpui-kit").Context} cx */
  handleTestDomain(cx) {
    if (this.domainTest.status === "loading") return;
    this.domainTest = { status: "loading" };
    cx.spawn(async (cx) => {
      const r = await testDomain();
      this.domainTest = r.status === "success"
        ? { status: "success", text: `${r.results.length} latest issues · cost $${r.costUsd.toFixed(3)}`, lines: r.results.map((x) => ({ mine: x.mine, text: `${x.shortId}: ${x.reason}` })) }
        : { status: "failed", text: r.message ?? "The test failed" };
      cx.notify();
    });
  }

  /** @param {string} title */
  sectionTitle(title) {
    const t = theme();
    return div().flex_none().pt(6).pb(2).border_t(1).border_color(t.border).text_size(10.5).font_semibold().text_color(t.dim).child(title.toUpperCase());
  }

  /** @param {{ id: string, label: string, onClick: (cx: import("gpui-kit").Context) => void }} params */
  button({ id, label, onClick }) {
    const t = theme();
    return div().id(id).h(24).px(10).flex_none().flex().items_center().rounded(6).border(1).border_color(t.border).text_size(12)
      .text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { onClick(cx); cx.notify(); })
      .child(label);
  }

  /** @param {OncallConfig} config */
  handleTestNudge(config) {
    notify({ title: "HIGH · TEST-1", body: "This is how a nudge looks. Click it to open the On-call tab.", level: "warning", action: { name: "hub.oncall" } });
    if (config.isSoundOn) void playAlertSound();
  }

  // Where a skill comes from, beside its name.
  /** @param {string} skill */
  skillSource(skill) {
    if (skill === BUILT_IN_TRIAGE_SKILL) return "default";
    if (this.skillChoices.repo.includes(skill)) return "repo";
    if (this.skillChoices.installed.includes(skill) || skill.includes(":")) return null;
    return "not installed";
  }

  // [oncall-triage  default ▾]: the panel's select with search over every skill a triage can run:
  // the default (built in) first, then the repo's own skills, then ~/.claude/skills.
  /** @param {OncallConfig} config */
  triageSkillSelect(config) {
    const t = theme();
    const { installed, repo } = this.skillChoices;
    const options = [...new Set([BUILT_IN_TRIAGE_SKILL, config.triageSkill, ...repo, ...installed])].map((skill) => {
      const source = this.skillSource(skill);
      return { value: skill, label: source ? `${skill} · ${source}` : skill };
    });
    const source = this.skillSource(config.triageSkill);
    return h_flex().id("oncall-triage-skill").h(30).px(8).gap(6).items_center().rounded(6).border(1).border_color(t.input).bg(t.background)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (e) => { this.selectAnchor = toAnchor(e); })
      .on_click(() => {
        this.isSkillSelectOpen = true;
        this.host.openSelect({ store: TRIAGE_SKILL_SELECT, title: "Triage skill", value: config.triageSkill, options, anchor: this.selectAnchor });
      })
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(config.triageSkill))
      .when(source !== null, (el) => el.child(div().flex_none().text_size(11).text_color(source === "not installed" ? palette(t).warning : t.muted).child(source ?? "")))
      .child(svg(icon("chevron")).size(12).flex_none().text_color(t.muted));
  }

  // A select field: its picks and a chevron. The menu opens under it.
  /** @param {{ select: SettingSelect, title: string, isMulti: boolean, value: string[], options: { value: string, label: string }[] }} params */
  settingSelect({ select, title, isMulti, value, options }) {
    const t = theme();
    const labels = options.filter((o) => value.includes(o.value)).map((o) => o.label);
    return h_flex().id(`oncall-select-${select}`).h(30).px(8).gap(6).items_center().rounded(6).border(1).border_color(t.input).bg(t.background)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (e) => { this.selectAnchor = toAnchor(e); })
      .on_click(() => {
        this.openSettingSelects.add(select);
        this.host.openSelect({ store: SETTING_SELECTS[select], title, value: isMulti ? value : value[0] ?? "", options, isMulti, anchor: this.selectAnchor });
      })
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(labels.join(", ")))
      .child(svg(icon("chevron")).size(12).flex_none().text_color(t.muted));
  }

  // A text setting, saved on Enter; "unsaved" shows while it differs from the saved value.
  /** @param {{ id: "environments", input: import("gpui-base").InputState }} params */
  textField({ id, input }) {
    const t = theme();
    return h_flex().h(30).px(8).items_center().rounded(6).border(1).on_mouse_down("left", stop)
      .border_color(this.host.isFocused(id) ? t.accent : t.input).bg(t.background)
      .child(Input.new(input).flex_1().text_size(12).text_color(t.foreground))
      .when(this.isUnsaved(id), (el) => el.child(div().flex_none().text_size(11).text_color(palette(t).warning).child("↵ to save")));
  }

  /** @param {"environments"} id */
  isUnsaved(id) {
    const config = this.config;
    if (!config) return false;
    return parseEnvironments(this.envInput.value()).join(",") !== config.environments.join(",");
  }

  // The text fields show the saved values; called when the section opens.
  fillTextFields() {
    const config = this.config;
    if (!config) return;
    this.envInput.set_value(config.environments.join(", "));
  }

  /** @param {{ cx: import("gpui-kit").Context, id: "environments" }} params */
  handleSaveText({ cx, id }) {
    const config = this.config;
    if (!config) return;
    switch (id) {
      case "environments": {
        const value = parseEnvironments(this.envInput.value());
        if (value.join(",") !== config.environments.join(",")) this.saveConfig({ cx, next: { ...config, environments: value } });
        break;
      }
      default: {
        /** @type {never} */
        const unknownField = id;
        return unknownField;
      }
    }
  }

  // A rules list: on/off, the rule and ✕; then the field to add one, and suggestions not added yet.
  /** @param {{ config: OncallConfig, list: import("./config.js").RuleList }} params */
  ruleRows({ config, list }) {
    const t = theme();
    const input = list === "nudgeRules" ? this.nudgeInput : this.neverInput;
    const suggestions = (list === "nudgeRules" ? NUDGE_SUGGESTIONS : NEVER_SUGGESTIONS)
      .filter((text) => !config[list].some((r) => r.text.toLowerCase() === text.toLowerCase()));
    const rows = config[list].map((rule) => h_flex().id(`rule-${rule.id}`).min_h(28).px(6).gap(8).items_center().rounded(6).hover((s) => s.bg(t.surface))
      .child(this.switchMark({ id: `rule-switch-${rule.id}`, isOn: rule.isOn, onToggle: (cx) => this.saveConfig({ cx, next: toggleRule({ config, list, id: rule.id }) }) }))
      .child(div().flex_1().min_w(0).text_size(12.5).text_color(rule.isOn ? t.foreground : t.dim).child(rule.text))
      .child(div().id(`rule-remove-${rule.id}`).size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
        .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Remove this rule")
        .on_click((_e, cx) => this.saveConfig({ cx, next: removeRule({ config, list, id: rule.id }) }))
        .child(svg(icon("x")).size(12))));
    const field = h_flex().h(30).items_center().rounded(6).border(1).border_color(this.host.isFocused(list) ? t.accent : t.input).bg(t.background).overflow_hidden()
      .on_mouse_down("left", stop)
      .child(h_flex().flex_1().min_w(0).px(8).items_center().child(Input.new(input).flex_1().text_size(12).text_color(t.foreground)))
      .child(div().w(1).h_full().bg(t.border))
      .child(h_flex().id(`rule-add-${list}`).h_full().px(10).items_center().flex_none().text_size(12).bg(t.raised).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.handleAddRule({ cx, list, text: input.value() }))
        .child("Add rule"));
    const chips = h_flex().gap(6).flex_wrap().children(suggestions.map((text) => div().id(`rule-suggest-${list}-${text}`).h(24).px(9).flex().items_center().rounded(12)
      .border(1).border_color(t.border).text_size(11.5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => this.handleAddRule({ cx, list, text }))
      .child(`+ ${text}`)));
    return [...rows, field, ...(suggestions.length ? [chips] : [])];
  }

  /** @param {{ cx: import("gpui-kit").Context, list: import("./config.js").RuleList, text: string }} params */
  handleAddRule({ cx, list, text }) {
    if (!this.config || !text.trim()) return;
    const id = `${list === "nudgeRules" ? "nudge" : "never"}-${Date.now().toString(36)}`;
    this.saveConfig({ cx, next: addRule({ config: this.config, list, text, id }) });
    (list === "nudgeRules" ? this.nudgeInput : this.neverInput).set_value("");
  }

  // A small on/off switch, like the rule toggles in Slack's notification settings.
  /** @param {{ id: string, isOn: boolean, onToggle: (cx: import("gpui-kit").Context) => void }} params */
  switchMark({ id, isOn, onToggle }) {
    const t = theme();
    const on = palette(t).success;
    return h_flex().id(id).w(28).h(16).p(2).flex_none().rounded(8).cursor_pointer()
      .bg(isOn ? on : t.raised).border(1).border_color(isOn ? on : t.border)
      .when(isOn, (el) => el.justify_end())
      .on_click((_e, cx) => { onToggle(cx); cx.notify(); })
      .child(div().size(10).rounded(5).bg(isOn ? t.background : t.dim));
  }

  // [● Running · last check 40s ago · 12 issues | Stop], or what is missing before it can start.
  /** @param {OncallConfig} config */
  switchRows(config) {
    const t = theme();
    const colors = palette(t);
    const service = this.service;
    const missing = getMissingSetup({ config, hasToken: this.account.status === "connected" });
    const isRunning = Boolean(service?.isRunning);
    const isBusy = this.switching !== "idle";
    const lastCheck = formatRelative(service?.lastPollAt ?? null);
    const summary = isRunning
      ? ["Running", lastCheck ? `last check ${lastCheck}` : "first check running", service?.lastError ? null : `${service?.alertCount ?? 0} issues`].filter(Boolean).join(" · ")
      : config.isOn ? "On, but the service is not running" : "Off";
    const dot = isRunning ? (service?.lastError ? colors.warning : colors.success) : config.isOn ? colors.danger : t.dim;
    const isDisabled = !isRunning && missing !== null;
    const button = h_flex().id("oncall-switch").h(26).px(12).flex_none().items_center().gap(6).rounded(6).border(1)
      .text_size(12).font_medium()
      .border_color(isRunning || isDisabled ? t.border : t.accent).text_color(isDisabled ? t.dim : t.foreground)
      .when(isBusy, (el) => el.child(svg(SPINNER).size(12).text_color(t.working).spin(900)))
      .when(!isBusy && !isDisabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { cx.spawn(async (cx) => this.switchOncall({ cx, isOn: !isRunning })); }))
      .when(isDisabled && missing !== null, (el) => el.tooltip(MISSING_SETUP[/** @type {import("./config.js").SetupStep} */ (missing)]))
      .child(isBusy ? (this.switching === "starting" ? "Starting…" : "Stopping…") : isRunning ? "Go off call" : "Go on call");
    const rows = [h_flex().h(30).px(6).gap(8).items_center()
      .child(div().size(8).flex_none().rounded(4).bg(dot))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(summary))
      .child(button)];
    if (service?.lastError && isRunning) {
      const hint = service.lastError.reason === "auth" ? `${this.tracker.name} turned the token down. Save a new one below.` : service.lastError.message;
      rows.push(div().px(6).text_size(11.5).text_color(colors.warning).child(`Last check failed: ${hint}`));
    }
    if (missing && !isRunning) rows.push(div().px(6).text_size(11.5).text_color(t.dim).child(MISSING_SETUP[missing]));
    if (!missing) rows.push(...this.previewRows());
    return rows;
  }

  tokenRows() {
    const t = theme();
    const account = this.account;
    if (account.status === "checking" || account.status === "idle") return [div().px(6).text_size(12).text_color(t.dim).child(`Checking the ${this.tracker.name} token…`)];
    if (account.status === "connected") {
      return [h_flex().h(28).px(6).gap(8).items_center()
        .child(div().size(7).rounded(4).bg(palette(t).success))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(account.user ? `Connected as ${account.user}` : "Connected"))
        .child(div().id("tracker-token-remove").h(24).px(10).flex().items_center().rounded(6).border(1).border_color(t.border).text_size(12)
          .text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.handleRemoveToken(cx))
          .child("Remove"))];
    }
    const note = account.status === "failed" ? [div().text_size(11.5).text_color(palette(t).warning).child(`Could not check the token: ${account.message ?? "unknown error"}`)] : [];
    return [...note, this.tokenField()];
  }

  // [token ••••• | Save], the tracker's answer when it turns a token down, and where to make one.
  tokenField() {
    const t = theme();
    const isSaving = this.tokenSave.status === "saving";
    const saveButton = h_flex().id("tracker-token-save").h_full().px(10).gap(6).items_center().flex_none().text_size(12)
      .bg(t.raised).text_color(isSaving ? t.muted : t.foreground)
      .when(!isSaving, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.handleSaveToken(cx)))
      .when(isSaving, (el) => el.child(svg(SPINNER).size(12).text_color(t.working).spin(900)))
      .child(isSaving ? "Checking…" : "Save");
    return v_flex().flex_none().gap(6).on_mouse_down("left", stop)
      .child(h_flex().h(30).items_center().rounded(6).border(1).border_color(this.host.isFocused("trackerToken") ? t.accent : t.input).bg(t.background).overflow_hidden()
        .child(h_flex().flex_1().min_w(0).px(8).items_center().child(Input.new(this.tokenInput).flex_1().text_size(12).text_color(t.foreground)))
        .child(div().w(1).h_full().bg(t.border))
        .child(saveButton))
      .when(this.tokenSave.status === "failed", (el) => el.child(div().text_size(11.5).text_color(palette(t).danger).child(this.tokenSave.message ?? "")))
      .child(h_flex().id("tracker-token-link").gap(4).items_center().text_size(11.5).text_color(t.accent).cursor_pointer()
        .on_click((_e, cx) => cx.open_url(this.tracker.token.createUrl))
        .child(this.tracker.token.createLabel));
  }

  /** @param {OncallConfig} config */
  orgRows(config) {
    const orgs = this.account.orgs ?? [];
    if (orgs.length === 0) return [div().px(6).text_size(12).text_color(theme().dim).child("This token sees no organizations.")];
    return orgs.map((org) => this.host.settingsChoice({
      id: `oncall-org-${org.slug}`, label: org.name, isOn: config.org?.slug === org.slug,
      onPick: (cx) => { cx.spawn(async (cx) => this.pickOrg({ cx, org })); },
    }));
  }

  /** @param {OncallConfig} config */
  projectRows(config) {
    const t = theme();
    const projects = this.projects;
    if (projects.items.length === 0 && (projects.status === "loading" || projects.status === "idle")) return [div().px(6).text_size(12).text_color(t.dim).child("Loading projects…")];
    if (projects.status === "failed" && projects.items.length === 0) return [div().px(6).text_size(11.5).text_color(palette(t).warning).child(`Could not load projects: ${projects.message ?? "unknown error"}`)];
    const picked = config.projects.map((p) => p.slug);
    const named = picked.slice(0, PROJECTS_NAMED).join(", ");
    const more = picked.length > PROJECTS_NAMED ? ` +${picked.length - PROJECTS_NAMED} more` : "";
    // [web, api, mobile +2 more ▾]: the Work panel's multi-select with search; picked ones list first.
    const select = h_flex().id("oncall-projects").h(30).px(8).gap(6).items_center().rounded(6).border(1).border_color(t.input).bg(t.background)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (e) => { this.selectAnchor = toAnchor(e); })
      .on_click(() => {
        this.isProjectSelectOpen = true;
        this.host.openSelect({
          store: PROJECTS_SELECT, title: "Projects", value: config.projects.map((p) => p.id), isMulti: true, anchor: this.selectAnchor,
          options: projects.items.map((p) => ({ value: p.id, label: p.slug })),
        });
      })
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(picked.length ? t.foreground : t.dim).child(picked.length ? `${named}${more}` : "Pick projects"))
      .child(svg(icon("chevron")).size(12).flex_none().text_color(t.muted));
    const count = div().px(6).text_size(11.5).text_color(t.dim).child(`${picked.length} of ${projects.items.length} picked`);
    return [select, count];
  }
}

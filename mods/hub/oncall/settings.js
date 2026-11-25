// The settings' On-call section in the control kit. While setting up: a step bar, each finished
// step folded to a strip, the current one open and the later ones locked. Set up: the on-call
// switch, then what it knows (tracker, repo, profile, domain), how it decides (rules, checks,
// triage, cases) and how it tells you (notify, sound, today's numbers).
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, notify, pickFolder, shared, setShared } from "herdr";
import { ONCALL_SHOW_TODAY_STORE, isTodayShown } from "./decisions.js";
import { openOncallTextDialog, ONCALL_TEXT_SAVED_STORE } from "./text-dialog.js";
import { icon, palette, stop, MONO_FONT, ACCENT_TONE } from "../ui.js";
import {
  bay, controlRow, toggleRow, selectButton, getPickedText, button, statusLine, fieldBox, linkLine, holderStrip, switchMark, listTag,
} from "../controls.js";
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
/** @typedef {import("./config.js").SetupStep} SetupStep */
/** @typedef {ReturnType<typeof div>} Element */
// Long texts show this many lines in settings; the rest opens in a dialog.
const PREVIEW_LINES = 3;
// A domain's lines that say something: not blank, not a # comment.
/** @param {string} domain */
const countDomainLines = (domain) => domain.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;
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
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const SPINNER = "mods/workspace-chrome/spinner.svg";
const SPINNER_PERIOD_MS = 900;
const LOCKED_OPACITY = 0.5;
const ENVIRONMENTS_FIELD_WIDTH = 170;
const DOMAIN_TEST_LABEL_WIDTH = 52;
// Where the triage skill, org and project selects put their picks.
const TRIAGE_SKILL_SELECT = "hub.oncall.triageSkillSelect";
const ORG_SELECT = "hub.oncall.orgSelect";
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
/** @type {SetupStep[]} */
const SETUP_STEPS = ["token", "org", "projects", "repo", "domain"];
/** @type {Record<import("./config.js").SetupStep, string>} */
const MISSING_SETUP = {
  token: "Save a token for your issue tracker first.",
  org: "Pick an organization.",
  projects: "Pick at least one project.",
  repo: "Pick the repo you are on call for.",
  domain: "Describe your domain: what is yours.",
};

// "40s ago", "3m ago", "2d ago"; "in 1m" for a time ahead.
/** @param {string | null} iso */
const formatRelative = (iso) => {
  const ms = Date.parse(iso ?? "") - Date.now();
  if (!Number.isFinite(ms)) return null;
  const abs = Math.abs(ms);
  /** @returns {string} */
  const getText = () => {
    if (abs < MINUTE_MS) return `${Math.max(1, Math.round(abs / SECOND_MS))}s`;
    if (abs < HOUR_MS) return `${Math.round(abs / MINUTE_MS)}m`;
    return abs < DAY_MS ? `${Math.round(abs / HOUR_MS)}h` : `${Math.round(abs / DAY_MS)}d`;
  };
  return ms < 0 ? `${getText()} ago` : `in ${getText()}`;
};

/** @param {{ count: number, word: string }} params */
const plural = ({ count, word }) => `${count} ${word}${count === 1 ? "" : "s"}`;

// A strip's body: its title over one dim line.
/** @param {{ title: string, meta?: string | null, isMono?: boolean }} params */
const stripBody = ({ title, meta = null, isMono = false }) => {
  const t = theme();
  return v_flex().min_w(0).gap(1)
    .child(div().truncate().text_size(12.5).text_color(t.foreground).child(title))
    .when(Boolean(meta), (el) => el.child(div().truncate().text_size(11.5).text_color(t.dim).when(isMono, (line) => line.font_family(MONO_FONT)).child(meta ?? "")));
};

export class OncallSettings {
  /**
   * @param {{
   *   trackFocus: (params: { input: import("gpui-base").InputState | import("gpui-base").TextareaState, id: OncallInputId }) => void,
   *   isFocused: (id: OncallInputId) => boolean,
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
    // A finished setup step opened again with Change or Edit (set up: the token being changed).
    /** @type {SetupStep | null} */
    this.openStep = null;
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
    this.isOrgSelectOpen = false;
    // The setting selects opened since the section opened: their picks are read back on each tick.
    /** @type {Set<SettingSelect>} */
    this.openSettingSelects = new Set();
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

  // The org select's pick, once it differs from the saved org.
  /** @param {import("gpui-kit").Context} cx */
  applyOrgPick(cx) {
    if (!this.isOrgSelectOpen || !this.config) return;
    const picked = this.readSelect(ORG_SELECT);
    const org = (this.account.orgs ?? []).find((o) => o.slug === picked);
    if (!org || org.slug === this.config.org?.slug) return;
    this.isOrgSelectOpen = false;
    cx.spawn(async (cx) => this.pickOrg({ cx, org }));
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
    this.applyOrgPick(cx);
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
        this.openStep = null;
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

  /** @returns {Element[]} */
  groups() {
    const config = this.config;
    if (!config) return [div().text_size(12).text_color(theme().dim).child("Loading…")];
    const missing = getMissingSetup({ config, hasToken: this.account.status === "connected" });
    return missing === null ? this.setUpGroups(config) : this.setupGroups({ config, missing });
  }

  // ---------- setting up ----------

  // The step bar, each finished step folded to a strip (Change or Edit opens it again), the current
  // step open and the later ones locked.
  /** @param {{ config: OncallConfig, missing: SetupStep }} params @returns {Element[]} */
  setupGroups({ config, missing }) {
    const current = SETUP_STEPS.indexOf(missing);
    const steps = SETUP_STEPS.flatMap((step, index) => {
      if (index > current) return [this.lockedStep(step)];
      if (index === current || this.openStep === step) return this.openStepRows({ config, step, isCurrent: index === current });
      return [this.doneStep({ config, step })];
    });
    return [bay({
      title: "Set up On-call", description: `Step ${current + 1} of ${SETUP_STEPS.length}: ${MISSING_SETUP[missing]}`,
      children: [this.stepBar(current), ...steps],
    })];
  }

  // One segment per step: done green, the current one in the accent, the rest empty.
  /** @param {number} current */
  stepBar(current) {
    const t = theme();
    return h_flex().id("oncall-steps").flex_none().py(2).gap(4).children(SETUP_STEPS.map((step, index) => {
      const color = index < current ? palette(t).success : index === current ? t.accent : t.border;
      return div().id(`oncall-step-bar-${step}`).flex_1().h(4).rounded(2).bg(color);
    }));
  }

  /** @param {SetupStep} step @returns {{ title: string, help: string }} */
  stepText(step) {
    const tracker = this.tracker;
    switch (step) {
      case "token": return { title: `${tracker.name} token`, help: `${tracker.token.help} It stays on this machine, readable only by you.` };
      case "org": return { title: tracker.orgLabel, help: `The ${tracker.name} ${tracker.orgLabel.toLowerCase()} to watch.` };
      case "projects": return { title: tracker.projectsLabel, help: `Only these ${tracker.projectsLabel.toLowerCase()}' issues reach you.` };
      case "repo": return { title: "Repo", help: "The checkout you are on call for: the AI reads it to find the cause and owner, and Continue in Claude opens there." };
      case "domain": return {
        title: "My domain",
        help: `What you are on call for. Before the full triage, a quick ${capitalize(DOMAIN_MODEL)} check (about a cent) drops issues outside it, so other teams' errors never nudge you.`,
      };
      default: {
        /** @type {never} */
        const unknownStep = step;
        return unknownStep;
      }
    }
  }

  // A finished step's one line and its action: Change or Edit opens the step again; the repo and the
  // domain open their picker and dialog at once.
  /** @param {{ config: OncallConfig, step: SetupStep }} params @returns {{ meta: string, isMono: boolean, action: Element }} */
  stepSummary({ config, step }) {
    /** @param {string} label */
    const reopen = (label) => button({ id: `oncall-step-${step}-open`, label, onClick: () => { this.openStep = step; } });
    switch (step) {
      case "token": return { meta: this.account.user ? `Connected as ${this.account.user}` : "Saved on this machine", isMono: false, action: reopen("Change") };
      case "org": return { meta: config.org?.name ?? "", isMono: false, action: reopen("Change") };
      case "projects": {
        const picked = getPickedText(config.projects.map((p) => p.slug));
        return { meta: picked.more > 0 ? `${picked.text} +${picked.more}` : picked.text, isMono: false, action: reopen("Edit") };
      }
      case "repo": return {
        meta: config.codeFolder ?? "", isMono: true,
        action: button({ id: "oncall-step-repo-open", label: "Change…", onClick: (cx) => this.handlePickRepo(cx) }),
      };
      case "domain": return {
        meta: plural({ count: countDomainLines(config.domain), word: "line" }), isMono: false,
        action: button({ id: "oncall-step-domain-open", label: "Edit…", onClick: () => openOncallTextDialog("domain") }),
      };
      default: {
        /** @type {never} */
        const unknownStep = step;
        return unknownStep;
      }
    }
  }

  /** @param {{ config: OncallConfig, step: SetupStep }} params */
  doneStep({ config, step }) {
    const { meta, isMono, action } = this.stepSummary({ config, step });
    return holderStrip({ id: `oncall-step-${step}`, tone: "success", iconName: "check", body: stripBody({ title: this.stepText(step).title, meta, isMono }), trailing: action });
  }

  /** @param {SetupStep} step */
  lockedStep(step) {
    const t = theme();
    const { title, help } = this.stepText(step);
    return holderStrip({
      id: `oncall-step-${step}`, tone: "neutral", iconName: "lock", body: stripBody({ title, meta: help }),
      trailing: div().text_size(11.5).text_color(t.dim).child("Locked"),
    }).opacity(LOCKED_OPACITY);
  }

  // The open step: its strip with what to do, then its controls. A finished step opened again has Done.
  /** @param {{ config: OncallConfig, step: SetupStep, isCurrent: boolean }} params @returns {Element[]} */
  openStepRows({ config, step, isCurrent }) {
    const { title, help } = this.stepText(step);
    const done = button({ id: `oncall-step-${step}-done`, label: "Done", onClick: () => { this.openStep = null; } });
    const repoAction = button({ id: "oncall-repo-pick", label: config.codeFolder ? "Change…" : "Pick folder…", variant: "primary", onClick: (cx) => this.handlePickRepo(cx) });
    const head = holderStrip({
      id: `oncall-step-${step}`, tone: isCurrent ? ACCENT_TONE : "success", iconName: isCurrent ? "chevron-right" : "check",
      body: stripBody({ title, meta: help }), trailing: step === "repo" ? repoAction : isCurrent ? null : done,
    });
    return [head, ...this.stepControls({ config, step })];
  }

  /** @param {{ config: OncallConfig, step: SetupStep }} params @returns {Element[]} */
  stepControls({ config, step }) {
    switch (step) {
      case "token": return this.tokenRows();
      case "org": return [this.orgRow(config)];
      case "projects": return [this.projectsRow(config)];
      case "repo": return [];
      case "domain": return [...(config.codeFolder ? this.profileRows(config) : []), ...this.domainRows(config)];
      default: {
        /** @type {never} */
        const unknownStep = step;
        return unknownStep;
      }
    }
  }

  // ---------- set up ----------

  // Every setting: the switch, then what it knows, how it decides and how it tells you.
  /** @param {OncallConfig} config @returns {Element[]} */
  setUpGroups(config) {
    const tracker = this.tracker;
    return [
      this.onCallStrip(config),
      bay({ title: tracker.name, children: [...this.tokenStrip(), this.orgRow(config), this.projectsRow(config)] }),
      bay({ title: "Repo", description: this.stepText("repo").help, children: this.repoRows(config) }),
      ...(config.codeFolder ? [bay({
        title: "Repo profile",
        description: `What the scan learned: CODEOWNERS and the noise rules of your ${tracker.setupScan.sdkName} setup read exactly, and a short AI summary. Every triage reads it.`,
        children: this.profileRows(config),
      })] : []),
      bay({ title: "My domain", description: this.stepText("domain").help, children: this.domainRows(config) }),
      bay({ title: "Notify me when…", description: "Plain language. The AI checks every issue against these. With none on, any real defect counts.", children: this.ruleRows({ config, list: "nudgeRules" }) }),
      bay({ title: "Never notify me for…", description: "Checked before the rules above. A match never notifies you.", children: this.ruleRows({ config, list: "neverRules" }) }),
      bay({ title: "Before the AI", children: this.checkRows(config) }),
      bay({ title: "Triage", children: this.triageRows(config) }),
      ...this.host.skillGroups(),
      bay({ title: "Notify", children: this.notifyRows(config) }),
    ];
  }

  // [● On call · next check in 21s ⏻]: the strip switches the background service on or off.
  /** @param {OncallConfig} config */
  onCallStrip(config) {
    const service = this.service;
    const isRunning = Boolean(service?.isRunning);
    const isBusy = this.switching !== "idle";
    const nextCheck = formatRelative(service?.nextPollAt ?? null);
    const lastCheck = formatRelative(service?.lastPollAt ?? null);
    /** @returns {string} */
    const getMeta = () => {
      if (!isRunning) return config.isOn ? "On, but the service is not running" : `Off. While on, ${this.tracker.name} is checked in the background, even with Herdr closed.`;
      const check = nextCheck ? `next check ${nextCheck}` : lastCheck ? `last check ${lastCheck}` : "first check running";
      return ["Checked in the background, even with Herdr closed", check, service?.lastError ? null : plural({ count: service?.alertCount ?? 0, word: "issue" })]
        .filter(Boolean).join(" · ");
    };
    const tone = isRunning ? (service?.lastError ? "warning" : "success") : config.isOn ? "danger" : "neutral";
    const control = isBusy
      ? button({ id: "oncall-switch-busy", label: this.switching === "starting" ? "Starting…" : "Stopping…", variant: "busy" })
      : switchMark({ isOn: isRunning });
    const strip = holderStrip({
      id: "oncall-switch", tone, iconName: "oncall", body: stripBody({ title: "On call", meta: getMeta() }), trailing: control,
      onClick: isBusy ? null : (cx) => { cx.spawn(async (cx) => this.switchOncall({ cx, isOn: !isRunning })); },
    });
    const lastError = service?.lastError && isRunning ? service.lastError : null;
    const hint = lastError?.reason === "auth" ? `${this.tracker.name} turned the token down. Change it below.` : lastError?.message ?? "";
    return v_flex().flex_none().gap(4).child(strip)
      .when(lastError !== null, (el) => el.child(statusLine({ id: "oncall-last-error", tone: "warning", text: `Last check failed: ${hint}` })));
  }

  // The token as one strip, Change opening its field and Remove under it.
  tokenStrip() {
    if (this.openStep === "token") {
      return [
        holderStrip({
          id: "oncall-token", tone: "success", iconName: "check", body: stripBody({ title: "Token", meta: "Paste a new token to replace this one." }),
          trailing: button({ id: "oncall-token-done", label: "Done", onClick: () => { this.openStep = null; } }),
        }),
        ...this.tokenRows(),
      ];
    }
    return [holderStrip({
      id: "oncall-token", tone: "success", iconName: "check",
      body: stripBody({ title: "Token", meta: this.account.user ? `Connected as ${this.account.user}` : "Saved on this machine" }),
      trailing: button({ id: "oncall-token-change", label: "Change", onClick: () => { this.openStep = "token"; } }),
    })];
  }

  // The token's states: checking, connected with Remove, could not check; then its field.
  /** @returns {Element[]} */
  tokenRows() {
    const account = this.account;
    const name = this.tracker.name;
    if (account.status === "checking" || account.status === "idle") return [statusLine({ id: "tracker-token-checking", tone: "checking", text: `Checking the ${name} token…` })];
    const connected = account.status === "connected" ? [statusLine({
      id: "tracker-token-connected", tone: "connected", text: account.user ? `Connected as ${account.user}` : "Connected",
      action: button({ id: "tracker-token-remove", label: "Remove", onClick: (cx) => this.handleRemoveToken(cx) }),
    })] : [];
    const failed = account.status === "failed" ? [statusLine({ id: "tracker-token-failed", tone: "warning", text: `Could not check the token: ${account.message ?? "unknown error"}` })] : [];
    return [...connected, ...failed, ...this.tokenField()];
  }

  // [token ••••• ] [Save], the tracker's answer when it turns a token down, and where to make one.
  tokenField() {
    const t = theme();
    const isSaving = this.tokenSave.status === "saving";
    return [
      h_flex().flex_none().gap(6).items_center().on_mouse_down("left", stop)
        .child(div().flex_1().min_w(0).child(fieldBox({
          id: "tracker-token", isFocused: this.host.isFocused("trackerToken"), input: Input.new(this.tokenInput).flex_1().text_size(12).text_color(t.foreground),
        })))
        .child(button({ id: "tracker-token-save", label: isSaving ? "Checking…" : "Save", variant: isSaving ? "busy" : "primary", onClick: (cx) => this.handleSaveToken(cx) })),
      ...(this.tokenSave.status === "failed" ? [div().text_size(11.5).text_color(palette(t).danger).child(this.tokenSave.message ?? "")] : []),
      linkLine({ id: "tracker-token-link", label: this.tracker.token.createLabel, url: this.tracker.token.createUrl }),
    ];
  }

  /** @param {OncallConfig} config */
  orgRow(config) {
    const label = this.tracker.orgLabel;
    const orgs = this.account.orgs ?? [];
    if (orgs.length === 0) return controlRow({ id: "oncall-org", label, help: "This token sees no organizations." });
    return controlRow({
      id: "oncall-org", label,
      control: selectButton({
        id: "oncall-org", text: config.org?.name ?? "Pick one", isEmpty: !config.org,
        onOpen: ({ anchor }) => {
          this.isOrgSelectOpen = true;
          this.host.openSelect({ store: ORG_SELECT, title: label, value: config.org?.slug ?? "", options: orgs.map((o) => ({ value: o.slug, label: o.name })), anchor });
        },
      }),
    });
  }

  // [web +6 ▾]: the panel's multiselect with search; picked ones list first.
  /** @param {OncallConfig} config */
  projectsRow(config) {
    const label = this.tracker.projectsLabel;
    const projects = this.projects;
    if (projects.items.length === 0 && (projects.status === "loading" || projects.status === "idle")) return statusLine({ id: "oncall-projects", tone: "checking", text: "Loading projects…" });
    if (projects.status === "failed" && projects.items.length === 0) return statusLine({ id: "oncall-projects", tone: "warning", text: `Could not load projects: ${projects.message ?? "unknown error"}` });
    return controlRow({
      id: "oncall-projects", label,
      help: `Only these ${label.toLowerCase()}' issues reach you. ${config.projects.length} of ${projects.items.length} picked.`,
      control: selectButton({
        id: "oncall-projects", ...getPickedText(config.projects.map((p) => p.slug)),
        onOpen: ({ anchor }) => {
          this.isProjectSelectOpen = true;
          this.host.openSelect({
            store: PROJECTS_SELECT, title: label, value: config.projects.map((p) => p.id), isMulti: true, anchor,
            options: projects.items.map((p) => ({ value: p.id, label: p.slug })),
          });
        },
      }),
    });
  }

  // The picked repo's path with Change…, or Pick folder….
  /** @param {OncallConfig} config */
  repoRows(config) {
    const t = theme();
    return [holderStrip({
      id: "oncall-repo", tone: config.codeFolder ? "success" : "neutral", iconName: config.codeFolder ? "check" : "branch",
      body: div().truncate().font_family(MONO_FONT).text_size(12).text_color(config.codeFolder ? t.foreground : t.dim).child(config.codeFolder ?? "No repo picked"),
      trailing: button({
        id: "oncall-repo-pick", label: config.codeFolder ? "Change…" : "Pick folder…", variant: config.codeFolder ? "normal" : "primary",
        onClick: (cx) => this.handlePickRepo(cx),
      }),
    })];
  }

  // The summary to read, then Edit… and Rescan beside what the scan found and when.
  /** @param {OncallConfig} config @returns {Element[]} */
  profileRows(config) {
    const t = theme();
    const profile = config.repoProfile;
    const isScanning = this.scan.status === "scanning";
    /** @returns {string} */
    const getStatus = () => {
      if (isScanning) return `Scanning: reading CODEOWNERS and the ${this.tracker.setupScan.sdkName} setup, then a short Haiku read of the repo. About a minute.`;
      if (this.scan.status === "failed") return `Scan failed: ${this.scan.message ?? "unknown error"}`;
      if (!profile) return "Not scanned yet.";
      const owners = profile.codeowners ? plural({ count: profile.codeowners.split("\n").length, word: "CODEOWNERS line" }) : "no CODEOWNERS";
      const cost = profile.costUsd === null ? "" : ` · $${profile.costUsd.toFixed(3)}`;
      const noise = plural({ count: Object.values(profile.noiseRules).flat().length, word: "noise rule" });
      return `scanned ${formatRelative(profile.scannedAt) ?? profile.scannedAt.slice(0, 10)} · ${owners} · ${noise}${cost}`;
    };
    const actions = h_flex().flex_none().gap(6).items_center()
      .when(Boolean(profile), (el) => el.child(button({ id: "oncall-profile-edit", label: "Edit…", onClick: () => openOncallTextDialog("summary") })))
      .when(isScanning, (el) => el.child(svg(SPINNER).size(12).flex_none().text_color(t.working).spin(SPINNER_PERIOD_MS)))
      .when(!isScanning, (el) => el.child(button({ id: "oncall-repo-scan", label: profile ? "Rescan" : "Scan", onClick: (cx) => { void this.runScan(cx); } })))
      .child(div().flex_1().min_w(0).text_size(11.5).text_color(this.scan.status === "failed" ? palette(t).warning : t.dim).child(getStatus()));
    return [...(profile ? [this.textPreview({ id: "oncall-profile", text: profile.summary, isMono: false })] : []), actions];
  }

  // The domain to read, then Edit… (Write domain… while empty) and Test on recent issues with its answer.
  /** @param {OncallConfig} config @returns {Element[]} */
  domainRows(config) {
    const t = theme();
    const colors = palette(t);
    const test = this.domainTest;
    /** @returns {{ text: string, color: string }} */
    const getResult = () => {
      switch (test.status) {
        case "idle": return { text: config.domain ? `${plural({ count: countDomainLines(config.domain), word: "line" })} · the check runs on every new issue` : "Not set yet: On-call starts once it is", color: t.dim };
        case "loading": return { text: "Asking the cheap model about the latest issues…", color: t.dim };
        case "success": return { text: test.text ?? "", color: colors.success };
        case "failed": return { text: test.text ?? "", color: colors.warning };
        default: {
          /** @type {never} */
          const unknownStatus = test.status;
          return unknownStatus;
        }
      }
    };
    const result = getResult();
    const actions = h_flex().flex_none().gap(6).items_center()
      .child(config.domain
        ? button({ id: "oncall-domain-edit", label: "Edit…", onClick: () => openOncallTextDialog("domain") })
        : button({ id: "oncall-domain-write", label: "Write domain…", variant: "primary", onClick: () => openOncallTextDialog("domain") }))
      .when(Boolean(config.domain), (el) => el.child(button({
        id: "oncall-domain-test", label: test.status === "loading" ? "Testing…" : "Test on recent issues", variant: test.status === "loading" ? "busy" : "normal",
        onClick: (cx) => this.handleTestDomain(cx),
      })))
      .child(div().flex_1().min_w(0).text_size(11.5).text_color(result.color).child(result.text));
    return [...(config.domain ? [this.textPreview({ id: "oncall-domain", text: config.domain, isMono: true })] : []), actions, ...this.domainTestLines()];
  }

  // Each recent issue the test asked about: yes, no or unclear, and why.
  domainTestLines() {
    const t = theme();
    const colors = palette(t);
    /** @type {Record<string, string>} */
    const tone = { yes: colors.success, no: colors.danger, unclear: colors.warning };
    return (this.domainTest.lines ?? []).map((line, i) => h_flex().id(`oncall-domain-line-${i}`).px(2).gap(6).items_start()
      .child(div().flex_none().w(DOMAIN_TEST_LABEL_WIDTH).text_size(11.5).font_semibold().text_color(tone[line.mine] ?? t.dim).child(line.mine))
      .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.muted).child(line.text)));
  }

  // The first lines of a long text and "+N more lines"; the whole text opens in its dialog.
  /** @param {{ id: string, text: string, isMono: boolean }} params */
  textPreview({ id, text, isMono }) {
    const t = theme();
    const lines = text.split("\n").filter((l) => l.trim());
    const hidden = lines.length - PREVIEW_LINES;
    return v_flex().id(id).flex_none().px(10).py(6).gap(1).rounded(4).border(1).border_color(t.border).bg(t.background)
      .text_size(12).text_color(t.muted).when(isMono, (el) => el.font_family(MONO_FONT))
      .children(lines.slice(0, PREVIEW_LINES).map((line) => div().truncate().child(line)))
      .when(hidden > 0, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(`+${plural({ count: hidden, word: "more line" })}`)));
  }

  // A rules list: on/off, the rule and ✕; then the field to add one, and suggestions not added yet.
  /** @param {{ config: OncallConfig, list: import("./config.js").RuleList }} params @returns {Element[]} */
  ruleRows({ config, list }) {
    const t = theme();
    const input = list === "nudgeRules" ? this.nudgeInput : this.neverInput;
    const suggestions = (list === "nudgeRules" ? NUDGE_SUGGESTIONS : NEVER_SUGGESTIONS)
      .filter((text) => !config[list].some((r) => r.text.toLowerCase() === text.toLowerCase()));
    const rows = config[list].map((rule) => controlRow({
      id: `rule-${rule.id}`,
      label: h_flex().min_w(0).gap(8).items_center()
        .child(div().id(`rule-switch-${rule.id}`).flex_none().cursor_pointer().tooltip(rule.isOn ? "On: click to turn it off" : "Off: click to turn it on")
          .on_click((_e, cx) => this.saveConfig({ cx, next: toggleRule({ config, list, id: rule.id }) }))
          .child(switchMark({ isOn: rule.isOn })))
        .child(div().min_w(0).text_size(12.5).text_color(rule.isOn ? t.foreground : t.dim).child(rule.text)),
      control: div().id(`rule-remove-${rule.id}`).size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
        .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Remove this rule")
        .on_click((_e, cx) => this.saveConfig({ cx, next: removeRule({ config, list, id: rule.id }) }))
        .child(svg(icon("x")).size(12)),
    }));
    const field = h_flex().flex_none().gap(6).items_center().on_mouse_down("left", stop)
      .child(div().flex_1().min_w(0).child(fieldBox({ id: `rule-${list}`, isFocused: this.host.isFocused(list), input: Input.new(input).flex_1().text_size(12).text_color(t.foreground) })))
      .child(button({ id: `rule-add-${list}`, label: "Add", onClick: (cx) => this.handleAddRule({ cx, list, text: input.value() }) }));
    const chips = h_flex().gap(6).flex_wrap().children(suggestions.map((text) => div().id(`rule-suggest-${list}-${text}`).h(24).px(9).flex().items_center().rounded(12)
      .border(1).border_color(t.border).text_size(11.5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => this.handleAddRule({ cx, list, text }))
      .child(`+ ${text}`)));
    return [...rows, field, ...(suggestions.length ? [chips] : [])];
  }

  // What goes to the AI: the tracker priorities, environments, how often and how far back, and a dry run.
  /** @param {OncallConfig} config @returns {Element[]} */
  checkRows(config) {
    const tracker = this.tracker;
    return [
      controlRow({
        id: "oncall-priorities", label: `${tracker.priorityLabel} for AI`, help: `Issues with another ${tracker.priorityLabel} skip the AI and never notify you.`,
        control: this.settingSelect({ select: "priorities", title: `${tracker.priorityLabel} for AI`, isMulti: true, value: config.aiPriorities, options: PRIORITIES.map((p) => ({ value: p, label: capitalize(p) })) }),
      }),
      controlRow({ id: "oncall-environments", label: "Environments", help: "Only events from these environments, comma separated. Empty: all of them.", control: this.textField({ id: "environments", input: this.envInput }) }),
      controlRow({
        id: "oncall-poll", label: "Check every", help: `How often the service asks ${tracker.name}. A change applies after the next check.`,
        control: this.settingSelect({
          select: "poll", title: "Check every", isMulti: false, value: [String(config.pollMinutes)],
          options: POLL_MINUTES.map((m) => ({ value: String(m), label: m === 1 ? "1 minute" : `${m} minutes` })),
        }),
      }),
      controlRow({
        id: "oncall-catch-up", label: "Look back", help: "Issues seen in this window are checked, also what changed while you were off call.",
        control: this.settingSelect({
          select: "catchUp", title: "Look back", isMulti: false, value: [String(config.catchUpHours)],
          options: CATCH_UP_HOURS.map((h) => ({ value: String(h), label: h === 1 ? "Last hour" : `Last ${h} hours` })),
        }),
      }),
      ...this.previewRows(),
    ];
  }

  // [Preview next check] and its answer: how many issues, what the AI would look at, what is filtered.
  /** @returns {Element[]} */
  previewRows() {
    const t = theme();
    const preview = this.preview;
    const isLoading = preview.status === "loading";
    const row = controlRow({
      id: "oncall-preview", label: "Next check", help: preview.text ?? "See what a check would do, without running the AI.",
      control: button({
        id: "oncall-preview", label: isLoading ? `Checking ${this.tracker.name}…` : "Preview next check", variant: isLoading ? "busy" : "normal",
        onClick: (cx) => this.handlePreview(cx),
      }),
    });
    const lines = (preview.lines ?? []).map((line, i) => div().id(`oncall-preview-${i}`).px(2).text_size(11.5).text_color(t.muted).truncate().child(line));
    return [row, ...lines];
  }

  /** @param {OncallConfig} config @returns {Element[]} */
  triageRows(config) {
    return [
      controlRow({
        id: "oncall-triage-skill", label: "Triage skill",
        help: "The skill that guides the AI's investigation. The default, oncall-triage, ships with gh44-omnia; pick any of your own instead.",
        control: this.triageSkillSelect(config),
      }),
      controlRow({
        id: "oncall-model", label: "AI model", help: "The Claude model that triages. Bigger looks deeper and costs more.",
        control: this.settingSelect({ select: "model", title: "AI model", isMulti: false, value: [config.model], options: MODELS.map((m) => ({ value: m.id, label: `${m.label} · ${m.description}` })) }),
      }),
    ];
  }

  /** @param {OncallConfig} config @returns {Element[]} */
  notifyRows(config) {
    const isTodayOn = isTodayShown(shared(ONCALL_SHOW_TODAY_STORE));
    return [
      controlRow({
        id: "oncall-notify", label: "Notify me for", help: "The severities the AI gives that notify you.",
        control: this.settingSelect({
          select: "notify", title: "Notify me for", isMulti: true, value: config.notifySeverities,
          options: NOTIFY_SEVERITY_OPTIONS.map((v) => ({ value: v, label: capitalize(v) })),
        }),
      }),
      toggleRow({
        id: "oncall-sound", label: "Play a sound", help: "A soft chime with each notification.", isOn: config.isSoundOn,
        onToggle: (cx) => this.saveConfig({ cx, next: { ...config, isSoundOn: !config.isSoundOn } }),
      }),
      h_flex().flex_none().gap(6).items_center()
        .child(button({ id: "oncall-sound-test", label: "Test sound", onClick: () => { void playAlertSound(); } }))
        .child(button({ id: "oncall-toast-test", label: "Send a test notification", onClick: () => this.handleTestNudge(config) })),
      toggleRow({
        id: "oncall-show-today", label: "Show today's numbers", help: "What the On-call tab shows above the list.", isOn: isTodayOn,
        onToggle: () => setShared(ONCALL_SHOW_TODAY_STORE, !isTodayOn),
      }),
    ];
  }

  // [oncall-triage · default ▾]: the panel's select with search over every skill a triage can run:
  // the default (built in) first, then the repo's own skills, then ~/.claude/skills.
  /** @param {OncallConfig} config */
  triageSkillSelect(config) {
    const { installed, repo } = this.skillChoices;
    const options = [...new Set([BUILT_IN_TRIAGE_SKILL, config.triageSkill, ...repo, ...installed])].map((skill) => {
      const source = this.skillSource(skill);
      return { value: skill, label: source ? `${skill} · ${source}` : skill };
    });
    const source = this.skillSource(config.triageSkill);
    const isMissing = source === "not installed";
    return h_flex().gap(6).items_center()
      .when(isMissing, (el) => el.child(listTag({ kind: "notInstalled" })))
      .child(selectButton({
        id: "oncall-triage-skill", text: source && !isMissing ? `${config.triageSkill} · ${source}` : config.triageSkill,
        onOpen: ({ anchor }) => {
          this.isSkillSelectOpen = true;
          this.host.openSelect({ store: TRIAGE_SKILL_SELECT, title: "Triage skill", value: config.triageSkill, options, anchor });
        },
      }));
  }

  // A select: its picks (a multiselect: the first and "+N") and a chevron. The menu opens under it.
  /** @param {{ select: SettingSelect, title: string, isMulti: boolean, value: string[], options: { value: string, label: string }[] }} params */
  settingSelect({ select, title, isMulti, value, options }) {
    const labels = options.filter((o) => value.includes(o.value)).map((o) => o.label);
    return selectButton({
      id: `oncall-${select}`, ...getPickedText(labels),
      onOpen: ({ anchor }) => {
        this.openSettingSelects.add(select);
        this.host.openSelect({ store: SETTING_SELECTS[select], title, value: isMulti ? value : value[0] ?? "", options, isMulti, anchor });
      },
    });
  }

  // A text setting, saved on Enter; "↵ to save" shows while it differs from the saved value.
  /** @param {{ id: "environments", input: import("gpui-base").InputState }} params */
  textField({ id, input }) {
    const t = theme();
    return div().w(ENVIRONMENTS_FIELD_WIDTH).flex_none().on_mouse_down("left", stop).child(fieldBox({
      id, isFocused: this.host.isFocused(id), input: Input.new(input).flex_1().text_size(12).text_color(t.foreground),
      trailing: this.isUnsaved(id) ? div().flex_none().px(6).text_size(11).text_color(palette(t).warning).child("↵ to save") : null,
    }));
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
  /** @param {import("gpui-kit").Context} cx */
  handleTestDomain(cx) {
    if (this.domainTest.status === "loading") return;
    this.domainTest = { status: "loading" };
    cx.spawn(async (cx) => {
      const r = await testDomain();
      this.domainTest = r.status === "success"
        ? {
          status: "success", text: `${r.results.filter((x) => x.mine === "yes").length} of ${r.results.length} latest issues are yours · cost $${r.costUsd.toFixed(3)}`,
          lines: r.results.map((x) => ({ mine: x.mine, text: `${x.shortId}: ${x.reason}` })),
        }
        : { status: "failed", text: r.message ?? "The test failed" };
      cx.notify();
    });
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
  /** @param {{ cx: import("gpui-kit").Context, list: import("./config.js").RuleList, text: string }} params */
  handleAddRule({ cx, list, text }) {
    if (!this.config || !text.trim()) return;
    const id = `${list === "nudgeRules" ? "nudge" : "never"}-${Date.now().toString(36)}`;
    this.saveConfig({ cx, next: addRule({ config: this.config, list, text, id }) });
    (list === "nudgeRules" ? this.nudgeInput : this.neverInput).set_value("");
  }
}

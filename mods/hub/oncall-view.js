// The On-call tab: today's numbers, what the AI decided, and an all-clear while nothing needs you.
// It reads the files the background service writes, toasts new nudges, and keeps the service's
// heartbeat fresh so alerts show in Herdr while it is open. Rows use the panel's own row pieces.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextView } from "gpui-base";
import { theme, shared, setShared, notify, run, closeOverlay, props, spaces } from "herdr";
import { icon, palette, stop, GUTTER, MONO_FONT } from "./ui.js";
import { getMissingSetup } from "./oncall-config.js";
import { getOncallSituation, getCaseActions, getDefaultSkill, shortSkill, ASK_ACTION, CONTINUE_ACTION } from "./settings.js";
import {
  ONCALL_VIEWS, ONCALL_FILTERS_STORE, ONCALL_DEFAULTS, SEVERITY_OPTIONS, DECIDED_BY_OPTIONS, TIME_OPTIONS, SEEN_OPTIONS, filterDecisions, getTodayStats, getNewNudges, needsAttention, seenKey, formatCost, getDecidedBy, isRerunPending, getCountdownIcon, ONCALL_SHOW_TODAY_STORE, isTodayShown, isCheckPending, splitReport,
} from "./oncall-decisions.js";
import {
  loadOncallConfig, loadServiceStatus, loadDecisions, hasSentryToken, touchHeartbeat, playAlertSound,
  requestCheckNow, requestRerun, openReport, continueInClaude, startOncall,
} from "./oncall.js";

/** @typedef {import("./oncall-decisions.js").Decision} Decision */
/** @typedef {import("./oncall-decisions.js").OncallViewId} OncallViewId */

const STORE = {
  seen: "hub.oncall.seen",
  // The newest decision already toasted; older nudges never toast again.
  toastedAt: "hub.oncall.toastedAt",
  // issueId -> when a re-run was asked for: its row spins until a newer decision lands.
  rerunning: "hub.oncall.rerunning",
};
// Files are read this often while the tab shows, and this often in the background (for toasts).
const READ_SHOWN_MS = 3_000;
const READ_HIDDEN_MS = 15_000;
const HEARTBEAT_MS = 10_000;
const KEEP_SEEN = 500;
const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const SPINNER = "mods/workspace-chrome/spinner.svg";
// The all-clear badge and its rings.
const BADGE_SIZE = 64;
const RING_FROM = 64;
const RING_TO = 150;
const RING_PERIOD_MS = 2_600;
const HERO_HEIGHT = 180;
// Severity: its icon, tone and toast level.
/** @type {Record<string, { icon: string, tone: string, level: "error" | "warning" | "info" }>} */
const SEVERITY_LOOK = {
  critical: { icon: "priority-1", tone: "danger", level: "error" },
  high: { icon: "priority-2", tone: "warning", level: "warning" },
  medium: { icon: "priority-3", tone: "neutral", level: "info" },
  low: { icon: "priority-4", tone: "quiet", level: "info" },
  ignore: { icon: "ci-none", tone: "quiet", level: "info" },
};
const OUTCOME_TIP = { reported: "Needs attention", ignored: "Not for you", held: "Waiting for impact", failed: "Triage failed" };

// Kept at module scope, so a new panel copy shows the last read at once.
const state = {
  /** @type {import("./oncall-config.js").OncallConfig | null} */
  config: null,
  hasToken: false,
  /** @type {import("./oncall.js").ServiceStatus | null} */
  service: null,
  /** @type {Decision[]} */
  decisions: [],
  readAt: 0,
  heartbeatAt: 0,
  isReading: false,
  isStarting: false,
  // The last Check now: when, and the next check time the service had then.
  /** @type {{ at: number, nextPollAt: string | null } | null} */
  checkRequest: null,
};
const isChecking = () => isCheckPending({ request: state.checkRequest, nextPollAt: state.service?.nextPollAt ?? null, now: Date.now() });

/** @param {number} ms */
const formatSpan = (ms) => {
  if (ms < MINUTE_MS) return `${Math.max(0, Math.round(ms / SECOND_MS))}s`;
  if (ms < HOUR_MS) return `${Math.round(ms / MINUTE_MS)}m`;
  if (ms < DAY_MS) return `${Math.round(ms / HOUR_MS)}h`;
  return `${Math.round(ms / DAY_MS)}d`;
};

const getSeen = () => {
  const seen = shared(STORE.seen);
  return Array.isArray(seen) ? seen : [];
};
/** @param {Decision[]} decisions */
const markSeen = (decisions) => {
  const seen = getSeen();
  const added = decisions.map(seenKey).filter((k) => !seen.includes(k));
  if (added.length > 0) setShared(STORE.seen, [...seen, ...added].slice(-KEEP_SEEN));
};
/** @param {Decision} decision */
const markUnseen = (decision) => setShared(STORE.seen, getSeen().filter((k) => k !== seenKey(decision)));
/** @returns {Record<string, string>} */
const getRerunning = () => {
  const saved = shared(STORE.rerunning);
  return saved && typeof saved === "object" && !Array.isArray(saved)
    ? Object.fromEntries(Object.entries(saved).filter(([, at]) => typeof at === "string"))
    : {};
};
/** @param {Decision} decision */
const markRerunning = (decision) => setShared(STORE.rerunning, { ...getRerunning(), [decision.issueId]: new Date().toISOString() });
// The saved filters over the defaults; a value of the wrong kind falls back to its default.
/** @returns {import("./oncall-decisions.js").OncallFilters} */
const getOncallFilters = () => {
  const saved = shared(ONCALL_FILTERS_STORE);
  const s = saved && typeof saved === "object" && !Array.isArray(saved) ? Object.fromEntries(Object.entries(saved)) : {};
  /** @param {unknown} value */
  const texts = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
  return {
    view: ONCALL_VIEWS.find((v) => v.id === s.view)?.id ?? ONCALL_DEFAULTS.view,
    severities: texts(s.severities),
    projects: texts(s.projects),
    decidedBy: texts(s.decidedBy),
    time: TIME_OPTIONS.find((o) => o.value === s.time)?.value ?? ONCALL_DEFAULTS.time,
    seen: SEEN_OPTIONS.find((o) => o.value === s.seen)?.value ?? ONCALL_DEFAULTS.seen,
  };
};

/** @typedef {"report" | "claude" | "seen" | "unseen" | "rerun" | "sentry"} OncallActionId */
/** @typedef {{ claudePath: string | null, codeFolder: string | null }} RunConfig */
// What every row of one render reads.
/** @typedef {{ rowSkills: import("./settings.js").Skills, rerunning: Record<string, string>, runConfig: RunConfig, currentShortId: string | null, now: number }} RowContext */
// Rows drawn at first and added by each "Show more".
const ROW_PAGE = 50;
/** @typedef {{ decision: Decision, config: RunConfig, actions: { id: OncallActionId, label: string, icon: string }[], skills: string[] }} OncallMenu */
const ASK = ASK_ACTION;

/** @param {{ decision: Decision, isSeen: boolean }} params @returns {{ id: OncallActionId, label: string, icon: string }[]} */
export function getOncallActions({ decision, isSeen }) {
  /** @type {{ id: OncallActionId, label: string, icon: string }[]} */
  const actions = [];
  if (decision.reportPath) actions.push({ id: "report", label: "View report", icon: "resume" });
  if (needsAttention(decision)) actions.push(isSeen ? { id: "unseen", label: "Mark as unseen", icon: "check" } : { id: "seen", label: "Mark as seen", icon: "check" });
  actions.push({ id: "rerun", label: "Re-run triage", icon: "refresh" }, { id: "sentry", label: "Open in Sentry", icon: "oncall" });
  return actions;
}

// What a skill or Ask gets: the issue, and the AI's report when there is one.
/** @param {Decision} d */
const describeIssue = (d) => `Sentry issue ${d.shortId} (${d.title}): ${d.url}${d.reportPath ? `. The on-call triage report is at ${d.reportPath}` : ""}`;

// A skill (or Ask) on an issue, in a new Claude tab in the code folder (else where Herdr starts tabs).
/** @param {{ skill: string, decision: Decision, config: RunConfig }} params */
export function runSkillOnIssue({ skill, decision, config }) {
  if (skill === CONTINUE_ACTION) {
    if (continueInClaude({ decision, config })) markSeen([decision]);
    else notify({ title: `${decision.shortId} has no Claude session`, body: "Only issues the AI looked at have one.", level: "info" });
    return;
  }
  const prompt = skill === ASK
    ? `Read ${describeIssue(decision)}. Then wait for my questions. Change no code.`
    : `/${skill} ${describeIssue(decision)}`;
  const name = `${decision.shortId} ${skill === ASK ? "ask" : skill.replace(/^gh44-/, "")}`;
  const space = spaces().find((sp) => sp.active)?.id;
  run("tab.new", { name, argv: [config.claudePath ?? "claude", prompt], ...(space ? { space } : {}), ...(config.codeFolder ? { folder: config.codeFolder } : {}) });
  markSeen([decision]);
}

// One action on one row. The popup runs it itself; nothing is handed to the panel.
/** @param {{ cx: import("gpui-kit").Context, action: OncallActionId, decision: Decision, config: RunConfig }} params */
export async function runOncallAction({ cx, action, decision, config }) {
  switch (action) {
    case "report":
      if (openReport(decision)) markSeen([decision]);
      else notify({ title: `${decision.shortId} has no report`, body: "Only issues the AI looked at have one. Re-run the triage to make one.", level: "info" });
      return;
    case "claude":
      if (continueInClaude({ decision, config })) markSeen([decision]);
      else notify({ title: `${decision.shortId} has no Claude session`, level: "info" });
      return;
    case "seen":
      markSeen([decision]);
      return;
    case "unseen":
      markUnseen(decision);
      return;
    case "rerun": {
      const r = await requestRerun(decision.issueId);
      if (r.status === "success") markRerunning(decision);
      else notify({ title: "Could not ask for a re-run", body: r.message, level: "warning" });
      return;
    }
    case "sentry":
      cx.open_url(decision.url);
      return;
    default: {
      /** @type {never} */
      const unknownAction = action;
      return unknownAction;
    }
  }
}

// The popup's rows: the row's actions, then every installed skill (searchable) and Ask.
/** @param {{ hub: any, menu: { oncall: OncallMenu } }} params */
export function oncallMenuRows({ hub, menu }) {
  const t = theme();
  const { decision, config, actions, skills } = menu.oncall;
  const close = () => closeOverlay(props().overlay);
  // Triaging now (a re-run waits, or the AI is on it): Re-run spins and can't be clicked again.
  const isTriaging = isRerunPending({ decision, requestedAt: getRerunning()[decision.issueId], now: Date.now() })
    || state.service?.current?.shortId === decision.shortId;
  const actionRows = actions.filter((a) => hub.matchesMenuSearch(a.label)).map((a) => hub.menuRow({
    id: `oncall-${a.id}`, label: a.id === "rerun" && isTriaging ? "Triaging…" : a.label, actionIcon: a.icon,
    isDisabled: a.id === "rerun" && isTriaging, isLoading: a.id === "rerun" && isTriaging,
    /** @param {import("gpui-kit").Context} cx */
    onClick: (cx) => {
      // The re-run writes a file first: the popup stays until it is written, or closing would cancel it.
      cx.spawn(async (/** @type {import("gpui-kit").Context} */ cx) => {
        await runOncallAction({ cx, action: a.id, decision, config });
        close();
      });
    },
  }));
  /** @param {string} skill */
  const labelOf = (skill) => (skill === ASK ? "Ask Claude about it" : skill === CONTINUE_ACTION ? "Continue in Claude" : `/${skill}`);
  const skillRows = skills.filter((s) => hub.matchesMenuSearch(labelOf(s))).map((skill) => hub.menuRow({
    id: `oncall-skill-${skill}`, label: labelOf(skill), actionIcon: "play",
    onClick: () => {
      runSkillOnIssue({ skill, decision, config });
      close();
    },
  }));
  const title = div().flex_none().px(9).pt(8).pb(2).text_size(11).font_semibold().text_color(t.muted).child("Run");
  return [...(skillRows.length ? [title, ...skillRows, hub.menuSeparator("oncall-skills")] : []), ...actionRows];
}

export class OncallView {
  /** @param {{ hub: any }} params */
  constructor({ hub }) {
    this.hub = hub;
    this.search = InputState.new({ placeholder: "Search ID, title or project" });
    this.search.on("change", (_e, cx) => { this.rowLimit = ROW_PAGE; cx.notify(); });
    // How many rows the list draws; "Show more" adds ROW_PAGE.
    this.rowLimit = ROW_PAGE;
    this.search.on("focus", (_e, cx) => { hub.isSearchFocused = true; cx.notify(); });
    this.search.on("blur", (_e, cx) => { hub.isSearchFocused = false; cx.notify(); });
  }

  // Every panel tick: keep the heartbeat fresh, read the service's files now and then, toast new
  // nudges, and redraw each second while the tab shows (the next-check countdown).
  /** @param {{ cx: import("gpui-kit").Context, isShown: boolean }} params */
  tick({ cx, isShown }) {
    const now = Date.now();
    if (state.config?.isOn && now - state.heartbeatAt > HEARTBEAT_MS) {
      state.heartbeatAt = now;
      void touchHeartbeat();
    }
    const every = isShown ? READ_SHOWN_MS : READ_HIDDEN_MS;
    if (!state.isReading && now - state.readAt > every) {
      state.isReading = true;
      state.readAt = now;
      cx.spawn(async (cx) => {
        try {
          await this.read();
        } finally {
          state.isReading = false;
          cx.notify();
        }
      });
    }
    if (isShown) cx.notify();
  }

  async read() {
    const [config, hasToken, service, decisions] = await Promise.all([loadOncallConfig(), hasSentryToken(), loadServiceStatus(), loadDecisions()]);
    Object.assign(state, { config, hasToken, service, decisions });
    this.toastNewNudges();
  }

  // A toast per new nudge since the last one toasted. The very first read only remembers where it is.
  toastNewNudges() {
    const since = shared(STORE.toastedAt);
    const newest = state.decisions[0]?.decidedAt ?? null;
    if (typeof since !== "string") {
      if (newest) setShared(STORE.toastedAt, newest);
      return;
    }
    const nudges = getNewNudges({ decisions: state.decisions, since });
    if (nudges.length === 0) return;
    setShared(STORE.toastedAt, nudges[0].decidedAt);
    for (const d of nudges.slice().reverse()) {
      notify({
        title: `${(d.severity ?? "").toUpperCase()} · ${d.shortId}`,
        body: d.summary,
        level: SEVERITY_LOOK[d.severity ?? "low"]?.level ?? "info",
        action: { name: "hub.oncall" },
      });
    }
    if (state.config?.isSoundOn) void playAlertSound();
  }

  /** @returns {number | null} */
  unseenCount() {
    if (!state.config) return null;
    return getTodayStats({ decisions: state.decisions, seen: getSeen(), now: new Date() }).unseen;
  }

  // ---------- view ----------

  /** @param {{ openSettings: (cx: import("gpui-kit").Context) => void }} params */
  render({ openSettings }) {
    const t = theme();
    const config = state.config;
    if (!config) return this.hub.skeleton();
    const missing = getMissingSetup({ config, hasToken: state.hasToken });
    if (missing) {
      return this.hero({
        tone: "neutral", iconName: "oncall", title: "Set up On-call",
        body: "Connect Sentry, pick your projects and tell the AI what matters to you. It checks in the background and nudges you only for that.",
        action: { label: "Open settings", onClick: openSettings },
      });
    }
    // Off call: nothing but the way back on.
    if (!config.isOn && !state.service?.isRunning) {
      return this.hero({
        tone: "neutral", iconName: "oncall", title: "Off call",
        body: "No checks and no nudges until you go on call.",
        action: { label: state.isStarting ? "Starting…" : "Go on call", onClick: (cx) => this.handleGoOnCall(cx) },
      });
    }
    const filters = getOncallFilters();
    const seen = getSeen();
    const search = this.search.value();
    const shown = filterDecisions({ decisions: state.decisions, filters, search, seen });
    const defs = this.filterDefs(filters);
    const hasFilters = defs.some((def) => {
      const value = filters[def.field];
      return Array.isArray(value) ? value.length > 0 : value !== ONCALL_DEFAULTS[def.field];
    });
    const isAllClear = filters.view === "attention" && shown.length === 0 && !search.trim() && !hasFilters;
    // What every row reads, worked out once per render: it re-renders every second.
    /** @type {RowContext} */
    const context = {
      rowSkills: this.hub.getOncallSkills(),
      rerunning: getRerunning(),
      runConfig: { claudePath: config.claudePath ?? null, codeFolder: config.codeFolder ?? null },
      currentShortId: state.service?.current?.shortId ?? null,
      now: Date.now(),
    };
    const rows = shown.slice(0, this.rowLimit).map((d) => this.entry({ decision: d, isSeen: seen.includes(seenKey(d)), context }));
    const hiddenCount = shown.length - rows.length;
    this.hub.visible.oncall = rows.map((r, index) => ({ ...r, index: index + 1 }));
    return v_flex().flex_1().min_h(0)
      .child(v_flex().flex_none().px(GUTTER).pt(12).pb(10).gap(10).border_b(1).border_color(t.border)
        .child(this.hub.searchRow({ store: ONCALL_FILTERS_STORE, scopeDef: this.viewDef(seen), state: this.search, defs }))
        .child(this.statusBar({ config }))
        .when(isTodayShown(shared(ONCALL_SHOW_TODAY_STORE)), (el) => el.child(this.statTiles(seen))))
      // All clear sits in the middle of the free space; a list scrolls from the top.
      .when(isAllClear, (el) => el.child(v_flex().id("oncall-list").flex_1().min_h(0)
        .on_mouse_down("left", () => this.hub.handle.focus())
        .child(v_flex().flex_1().min_h(0).justify_center().child(this.allClear()))))
      .when(!isAllClear, (el) => el.child(v_flex().id("oncall-list").flex_1().min_h(0).pt(12).pb(4).overflow_y_scrollbar().track_scroll(this.hub.scroll)
        .on_mouse_down("left", () => this.hub.handle.focus())
        .children(rows.length ? rows.map((r) => r.element) : [this.hub.message({ title: "Nothing here", body: hasFilters || search.trim() ? "No decisions match these filters." : "No decisions in this view yet." })])
        .when(hiddenCount > 0, (list) => list.child(this.showMoreRow(hiddenCount)))));
  }

  // ● Listening to 5 projects · next check in 29s · [Check now] [Go on call]
  /** @param {{ config: import("./oncall-config.js").OncallConfig }} params */
  statusBar({ config }) {
    const t = theme();
    const colors = palette(t);
    const service = state.service;
    const isRunning = Boolean(service?.isRunning);
    const projects = `${config.projects.length} project${config.projects.length === 1 ? "" : "s"}`;
    const nextIn = service?.nextPollAt ? Date.parse(service.nextPollAt) - Date.now() : null;
    // The issue the AI triages right now, in place of the countdown.
    const current = isRunning && !service?.lastError ? service?.current ?? null : null;
    const listening = `Listening to ${projects}${nextIn !== null && nextIn > 0 ? ` · next check in ${formatSpan(nextIn)}` : ""}`;
    const text = isRunning
      ? service?.lastError ? `Last check failed: ${service.lastError.message}` : current ? `Triaging ${current.shortId}: ${current.title} · ${projects}` : listening
      : config.isOn ? "On call, the service is starting…" : `Off call · ${projects} set up`;
    const dot = isRunning ? (service?.lastError ? colors.warning : colors.success) : t.dim;
    // Running and fine: a ring that drains until the next check. Else a dot in the state's color.
    const isCountingDown = !current && isRunning && !service?.lastError && nextIn !== null && nextIn > 0;
    return h_flex().id("oncall-status").h(26).gap(8).items_center()
      .when(Boolean(current), (el) => el.tooltip(current ? `The AI is triaging ${current.shortId}: ${current.title}` : "")
        .child(svg(SPINNER).size(12).flex_none().text_color(t.working).spin(900)))
      .when(isCountingDown, (el) => el.child(svg(icon(getCountdownIcon({ msLeft: nextIn ?? 0, periodMs: config.pollMinutes * MINUTE_MS }))).size(12).flex_none().text_color(colors.success)))
      .when(!isCountingDown && !current, (el) => el.child(div().size(8).flex_none().rounded(4).bg(dot)))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(service?.lastError ? colors.warning : t.muted).child(text))
      .when(isRunning, (el) => el.child(this.smallButton({ id: "oncall-check-now", label: isChecking() ? "Checking…" : "Check now", isLoading: isChecking(), onClick: (cx) => this.handleCheckNow(cx) })))
      .when(!isRunning && !config.isOn, (el) => el.child(this.smallButton({ id: "oncall-go-on", label: state.isStarting ? "Starting…" : "Go on call", isAccent: true, onClick: (cx) => this.handleGoOnCall(cx) })));
  }

  /** @param {import("gpui-kit").Context} cx */
  handleCheckNow(cx) {
    if (isChecking()) return;
    state.checkRequest = { at: Date.now(), nextPollAt: state.service?.nextPollAt ?? null };
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await requestCheckNow();
      if (r.status === "success") return;
      state.checkRequest = null;
      notify({ title: "Could not ask for a check", body: r.message, level: "warning" });
      cx.notify();
    });
  }

  /** @param {import("gpui-kit").Context} cx */
  handleGoOnCall(cx) {
    if (!state.config || state.isStarting) return;
    state.isStarting = true;
    cx.notify();
    const config = state.config;
    cx.spawn(async (cx) => {
      const r = await startOncall(config);
      state.isStarting = false;
      if (r.status === "success") state.config = r.config;
      else notify({ title: "Could not start On-call", body: r.message, level: "warning" });
      state.readAt = 0;
      cx.notify();
    });
  }

  /** @param {{ id: string, label: string, onClick: (cx: import("gpui-kit").Context) => void, isAccent?: boolean, isLoading?: boolean }} params */
  smallButton({ id, label, onClick, isAccent = false, isLoading = false }) {
    const t = theme();
    return div().id(id).h(24).px(10).gap(6).flex_none().flex().items_center().rounded(6).border(1).border_color(isAccent ? t.accent : t.border)
      .text_size(12).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
      .when(isLoading, (el) => el.child(svg(SPINNER).size(11).flex_none().text_color(t.working).spin(900)))
      .child(label);
  }

  // Today: triaged, AI checked, unseen, AI cost.
  /** @param {string[]} seen */
  statTiles(seen) {
    const t = theme();
    const stats = getTodayStats({ decisions: state.decisions, seen, now: new Date() });
    const tiles = [
      { id: "triaged", value: String(stats.triaged), label: "Triaged", tip: `${stats.filtered} filtered without AI` },
      { id: "ai", value: String(stats.investigated), label: "AI checked", tip: "Looked at by the AI today" },
      { id: "unseen", value: String(stats.unseen), label: "Unseen", tip: "Nudges you have not opened", tone: stats.unseen > 0 ? palette(t).danger : null },
      { id: "cost", value: formatCost(stats.costUsd), label: "AI cost", tip: "What today's triage cost" },
    ];
    return v_flex().gap(5)
      .child(div().text_size(10.5).font_semibold().text_color(t.dim).child("TODAY"))
      .child(h_flex().gap(6).children(tiles.map((tile) => v_flex().id(`oncall-stat-${tile.id}`).flex_1().min_w(0).px(9).py(7).gap(1).rounded(7)
        .bg(t.surface).border(1).border_color(t.border).tooltip(tile.tip)
        .child(div().text_size(16).font_semibold().text_color(tile.tone ?? t.foreground).truncate().child(tile.value))
        .child(div().text_size(11).text_color(t.muted).truncate().child(tile.label)))));
  }

  // The scope select in the search box: Needs you, All, Filtered, each with its count (unseen
  // for Needs you while some are).
  /** @param {string[]} seen */
  viewDef(seen) {
    const unseen = getTodayStats({ decisions: state.decisions, seen, now: new Date() }).unseen;
    /** @param {OncallViewId} view */
    const count = (view) => (view === "attention" && unseen > 0 ? `${unseen} new` : String(filterDecisions({ decisions: state.decisions, filters: { view }, search: "" }).length));
    return { title: "Show", field: "view", isMulti: false, options: ONCALL_VIEWS.map((v) => ({ value: v.id, label: `${v.label} · ${count(v.id)}` })) };
  }

  // The Filters menu: like the GitHub and Linear tabs', over the decisions on disk.
  /** @param {import("./oncall-decisions.js").OncallFilters} filters */
  filterDefs(filters) {
    // The projects picked in settings, and any older decisions came from.
    const picked = state.config?.projects.map((p) => p.slug) ?? [];
    const projects = [...new Set([...picked, ...state.decisions.map((d) => d.project), ...filters.projects].filter(Boolean))].sort();
    /** @type {{ title: string, field: keyof import("./oncall-decisions.js").OncallFilters, isMulti: boolean, options: { value: string, label: string }[] }[]} */
    const defs = [
      { title: "Severity", field: "severities", isMulti: true, options: SEVERITY_OPTIONS },
      { title: "Project", field: "projects", isMulti: true, options: projects.map((p) => ({ value: p, label: p })) },
      { title: "Decided by", field: "decidedBy", isMulti: true, options: DECIDED_BY_OPTIONS },
      { title: "Time", field: "time", isMulti: false, options: TIME_OPTIONS },
      { title: "Seen", field: "seen", isMulti: false, options: SEEN_OPTIONS },
    ];
    return defs;
  }

  // A pulsing badge with rings going out, "All clear", and what keeps watching.
  allClear() {
    const t = theme();
    const green = palette(t).success;
    const service = state.service;
    const isRunning = Boolean(service?.isRunning);
    /** @param {number} delay */
    const ring = (delay) => div().absolute().rounded(RING_TO).border(1.5).border_color(green)
      .w(RING_FROM).h(RING_FROM)
      .loop("width", { from: RING_FROM, to: RING_TO, period: RING_PERIOD_MS + delay, easing: "ease-out" })
      .loop("height", { from: RING_FROM, to: RING_TO, period: RING_PERIOD_MS + delay, easing: "ease-out" })
      .loop("opacity", { from: 0.55, to: 0, period: RING_PERIOD_MS + delay, easing: "ease-out" });
    const badge = div().size(BADGE_SIZE).rounded(BADGE_SIZE).flex().items_center().justify_center()
      .bg(`${green}26`).border(1).border_color(`${green}66`)
      .child(svg(icon("check")).size(28).text_color(green));
    return v_flex().id("oncall-all-clear").flex_none().pt(18).pb(24).gap(10).items_center()
      .child(div().relative().w_full().h(HERO_HEIGHT).flex().items_center().justify_center()
        .when(isRunning, (el) => el.child(ring(0)).child(ring(700)))
        .child(badge))
      .child(div().text_size(22).font_bold().text_color(t.foreground).child(isRunning ? "All clear" : "Nothing needs you"))
      .child(div().px(24).text_size(12).text_color(t.dim).text_center().child(isRunning ? "Nothing that matches your rules needs you right now." : "Go on call to keep watching in the background."));
  }

  // One row: severity, title, then id, project, kind, impact and age; [▸ report ▾] at the end.
  // "Show 26 more": the list draws ROW_PAGE rows at a time.
  /** @param {number} hiddenCount */
  showMoreRow(hiddenCount) {
    const t = theme();
    return div().id("oncall-show-more").flex_none().mx(GUTTER - 4).my(6).h(28).flex().items_center().justify_center().rounded(6)
      .text_size(12).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { this.rowLimit += ROW_PAGE; cx.notify(); })
      .child(`Show ${Math.min(ROW_PAGE, hiddenCount)} more of ${hiddenCount}`);
  }

  /** @param {{ decision: Decision, isSeen: boolean, context: RowContext }} params */
  entry({ decision, isSeen, context }) {
    const t = theme();
    const colors = palette(t);
    const d = decision;
    const look = d.outcome === "reported" ? SEVERITY_LOOK[d.severity ?? "low"] : d.outcome === "failed" ? { icon: "ci-failing", tone: "danger" } : { icon: "ci-none", tone: "quiet" };
    const isUnseen = needsAttention(d) && !isSeen;
    const actions = getOncallActions({ decision: d, isSeen });
    const { runConfig, rowSkills } = context;
    const age = formatSpan(context.now - Date.parse(d.decidedAt));
    const situation = getOncallSituation(d);
    const skills = getCaseActions({ skills: rowSkills, tab: "oncall", situation }).filter((skill) => skill !== CONTINUE_ACTION || Boolean(d.sessionId));
    const defaultSkill = getDefaultSkill({ skills: rowSkills, tab: "oncall", situation });
    /** @param {string} skill */
    const start = (skill) => runSkillOnIssue({ skill, decision: d, config: runConfig });
    // No default skill: the button opens the report, else Sentry.
    const openAction = d.reportPath ? "report" : "sentry";
    const primary = defaultSkill && skills.includes(defaultSkill)
      ? {
        label: shortSkill(defaultSkill), icon: "play",
        tip: defaultSkill === CONTINUE_ACTION ? "Continue the triage in Claude" : defaultSkill === ASK ? "Ask Claude about it" : `/${defaultSkill} on this issue`,
        /** @param {import("gpui-kit").Context} _cx */
        run: (_cx) => start(defaultSkill),
      }
      : {
        label: openAction, icon: openAction === "report" ? "resume" : "oncall",
        tip: openAction === "report" ? "Open the AI's report beside your terminal" : "Open in Sentry",
        /** @param {import("gpui-kit").Context} cx */
        run: (cx) => { cx.spawn(async (cx) => { await runOncallAction({ cx, action: openAction, decision: d, config: runConfig }); cx.notify(); }); },
      };
    const id = d.shortId;
    // A re-run waiting for its new decision, or the AI on this issue right now: the button spins.
    const isRerunning = isRerunPending({ decision: d, requestedAt: context.rerunning[d.issueId], now: context.now }) || context.currentShortId === d.shortId;
    const button = isRerunning
      ? { label: "triaging", icon: "refresh", isLoading: true, tip: "Re-running the triage", run: () => {} }
      : primary;
    const decidedBy = getDecidedBy(d);
    const element = this.hub.row({
      id: `oncall-${d.issueId}`,
      title: d.title,
      isTitleDim: d.outcome !== "reported",
      rail: look.tone,
      status: { icon: look.icon, color: colors[look.tone], tip: d.severity ? `${d.severity} · ${OUTCOME_TIP[d.outcome]}` : OUTCOME_TIP[d.outcome] },
      chips: [
        ...(isUnseen ? [{ id: `${id}-new`, label: "new", tone: "danger" }] : []),
        { id: `${id}-ref`, label: d.shortId, iconName: "oncall", tone: "quiet", isMono: true, url: d.url, tip: "Open in Sentry" },
        { id: `${id}-decided`, label: decidedBy, tone: "neutral", tip: `Decided by ${decidedBy}: ${d.summary}` },
        ...(d.project ? [{ id: `${id}-project`, label: d.project, tone: "neutral" }] : []),
        ...(d.kind === "regressed" || d.kind === "escalating" ? [{ id: `${id}-kind`, label: d.kind, tone: "warning" }] : []),
        { id: `${id}-impact`, label: `${d.count} ev · ${d.userCount} users`, tone: "quiet", tip: "Events and users" },
        { id: `${id}-summary`, label: d.summary, tone: "quiet", tip: d.matchedRule ? `Matches: ${d.matchedRule}` : d.summary },
        { id: `${id}-age`, label: age, tone: "quiet", tip: `Decided ${new Date(d.decidedAt).toLocaleString()}` },
      ],
      primary: button,
      menu: { oncall: { decision: d, config: runConfig, actions, skills } },
    });
    return { id: `oncall-${d.issueId}`, url: d.url, element, primary: button.run, actions: skills, start };
  }

  // The "hero" for set up: an icon, a title, a line and one button.
  /** @param {{ tone: string, iconName: string, title: string, body: string, action: { label: string, onClick: (cx: import("gpui-kit").Context) => void } }} params */
  hero({ tone, iconName, title, body, action }) {
    const t = theme();
    const color = palette(t)[tone];
    return v_flex().flex_1().min_h(0).px(24).gap(10).items_center().justify_center()
      .child(div().size(BADGE_SIZE).rounded(BADGE_SIZE).flex().items_center().justify_center().bg(t.surface).border(1).border_color(t.border)
        .child(svg(icon(iconName)).size(26).text_color(color)))
      .child(div().text_size(18).font_bold().text_color(t.foreground).child(title))
      .child(div().text_size(12).text_color(t.dim).text_center().child(body))
      .child(this.smallButton({ id: "oncall-hero-action", label: action.label, isAccent: true, onClick: action.onClick }));
  }
}

// The report pane (`pane.split` with props.report): the AI's markdown, with Sentry one click away.
export class ReportView {
  /** @param {{ path: string, title: string, url: string }} report */
  constructor(report) {
    this.report = report;
    /** @type {string | null} */
    this.text = null;
  }

  /** @param {import("gpui-kit").Context} cx @param {(path: string) => Promise<string | null>} load */
  load(cx, load) {
    cx.spawn(async (cx) => {
      this.text = (await load(this.report.path)) ?? "The report is gone. Re-run the triage to write a new one.";
      cx.notify();
    });
  }

  render() {
    const t = theme();
    return v_flex().id("oncall-report").size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .child(h_flex().flex_none().h(36).px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(svg(icon("oncall")).size(14).text_color(t.accent))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_medium().child(this.report.title))
        .child(div().id("report-sentry").h(24).px(10).flex().items_center().rounded(6).border(1).border_color(t.border).text_size(12)
          .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => cx.open_url(this.report.url)).child("Open in Sentry")))
      .child(div().id("oncall-report-body").flex_1().min_h(0).overflow_y_scrollbar().px(18).py(14).text_size(13)
        .child(this.text === null ? div().text_color(t.dim).child("Loading the report…") : this.body(this.text)));
  }

  // The markdown, with each diff block drawn as a coloured diff.
  /** @param {string} text */
  body(text) {
    return v_flex().gap(10).children(splitReport(text).map((part, i) => (part.kind === "markdown"
      ? TextView.markdown(`oncall-report-md-${i}`, part.text)
      : this.diffBlock({ id: `oncall-report-diff-${i}`, lines: part.lines }))));
  }

  // Removed lines on red, added on green, file and hunk lines dimmed; one line per row, scrolling sideways.
  /** @param {{ id: string, lines: { kind: import("./oncall-decisions.js").DiffLineKind, text: string }[] }} params */
  diffBlock({ id, lines }) {
    const t = theme();
    const colors = palette(t);
    /** @param {import("./oncall-decisions.js").DiffLineKind} kind */
    const look = (kind) => {
      switch (kind) {
        case "add": return { bg: `${colors.success}26`, color: colors.success };
        case "remove": return { bg: `${colors.danger}26`, color: colors.danger };
        case "file": return { bg: null, color: t.dim };
        case "hunk": return { bg: null, color: t.muted };
        case "context": return { bg: null, color: t.foreground };
        default: {
          /** @type {never} */
          const unknownKind = kind;
          return unknownKind;
        }
      }
    };
    return v_flex().id(id).flex_none().py(6).rounded(6).border(1).border_color(t.border).bg(t.surface).overflow_x_scrollbar()
      .font_family(MONO_FONT).text_size(12)
      .children(lines.map((line, i) => {
        const { bg, color } = look(line.kind);
        return div().id(`${id}-${i}`).flex_none().min_w_full().px(12).py(1).whitespace_nowrap().text_color(color)
          .when(Boolean(bg), (el) => el.bg(bg ?? ""))
          .child(line.text || " ");
      }));
  }
}

// Omnia panel: GitHub PRs of the current repo and Linear issues, with filters
// and a split button that starts a gh44 skill in a new Claude tab.
// The same mod opened as a popup (props().menu) draws the dropdown menus.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, ScrollHandle, HoverCard } from "gpui-base";
import { theme, run, focused, layout, spaces, panes, shared, setShared, openOverlay, closeOverlay, props, checking, nextCommand, home, notify } from "herdr";
import {
  GITHUB_DEFAULTS, LINEAR_DEFAULTS, GITHUB_SCOPES, LINEAR_SCOPES, CI_OPTIONS, PRIORITY_OPTIONS, UNASSIGNED,
  REVIEW_OPTIONS, SORT_OPTIONS, LINEAR_SORT_OPTIONS, NO_ASSIGNEE,
  filterPullRequests, filterIssues, groupIssuesByState, toOptions, getAuthorOptions, buildIssueFilter, getProjectOptions, buildPullRequestQuery,
  getMyReviewState, isReviewScope, groupPullRequests, isGithubQuery, isMyPullRequest, getPullRequestGroup, PULL_REQUEST_GROUPS,
} from "./filters.js";
import {
  PAGE_SIZE, loadPullRequests, loadRepoName, loadRepoId, loadRepoLabels, loadRepoUsers, loadMyTeams, loadGithubLogin,
  loadWorktrees, loadMergedWorktrees, removeWorktree, nudgeReviewers,
} from "./github.js";
import { loadIssues, loadLinearMeta } from "./linear.js";
import {
  icon, palette, stop, toAnchor, holderLook, splitButtonLook, MONO_FONT, GUTTER, HOLDER_WIDTH, ACTION_COLUMN_WIDTH, SPLIT_BUTTON_HEIGHT,
} from "./ui.js";
import { findSpaceOnBranch, findAgentFor, focusAgent, startSkill, selectTabNamed, getAskTabName, loadRepoSkills } from "./actions.js";
import { SettingsView } from "./settings-view.js";
import { button } from "./controls.js";
import {
  getRowAction, getRowMenu, getPullRequestFacts, getFactSegments, getRowDetails, getCaseRunPlace, getNewlyBlocked, getPullRequestLinks, getPullRequestActions,
  getTicketActions, formatNames,
} from "./row-action.js";
import { RowDetailsDialog, ROW_DETAILS_DIALOG, openRowDetails } from "./row-details.js";
import { CaseEditorDialog, CASE_EDITOR_DIALOG, openCaseEditor, getCaseLabel } from "./case-editor.js";
import { Gh44Dialog, GH44_DIALOG, openGh44Dialog } from "./gh44-dialog.js";
import { OncallTextDialog, ONCALL_TEXT_DIALOG } from "./oncall/text-dialog.js";
import { OncallTriageDialog, ONCALL_TRIAGE_DIALOG, openOncallTriageDialog } from "./oncall/triage-dialog.js";
import { resumeOncall, loadOncallConfig, startOncall, stopOncall, loadReport } from "./oncall/client.js";
import { OncallView, ReportView, runSkillOnIssue, runOncallAction, ONCALL_MENU_ITEMS } from "./oncall/view.js";
import { ONCALL_FILTERS_STORE, ONCALL_DEFAULTS } from "./oncall/decisions.js";
import { SAVED_FILTERS_STORE, getFilterSets, removeFilterSet, findActiveSet, getFilterChips, suggestSetName } from "./saved-filters.js";
import { FilterSavePopup, SAVE_POPUP_SIZE } from "./filter-save-popup.js";
import {
  getSettings, getGithubSituation, getLinearSituation, getSkillRole,
  getKeySkills, getReviewSkills, getTicketPullRequest, getIssueStage, shortSkill, hasNoDefaults, getShownTab, getRunnableSkills, getTabOrder, moveTab,
  getCaseRun, withStartCollapsed, isLinkEntry, ASK_ACTION, NUDGE_ENTRY,
} from "./settings.js";

const NO_MENU_ROW = -1;

// A PR and a ticket from the lists, as the case editor and the agent watch read them.
/**
 * @typedef {import("./settings.js").PullRequestShape & import("./row-action.js").PullRequestFactsShape
 *   & { id: string, number: number, title: string, branch: string, url: string, labels: string[], requestedUsers: string[], failingChecks: string[] }} PullRequestItem
 */
/**
 * @typedef {{ id: string, identifier: string, title: string, state: string, stateType: string, isMyPullRequest: boolean, prUrl: string | null,
 *   branch: string | null, project: string | null, labels: string[], priority: number }} IssueItem
 */

const STORE = {
  tab: "hub.tab",
  // The header tabs' order, changed by dragging a tab.
  tabOrder: "hub.tabOrder",
  github: "hub.github.filters",
  linear: "hub.linear.filters",
  collapsed: "hub.collapsed",
  // Merged worktree paths whose notice was closed with ✕.
  dismissedMerged: "hub.dismissedMerged",
  settings: "hub.settings",
};
// GitHub filters are kept per repo ("hub.github.filters|<repo id>"); Linear's are shared.
const isGithubStore = (store) => store.startsWith(STORE.github);
/** @param {string} store */
const defaultsFor = (store) => {
  if (store === ONCALL_FILTERS_STORE) return ONCALL_DEFAULTS;
  return isGithubStore(store) ? GITHUB_DEFAULTS : LINEAR_DEFAULTS;
};

const TICK_MS = 1000;
const REFRESH_MS = 120_000;
// Other repos' PR lists load in the background at most this often, while the panel is open.
const PREFETCH_MS = REFRESH_MS;
// A failed load or "not a repo" is retried this soon, so a hiccup never sticks.
const ERROR_RETRY_MS = 5_000;
// Opening the panel or switching space/tab refreshes the shown list, at most this often.
const MIN_REVALIDATE_MS = 15_000;
// Typing in the PR search runs the GitHub query once it pauses this long.
const SEARCH_DEBOUNCE_MS = 700;
const MENU_ROW_HEIGHT = 30;
const MENU_PADDING = 12;
const MENU_SEARCH_HEIGHT = 38;
const MENU_MAX_HEIGHT = 420;
// A menu separator line: 1px plus 3px above and below.
const MENU_SEPARATOR_HEIGHT = 7;
const MENU_TITLE_HEIGHT = 26;
const MENU_SECTION_TITLE_HEIGHT = 22;
// A multiselect's "3 picked · Clear" line under its options.
const MENU_FOOTER_HEIGHT = 30;
// Where a ticket's first run goes, asked until the ticket has a worktree.
const WHERE_OPTIONS = [
  { id: "worktree", label: "New worktree", icon: "branch", isWorktree: true },
  { id: "here", label: "This space", icon: "play", isWorktree: false },
];
const MENU_WIDTH = 240;
// Closing a menu hands focus back after its start ran; a foreground tab is selected again after this.
const REFOCUS_AFTER_MENU_MS = 200;
// The Filters popover is frameless and this big; its visible box grows with the open section.
const FILTER_POPOVER_WIDTH = 260;
// The scope picker in the search box: a long saved set name truncates instead of squeezing the search.
const SCOPE_PICKER_MAX_WIDTH = 150;
const FILTER_POPOVER_HEIGHT = 580;
const FILTER_OPTIONS_VISIBLE = 7;
const SKELETON_ROWS = 4;

// A PR strip's holder glyph, per group (filters.js PULL_REQUEST_GROUPS).
/** @type {Record<string, string>} */
const PR_GROUP_GLYPH = { fix: "x", merge: "check", rereview: "refresh", review: "state-review", waiting: "state-progress", reviewed: "check", draft: "state-backlog" };
const STRIP_MIN_HEIGHT = 46;
const SPINNER_ICON = "mods/workspace-chrome/spinner.svg";
const SPINNER_PERIOD_MS = 900;
const IDLE_RING_SIZE = 8;
const HOLDER_GLYPH_SIZE = 13;
const STAGE_STATUS = { backlog: "neutral", todo: "quiet", progress: "warning", review: "warning" };
const URGENT = 1;
const HIGH = 2;
const TAB_BAR_HEIGHT = 42;
// A strip's labels: more than one show in a card on hover.
const HOVER_CARD_WIDTH = 300;
// A strip's only label, by name on its meta line, cut off past this.
const LABEL_NAME_MAX_WIDTH = 120;
const HOVER_CARD_DELAY_MS = 200;

// Module scope so results survive tab switches and new panel copies:
// key -> { result, at }. A key is a repo + scope, or a Linear filter.
const cache = new Map();
const inflight = new Set();
// The cache keeps the most recently written lists only: one per repo, filter and search seen.
const CACHE_LIMIT = 30;
function cacheSet(key, value) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}
// folder -> repo id (shared git dir) or null; when a null was last checked.
const repoIds = new Map();
const repoCheckedAt = new Map();
const repoNames = new Map();
const repoLabels = new Map();
const repoUsers = new Map();
const repoNameCheckedAt = new Map();
// org -> my teams there, for the Team filter.
const myTeams = new Map();
// The merged worktrees the open Clean up dialog is about; its confirm runs `hub.cleanup`.
let pendingCleanup = null;
// Merged worktree paths being removed right now: their rows show a spinner.
const removing = new Set();
// A skill picked in a popup; the panel runs it (`hub.start`), since a closed popup's
// async work (creating a worktree) would be cancelled.
let pendingStart = null;
// A skill picked in a row's details, or a row whose details its menu asked for: the panel runs
// it on that row (`hub.row-start`, `hub.details`), where the row's own start and data live. Same for
// an On-call row's own action picked in its details (`hub.row-action`).
/** @type {{ tab: import("./settings.js").Tab, rowId: string, skill: string } | null} */
let pendingRowStart = null;
/** @type {{ tab: import("./settings.js").Tab, rowId: string } | null} */
let pendingDetails = null;
// A row whose button Enter in its details ran (`hub.row-run`).
/** @type {{ tab: import("./settings.js").Tab, rowId: string } | null} */
let pendingRowRun = null;
/** @type {{ tab: import("./settings.js").Tab, rowId: string, action: import("./row-action.js").OncallMenuId } | null} */
let pendingRowAction = null;
// A case whose editor a row's details or menu asked for: the panel opens it (`hub.edit-case`) with
// the rows it matches now.
/** @type {{ tab: import("./settings.js").Tab, situation: import("./settings.js").Situation } | null} */
let pendingCaseEdit = null;
// Each watched row's agent status as last seen, to notify once when one turns to needing you,
// and the agent the last such notification is about (its click, `hub.agent-needs-you`, goes there).
/** @type {Record<string, import("herdr").Status>} */
let agentStatuses = {};
/** @type {{ space: string, tab: string } | null} */
let blockedAgent = null;
// The groups set to start collapsed are collapsed once per app run.
let hasAppliedStartCollapsed = false;
// Labels of items whose new worktree is being prepared (fetch, branch): their button shows a spinner.
const preparing = new Set();
// linearAccount: who the saved Linear key belongs to, checked when the settings open.
const session = {
  login: null,
  meta: { status: "idle", teams: [], projects: [] },
  /** @type {{ status: "idle" | "checking" | "connected" | "missing" | "failed", name?: string, message?: string }} */
  linearAccount: { status: "idle" },
  // Folder names in ~/.claude/skills; null until listed.
  /** @type {string[] | null} */
  installedSkills: null,
  // The focused repo (id: its shared git dir) with its name and own skills, for repo actions.
  /** @type {{ id: string | null, folder: string | null } & import("./settings.js").RepoSkills} */
  repo: { id: null, folder: null, name: null, skills: null },
};

// The focused repo's name ("owner/name", else its folder's name) and its .claude skills.
// Kept only while the panel still shows that repo.
/** @param {{ cx: import("gpui-kit").Context, repoId: string | null, folder: string | null }} params */
function loadFocusedRepo({ cx, repoId, folder }) {
  session.repo = session.repo.id === repoId ? { ...session.repo, folder } : { id: repoId, folder, name: null, skills: null };
  if (!repoId) return;
  const machine = activeMachine();
  cx.spawn(async (cx) => {
    const [name, skills] = await Promise.all([loadRepoName({ folder, machine }), loadRepoSkills({ folder, machine })]);
    if (session.repo.id !== repoId) return;
    const fallbackName = repoId.replace(/\/\.git\/?$/, "").split("/").pop() ?? null;
    session.repo = { ...session.repo, name: name ?? fallbackName, skills: skills ?? session.repo.skills };
    cx.notify();
  });
}
/** @type {Record<string, "general" | "github" | "linear" | "oncall">} */
const SETTINGS_COMMANDS = { "settings-general": "general", "settings-github": "github", "settings-linear": "linear", "settings-oncall": "oncall" };
// On-call was on when Herdr last closed: its service is started again once per app run.
let hasResumedOncall = false;
/** @param {string} url */
const toGithubLink = (url) => ({ id: "github", label: "Open in GitHub", icon: "github", url });
/** @param {string} url */
const toLinearLink = (url) => ({ id: "linear", label: "Open in Linear", icon: "linear", url });

// Why a nudge failed, for its toast.
/** @param {{ reason: import("./github.js").NudgeFailure, detail: string }} params */
const getNudgeFailureText = ({ reason, detail }) => {
  switch (reason) {
    case "notPullRequest": return `Not a GitHub PR: ${detail}`;
    case "auth": return "gh is not logged in: run gh auth login";
    case "failed": return detail.split("\n")[0];
    default: {
      /** @type {never} */
      const unknownReason = reason;
      return unknownReason;
    }
  }
};

// Asks my PR's pending reviewers again, then says so in a toast.
/** @param {{ url: string, number: number, requestedUsers: string[] }} pr */
async function nudgePullRequest(pr) {
  const reviewers = pr.requestedUsers;
  const r = await nudgeReviewers({ pr, reviewers });
  if (r.status === "success") {
    notify({ title: `Asked ${formatNames(reviewers)} again`, level: "success" });
    return;
  }
  notify({ title: `Could not nudge the reviewers of #${pr.number}`, body: getNudgeFailureText({ reason: r.reason, detail: r.detail }), level: "warning" });
}

const getFilters = (store) => {
  // A repo without its own filters starts from the ones saved before filters were per repo.
  const saved = shared(store) ?? (isGithubStore(store) ? shared(STORE.github) : null) ?? {};
  const f = { ...defaultsFor(store), ...saved };
  // A scope saved by an older version falls back to review requests.
  if (isGithubStore(store) && !GITHUB_SCOPES.some((o) => o.value === f.scope)) f.scope = "review";
  return f;
};
const patchFilters = ({ store, patch }) => setShared(store, { ...getFilters(store), ...patch });
// Saved filter sets are kept per tab; GitHub's apply to whichever repo is shown.
/** @param {string} store @returns {import("./settings.js").Tab} */
const tabOfStore = (store) => {
  if (store === ONCALL_FILTERS_STORE) return "oncall";
  return isGithubStore(store) ? "github" : "linear";
};
/** @param {string} store */
const getSavedSets = (store) => getFilterSets({ saved: shared(SAVED_FILTERS_STORE), tab: tabOfStore(store) });
// The scope picker's extra group: the saved sets. Saving is in the Filters popover.
const SAVED_FIELD = "__saved";
/** @param {string} store */
const savedSetGroups = (store) => {
  const sets = getSavedSets(store);
  return sets.length ? [{ title: "Saved", field: SAVED_FIELD, isMulti: false, options: sets.map((set) => ({ value: set.id, label: set.name })) }] : [];
};
// Puts a saved set's scope and filters in place; the search text stays.
/** @param {{ store: string, id: string }} params */
const applySavedSet = ({ store, id }) => {
  const set = getSavedSets(store).find((s) => s.id === id);
  if (set) setShared(store, { ...defaultsFor(store), ...set.filters });
};
/** @param {{ store: string, scopeLabel: string, defs: any[] }} params */
const openSaveFilters = ({ store, scopeLabel, defs }) => {
  const filters = getFilters(store);
  const name = suggestSetName({ scopeLabel, chips: getFilterChips({ defs, filters, defaults: defaultsFor(store) }) });
  openOverlay({ mod: "hub", kind: "popup", ...SAVE_POPUP_SIZE, at: "pointer", props: { saveFilters: { tab: tabOfStore(store), filters, name } } });
};
// Group ids ("pr-fix", "ln-In Progress") whose rows are hidden; kept across reloads.
// "thu-4696-fe-2-remove-ff_jobs" -> { key: "THU-4696", title: "fe 2 remove ff_jobs" }; else the folder name.
const worktreeName = (w) => {
  const folder = w.path.split("/").pop();
  const match = folder.match(/^([a-z]+-\d+)-?(.*)$/i);
  return match ? { key: match[1].toUpperCase(), title: match[2].replace(/-/g, " ") } : { key: folder, title: "" };
};
// "https://linear.app/join/issue/" from a loaded issue's URL.
const LINEAR_ISSUE_BASE = /^https:\/\/linear\.app\/[^/]+\/issue\//;
// A Linear issue's page by its key: the loaded issue's URL, else built from any loaded issue's
// workspace. null: no Linear list loaded yet.
/** @param {string} key @returns {string | null} */
const findLinearIssueUrl = (key) => {
  const issues = [...cache.entries()].filter(([k]) => k.startsWith("ln|")).flatMap(([, entry]) => entry.result?.items ?? []);
  const issue = issues.find((i) => i.identifier === key);
  if (issue?.url) return issue.url;
  const base = issues.map((i) => i.url?.match(LINEAR_ISSUE_BASE)?.[0]).find(Boolean);
  return base ? `${base}${key}` : null;
};

const isCollapsed = (id) => (shared(STORE.collapsed) ?? []).includes(id);
const toggleCollapsed = (id) => {
  const ids = shared(STORE.collapsed) ?? [];
  setShared(STORE.collapsed, ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
};
// Only what the user changed is saved; getSettings fills in the rest.
const getSavedSettings = () => {
  const saved = shared(STORE.settings);
  return saved && typeof saved === "object" ? saved : {};
};
/** @param {Record<string, unknown>} patch */
const patchSettings = (patch) => setShared(STORE.settings, { ...getSavedSettings(), ...patch });
// Only the tab that changed is saved; the other keeps following the defaults until edited.
/** @param {{ tab: import("./settings.js").Tab, skills: import("./settings.js").Skills }} params */
const saveSkills = ({ tab, skills }) => {
  const saved = getSavedSettings();
  const savedSkills = "skills" in saved && saved.skills && typeof saved.skills === "object" ? saved.skills : {};
  patchSettings({ skills: { ...savedSkills, [tab]: skills[tab] } });
};
// One render reads settings and the shown tab for every row; build them once per render.
// Outside a render (handlers, ticks) they are read fresh.
/** @type {{ settings: import("./settings.js").Settings, tab: import("./settings.js").PanelTab } | null} */
let frame = null;
const readPanelSettings = () => getSettings({ saved: shared(STORE.settings), installedSkills: session.installedSkills });
const getPanelSettings = () => frame?.settings ?? readPanelSettings();
// The skills rows run: the settings' ones without those not installed.
const getRowSkills = () => getRunnableSkills({ skills: getPanelSettings().skills, installedSkills: session.installedSkills, repo: session.repo });
/** @param {string} skill */
const getRole = (skill) => getSkillRole({ skills: getPanelSettings().skills, skill });
const currentTab = () => frame?.tab ?? getShownTab({ saved: shared(STORE.tab), settings: getPanelSettings() });

// The shown space's repo folder: its focused terminal, else any terminal in the shown tab,
// else any terminal in the space, else where the space was made.
function currentFolder() {
  const space = spaces().find((s) => s.active);
  if (!space) return null;
  const f = focused();
  if (f?.space === space.id && f.cwd) return f.cwd;
  const tabIds = new Set((space.tabs ?? []).map((tab) => tab.id));
  const activeTab = (space.tabs ?? []).find((tab) => tab.active)?.id;
  const terminals = panes().filter((p) => tabIds.has(p.tab) && p.cwd);
  return terminals.find((p) => p.tab === activeTab && p.focused)?.cwd
    ?? terminals.find((p) => p.tab === activeTab)?.cwd
    ?? terminals[0]?.cwd
    ?? space.folder
    ?? null;
}
const activeMachine = () => spaces().find((s) => s.active)?.machine ?? undefined;

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

// The Omnia panel is open and showing this mod (not Files or Changes).
const isPanelShown = () => {
  const root = layout();
  const panel = findNode(root, "panel");
  return Boolean(panel) && !panel.hidden && findNode(root, "panel-body")?.active === "hub";
};


// How many of a filter's values are picked; a single choice counts when it differs from the default.
const countPicked = ({ store, def }) => {
  const value = getFilters(store)[def.field];
  return def.isMulti ? value.length : Number(value !== defaultsFor(store)[def.field]);
};

// The panel's select with search, for a setting: the pick (a list when isMulti) lands in
// shared(store).value, where the setting reads it back.
/**
 * @param {{ store: string, title: string, value: string | string[], options: { value: string, label: string }[], isMulti?: boolean,
 *   anchor?: import("./ui.js").Anchor | null }} params
 */
const openSelect = ({ store, title, value, options, isMulti = false, anchor = null }) => {
  setShared(store, { value });
  openMenu({ store, groups: [{ title, field: "value", isMulti, options }], anchor, align: "left" });
};

// Menus open MENU_GAP below the button pressed to open them: its left edge (align "left") or its
// right edge (align "right", for buttons at the panel's right side). Without a box: at the pointer.
const MENU_GAP = 5;
// The menu button pressed last, kept from its mouse down for the click that opens the menu. A
// press with no menu after it (or a menu opened from the keyboard later) goes stale.
const PRESS_FRESH_MS = 1_000;
/** @type {{ anchor: import("./ui.js").Anchor | null, at: number } | null} */
let pressed = null;
/** @param {import("gpui-kit").MouseButtonEvent} e @param {import("gpui-kit").Context} cx */
const pressMenuButton = (e, cx) => {
  pressed = { anchor: toAnchor(e), at: Date.now() };
  cx.stop_propagation();
};
/** @param {{ anchor: import("./ui.js").Anchor | null, align: "left" | "right", width: number }} params @returns {{ x: number, y: number } | "pointer"} */
const menuSpot = ({ anchor, align, width }) => {
  if (!anchor) return "pointer";
  const x = align === "right" ? anchor.left + anchor.width - width : anchor.left;
  return { x: Math.max(0, x), y: anchor.top + anchor.height + MENU_GAP };
};

// A menu of one multiselect (a filter, a setting): its footer counts the picks and clears them.
/** @param {Record<string, any>} menu */
const isMultiSelect = (menu) => !menu.isFilterList && !menu.skills && (menu.groups ?? []).length === 1 && Boolean(menu.groups[0].isMulti);

function openMenu(menu) {
  // The box it opens under: its own (a reopened menu keeps it), else the button just pressed.
  const anchor = menu.anchor ?? (pressed && Date.now() - pressed.at < PRESS_FRESH_MS ? pressed.anchor : null);
  pressed = null;
  const align = menu.align ?? "right";
  const groups = menu.groups ?? [];
  const groupRows = groups.reduce((sum, g) => sum + g.options.length + (groups.length > 1 ? 1 : 0), 0);
  const hasSearch = !menu.skills && !menu.isFilterList;
  /** @type {import("./row-action.js").RowMenuSection[]} */
  const sections = menu.sections ?? [];
  const sectionRows = sections.reduce((sum, section) => sum + section.items.length, 0);
  const rows = menu.isFilterList ? groups.length + 1 : sectionRows + groupRows;
  // A row's menu: a line between sections, and their titles.
  const sectionHeight = Math.max(0, sections.length - 1) * MENU_SEPARATOR_HEIGHT + sections.filter((section) => section.title).length * MENU_SECTION_TITLE_HEIGHT;
  const listHeight = Math.max(1, rows) * MENU_ROW_HEIGHT + sectionHeight;
  // A ticket's menu can switch in place to "where" (title, Back, the options), so it fits both.
  const askHeight = menu.isTicket ? MENU_TITLE_HEIGHT + (WHERE_OPTIONS.length + 1) * MENU_ROW_HEIGHT + MENU_SEPARATOR_HEIGHT : 0;
  const footerHeight = isMultiSelect(menu) ? MENU_FOOTER_HEIGHT : 0;
  const height = Math.min(MENU_MAX_HEIGHT, Math.max(listHeight, askHeight) + MENU_PADDING + (hasSearch ? MENU_SEARCH_HEIGHT : 0) + footerHeight);
  if (menu.isFilterList) {
    openOverlay({
      mod: "hub", kind: "popup", frame: "none", width: FILTER_POPOVER_WIDTH, height: FILTER_POPOVER_HEIGHT,
      at: menuSpot({ anchor, align, width: FILTER_POPOVER_WIDTH }), props: { menu: { ...menu, anchor } },
    });
    return;
  }
  openOverlay({ mod: "hub", kind: "popup", width: MENU_WIDTH, height, at: menuSpot({ anchor, align, width: MENU_WIDTH }), props: { menu: { ...menu, anchor, height } } });
}

// Where a row's skill runs (row-action.js getCaseRunPlace): its case's own pick, else a ticket's
// worktree when it has one, else what "Where runs go" says; a PR's reviews in a background tab.
/**
 * @param {{ tab: "github" | "linear", situation: import("./settings.js").Situation, skill: string,
 *   target: Record<string, any> }} params
 */
const getRunFor = ({ tab, situation, skill, target }) => {
  const settings = getPanelSettings();
  return getCaseRunPlace({
    caseWhere: getCaseRun({ skills: settings.skills, tab, situation }).where, where: settings.whereToRun, role: getRole(skill),
    hasWorktreeTarget: Boolean(target.main && target.branch), hasWorktree: Boolean(target.worktree), isBackgroundDefault: tab === "github",
  });
};

// startSkill with the Linear setting that lets a work skill move its ticket.
/** @param {Parameters<typeof startSkill>[0]} start */
const runSkill = (start) => startSkill({ ...start, shouldMoveToInProgress: getPanelSettings().shouldMoveToInProgress });

// Since when an agent works (its tab's working_since) or needs you (its tab's last change).
// null: Herdr has no time for it, so none is shown.
/** @param {{ status: string, tab: string }} agent @returns {number | null} */
const agentSince = (agent) => {
  const tab = spaces().flatMap((sp) => sp.tabs ?? []).find((tb) => tb.id === agent.tab);
  if (!tab) return null;
  if (agent.status === "working") return tab.working_since ?? null;
  return agent.status === "blocked" ? tab.changed_at ?? null : null;
};

// An agent as row-action.js reads it.
/** @param {ReturnType<typeof findAgentFor>} agent @returns {import("./row-action.js").RowAgent | null} */
const toRowAgent = (agent) => (agent ? { status: agent.status, tabName: agent.tab_name, since: agentSince(agent) } : null);

function startTicketSkill({ skill, menu }) {
  const { place, isBackground } = getRunFor({ tab: "linear", situation: menu.situation, skill, target: menu.target });
  if (place === "ask") {
    openMenu({ ...menu, askSkill: skill });
    return;
  }
  void runSkill({ skill, target: menu.target, role: getRole(skill), isWorktree: place === "worktree", isBackground });
}

export default class Hub extends View {
  init(_props, cx) {
    if (props()?.dialog === GH44_DIALOG) {
      this.gh44Dialog = new Gh44Dialog({ cx, getSettings: readPanelSettings, patchSettings });
      return;
    }
    if (props()?.dialog === ONCALL_TEXT_DIALOG) {
      this.oncallTextDialog = new OncallTextDialog({ cx, field: props().field });
      return;
    }
    if (props()?.dialog === ONCALL_TRIAGE_DIALOG) {
      this.oncallTriageDialog = new OncallTriageDialog({ cx, openSelect });
      return;
    }
    if (props()?.dialog === CASE_EDITOR_DIALOG) {
      this.caseEditorDialog = new CaseEditorDialog({
        cx, editor: props().editor, getSettings: readPanelSettings, getRowSkills, getSession: () => session, saveSkills, getRole, openSelect,
      });
      return;
    }
    if (props()?.dialog === ROW_DETAILS_DIALOG) {
      /** @type {import("./row-details.js").RowDetailsProps} */
      const details = props().details;
      this.rowDetailsDialog = new RowDetailsDialog({
        cx, details,
        onRunMain: () => { pendingRowRun = { tab: details.tab, rowId: details.rowId }; run("hub.row-run"); },
        onStartSkill: (skill) => { pendingRowStart = { tab: details.tab, rowId: details.rowId, skill }; run("hub.row-start"); },
        onGoToAgent: () => { if (details.agentTab) focusAgent(details.agentTab); },
        onEditCase: () => { pendingCaseEdit = { tab: details.tab, situation: details.situation }; run("hub.edit-case"); },
        onRowAction: (action) => { pendingRowAction = { tab: details.tab, rowId: details.rowId, action }; run("hub.row-action"); },
      });
      return;
    }
    if (props()?.saveFilters) {
      this.filterSavePopup = new FilterSavePopup({ request: props().saveFilters });
      return;
    }
    if (props()?.report) {
      this.reportView = new ReportView(props().report);
      if (!checking()) this.reportView.load(cx, loadReport);
      return;
    }
    if (props()?.menu) {
      this.isMenu = true;
      this.expanded = null;
      this.menuSearch = InputState.new({ placeholder: "Search" });
      this.menuSearch.on("change", (_e, cx) => {
        this.handleMenuSearchChange();
        cx.notify();
      });
      this.menuItems = [];
      const isKeyboardMenu = Boolean(props().menu.skills || props().menu.isFilterList);
      this.resetMenuStep();
      this.menuListOffset = 0;
      this.menuHandle = cx.focus_handle();
      this.menuScroll = ScrollHandle.new();
      this.optionScroll = ScrollHandle.new();
      // Without a search box to type in, the menu itself takes the keyboard for ↑/↓/↵.
      if (isKeyboardMenu) this.menuHandle.focus();
      else this.menuSearch.focus();
      // What was picked when the menu opened goes first; the order stays put while clicking.
      const menu = props().menu;
      this.pinned = new Set((menu.groups ?? []).flatMap((def) => [].concat(getFilters(menu.store)[def.field]).map((v) => `${def.field}:${v}`)));
      return;
    }
    // A header tab pressed (and, once moved onto another tab, dragged) and where it would land.
    /** @type {{ tab: import("./settings.js").PanelTab, to: number | null, isMoved: boolean } | null} */
    this.tabDrag = null;
    this.selected = { github: null, linear: null, oncall: null };
    // The shown tab each list last followed, and a row to scroll to once it is laid out.
    this.followedTab = { github: undefined, linear: undefined };
    this.scrollToRow = { github: null, linear: null };
    this.visible = { github: [], linear: [], oncall: [] };
    this.isSearchFocused = false;
    this.isShowingReviewed = false;
    this.folder = undefined;
    this.githubKey = null;
    this.linearKey = null;
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.committedSearch = "";
    this.searchChangedAt = 0;
    // The PR search runs on GitHub: after a pause in typing, or at once on Enter or leaving the box.
    this.githubSearch = this.createSearch({
      placeholder: "Search titles or #number",
      onChange: () => { this.searchChangedAt = Date.now(); },
      onCommit: (cx) => { this.searchChangedAt = 0; this.tick(cx); },
    });
    this.lastGithub = null;
    this.linearSearch = this.createSearch({ placeholder: "Search ID or title" });
    this.oncallView = new OncallView({ hub: this });
    this.settingsView = new SettingsView({
      session, getSettings: getPanelSettings, patchSettings, saveSkills,
      onLinearKeyChange: (cx) => this.reloadLinear(cx),
      reloadRepoSkills: (cx) => loadFocusedRepo({ cx, repoId: session.repo.id, folder: session.repo.folder }),
      focusPanel: () => this.handle.focus(),
      openSelect,
      openCaseEditor: ({ tab, situation }) => this.openCaseEditorFor({ tab, situation }),
      getCaseMatches: ({ tab, situation }) => this.getCaseMatches({ tab, situation }),
      getGroupOptions: () => this.getGroupOptions(),
    });
    if (checking()) return;
    if (!hasAppliedStartCollapsed) {
      hasAppliedStartCollapsed = true;
      setShared(STORE.collapsed, withStartCollapsed({ collapsed: shared(STORE.collapsed), startCollapsed: getPanelSettings().startCollapsed }));
    }
    this.settingsView.loadSkillList(cx);
    if (!session.login) cx.spawn(async (cx) => { session.login = await loadGithubLogin(); cx.notify(); });
    if (session.meta.status !== "success" && getPanelSettings().shouldShowLinear) this.loadMeta(cx);
    // pane.go and Herdr hand the panel the keyboard with "focus".
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        // `herdr-app do hub.github` / `hub.linear`: show that tab (bindable in keys.json).
        if (command === "github" || command === "linear") setShared(STORE.tab, command);
        // `herdr-app do hub.oncall` (also a nudge toast's click): the Omnia panel on the On-call tab.
        if (command === "oncall") {
          setShared(STORE.tab, "oncall");
          this.settingsView.close();
          run("layout.select", { stack: "panel-body", child: "hub" });
          run("layout.show", { id: "panel" });
        }
        // `herdr-app do hub.settings` opens the ⚙ settings on their last section;
        // hub.settings-general / -github / -linear on that one.
        if (command === "settings") this.settingsView.open({ cx });
        const section = SETTINGS_COMMANDS[command];
        if (section) this.settingsView.open({ cx, section });
        // `herdr-app do hub.gh44-skills`: the gh44 skills dialog.
        if (command === "gh44-skills") openGh44Dialog();
        // `herdr-app do hub.oncall-triage`: triage an issue by its link (bindable in keys.json).
        if (command === "oncall-triage") openOncallTriageDialog();
        // `herdr-app do hub.oncall-start` / `hub.oncall-stop`: go on or off call (bindable in keys.json).
        if (command === "oncall-start" || command === "oncall-stop") await this.switchOncall({ isOn: command === "oncall-start" });
        if (command === "cleanup") await this.runCleanup(cx);
        if (command === "row-start" && pendingRowStart) {
          const { tab, rowId, skill } = pendingRowStart;
          pendingRowStart = null;
          this.visible[tab].find((r) => r.id === rowId)?.start({ skill, cx });
        }
        if (command === "row-action" && pendingRowAction) {
          const { tab, rowId, action } = pendingRowAction;
          pendingRowAction = null;
          const row = this.visible[tab].find((r) => r.id === rowId);
          if (row?.runAction) cx.spawn(async (/** @type {import("gpui-kit").Context} */ cx) => { await row.runAction(action); cx.notify(); });
        }
        if (command === "edit-case" && pendingCaseEdit) {
          const edit = pendingCaseEdit;
          pendingCaseEdit = null;
          this.openCaseEditorFor(edit);
        }
        // A "needs you" notification clicked: its agent's tab.
        if (command === "agent-needs-you" && blockedAgent) focusAgent(blockedAgent);
        if (command === "row-run" && pendingRowRun) {
          const { tab, rowId } = pendingRowRun;
          pendingRowRun = null;
          this.visible[tab].find((r) => r.id === rowId)?.primary(cx);
        }
        if (command === "details" && pendingDetails) {
          const { tab, rowId } = pendingDetails;
          pendingDetails = null;
          this.visible[tab].find((r) => r.id === rowId)?.openDetails();
        }
        if (command === "start" && pendingStart) {
          const start = pendingStart;
          pendingStart = null;
          // Its own task, so the command loop keeps going while the branch is prepared.
          cx.spawn(async (cx) => {
            preparing.add(start.target.label);
            cx.notify();
            try {
              await runSkill(start);
              if (start.skill === ASK_ACTION) cx.timer.after(REFOCUS_AFTER_MENU_MS, () => selectTabNamed(getAskTabName(start.target)));
            } finally {
              preparing.delete(start.target.label);
              cx.notify();
            }
          });
        }
        cx.notify();
      }
    });
    if (!hasResumedOncall) {
      hasResumedOncall = true;
      cx.spawn(async () => {
        const r = await resumeOncall();
        if (r.status === "error") notify({ title: "Could not restart On-call", body: r.message, level: "warning" });
      });
    }
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
    this.tick(cx);
  }

  // A row's details closed with Esc (not by one of its actions), or the case editor closed: the
  // list takes the keyboard back.
  async close() {
    if (this.caseEditorDialog) await this.caseEditorDialog.close();
    if (this.rowDetailsDialog && !this.rowDetailsDialog.hasActed) run("hub.focus");
  }

  /** @param {{ isOn: boolean }} params */
  async switchOncall({ isOn }) {
    const config = await loadOncallConfig();
    const r = isOn ? await startOncall(config) : await stopOncall(config);
    if (r.status === "success") notify({ title: isOn ? "You are on call" : "Off call", level: "info" });
    else notify({ title: isOn ? "Could not start On-call" : "Could not stop On-call", body: r.message, level: "warning" });
  }

  // One handler per event: the input may keep only one.
  createSearch({ placeholder, onChange = () => {}, onCommit = () => {} }) {
    const state = InputState.new({ placeholder });
    state.on("change", (_e, cx) => { onChange(); cx.notify(); });
    state.on("submit", (_e, cx) => { onCommit(cx); cx.notify(); });
    state.on("focus", (_e, cx) => { this.isSearchFocused = true; cx.notify(); });
    state.on("blur", (_e, cx) => { this.isSearchFocused = false; onCommit(cx); cx.notify(); });
    return state;
  }

  // Every second, no I/O unless needed: pick the cache keys for what is shown,
  // and fetch only what is missing or older than REFRESH_MS.
  tick(cx) {
    this.settingsView.tick(cx);
    this.watchAgents();
    this.oncallView.tick({ cx, isShown: isPanelShown() && currentTab() === "oncall" && !this.settingsView.isOpen });
    const folder = currentFolder();
    const isIdStale = repoIds.get(folder) === null && Date.now() - (repoCheckedAt.get(folder) ?? 0) > ERROR_RETRY_MS;
    if (folder !== this.folder || isIdStale) {
      this.folder = folder;
      if (!repoIds.has(folder) || isIdStale) {
        const machine = activeMachine();
        repoCheckedAt.set(folder, Date.now());
        cx.spawn(async (cx) => { repoIds.set(folder, await loadRepoId({ folder, machine })); this.tick(cx); });
        if (!repoIds.has(folder)) return;
      }
    }
    if (!repoIds.has(folder)) return;
    const repoId = repoIds.get(folder);

    // Another repo: refresh its cached list in the background. Opening the panel, worktrees
    // of the same repo and tab switches show the cache; it refreshes once older than REFRESH_MS.
    const isShown = isPanelShown();
    if (repoId !== this.repoId) this.shouldRevalidate = true;
    this.repoId = repoId;
    if (repoId !== session.repo.id) loadFocusedRepo({ cx, repoId, folder });

    const ln = getFilters(STORE.linear);
    const linearKey = `ln|${JSON.stringify(buildIssueFilter(ln))}`;
    // Back to a filter combination seen before: refresh its cached list if it's not recent.
    if (this.shouldRevalidate || linearKey !== this.linearKey) this.revalidate(linearKey);
    this.linearKey = linearKey;
    // Nothing is fetched while the panel is closed; opening it refreshes both tabs.
    if (isShown && getPanelSettings().shouldShowLinear) this.ensure({ cx, key: this.linearKey, load: () => loadIssues(ln) });
    // A hidden GitHub tab loads nothing of its own: no repo details, PRs, worktrees or prefetch.
    if (!getPanelSettings().shouldShowGithub) {
      this.shouldRevalidate = false;
      return;
    }

    // The repo's name (for the search query) and labels (for the Label filter), once per repo.
    // A failed name lookup is retried after ERROR_RETRY_MS instead of blocking the repo for good.
    const isNameStale = repoId && repoNames.get(repoId) === null && Date.now() - (repoNameCheckedAt.get(repoId) ?? 0) > ERROR_RETRY_MS;
    if (repoId && (!repoNames.has(repoId) || isNameStale)) {
      const machine = activeMachine();
      repoNames.set(repoId, null);
      repoNameCheckedAt.set(repoId, Date.now());
      cx.spawn(async (cx) => {
        repoNames.set(repoId, await loadRepoName({ folder, machine }));
        this.tick(cx);
      });
      return;
    }
    const repo = repoId ? repoNames.get(repoId) : null;
    if (repoId && !repo) return;
    // Labels and people only feed the filters, so they load after the PR list has started.
    if (!repoLabels.has(repoId)) {
      const machine = activeMachine();
      repoLabels.set(repoId, []);
      cx.spawn(async (cx) => {
        const [labels, users] = await Promise.all([loadRepoLabels({ folder, machine }), loadRepoUsers({ repo, machine })]);
        repoLabels.set(repoId, labels);
        repoUsers.set(repoId, users);
        cx.notify();
      });
    }
    const org = repo?.split("/")[0];
    if (org && session.login && !myTeams.has(org)) {
      myTeams.set(org, []);
      const login = session.login;
      cx.spawn(async (cx) => { myTeams.set(org, await loadMyTeams({ org, login })); cx.notify(); });
    }
    if (Date.now() - this.searchChangedAt > SEARCH_DEBOUNCE_MS) this.committedSearch = this.githubSearch.value();
    this.githubQuery = repo ? buildPullRequestQuery({ repo, filters: getFilters(this.githubStore()), search: this.committedSearch }) : null;
    const githubKey = `gh|${repoId}|${this.githubQuery}`;
    if (githubKey !== this.githubKey) this.revalidate(githubKey);
    this.githubKey = githubKey;
    // The repo's worktrees (to reuse a ticket's checkout) and which are merged (to clean up).
    const main = this.repoMain();
    if (isShown && repo && main) {
      const machine = activeMachine();
      this.ensure({
        cx, key: `wt|${repoId}`,
        load: async () => {
          const items = await loadWorktrees({ main, machine });
          // Only checkouts made for tickets: gh44's .worktrees/ and Herdr's worktree folder.
          const ours = items.filter((w) => w.path.startsWith(`${main}/.worktrees/`) || w.path.startsWith(`${home()}/.herdr/worktrees/`));
          return { status: "success", items, merged: await loadMergedWorktrees({ repo, main, worktrees: ours, machine }) };
        },
      });
    }
    if (this.shouldRevalidate) this.revalidate(this.githubKey);
    this.shouldRevalidate = false;
    const query = this.githubQuery;
    if (isShown) this.ensure({ cx, key: this.githubKey, load: () => (query ? loadPullRequests({ query }) : Promise.resolve({ status: "error", reason: "notRepo" })) });
    if (isShown && Date.now() - (session.prefetchedAt ?? 0) > PREFETCH_MS) this.prefetchOtherRepos(cx);
  }

  // The PR lists of the other repos with an open space, one after another in the background,
  // with each repo's saved filters and no search: a first switch to one shows its list at once.
  prefetchOtherRepos(cx) {
    session.prefetchedAt = Date.now();
    const shownRepoId = this.repoId;
    const targets = spaces().filter((sp) => sp.folder).map((sp) => ({ folder: sp.folder, machine: sp.machine }));
    cx.spawn(async () => {
      for (const { folder, machine } of targets) {
        if (!repoIds.has(folder)) repoIds.set(folder, await loadRepoId({ folder, machine }));
        const repoId = repoIds.get(folder);
        if (!repoId || repoId === shownRepoId) continue;
        if (!repoNames.get(repoId)) repoNames.set(repoId, await loadRepoName({ folder, machine }));
        const repo = repoNames.get(repoId);
        if (!repo) continue;
        const query = buildPullRequestQuery({ repo, filters: getFilters(`${STORE.github}|${repoId}`), search: "" });
        const key = `gh|${repoId}|${query}`;
        const entry = cache.get(key);
        if ((entry && Date.now() - entry.at < REFRESH_MS) || inflight.has(key)) continue;
        inflight.add(key);
        try {
          const result = await loadPullRequests({ query });
          if (result.status === "success") cacheSet(key, { result, at: Date.now() });
        } finally {
          inflight.delete(key);
        }
      }
    });
  }

  // The next page of PRs, added to the cached list.
  loadMore(cx) {
    const key = this.githubKey;
    const entry = cache.get(key);
    const moreKey = `${key}|more`;
    if (!entry?.result.hasMore || inflight.has(moreKey)) return;
    inflight.add(moreKey);
    cx.notify();
    const query = this.githubQuery;
    cx.spawn(async (cx) => {
      try {
        const next = await loadPullRequests({ query, after: entry.result.cursor });
        const current = cache.get(key);
        if (next.status === "success" && current?.result.status === "success") {
          const seen = new Set(current.result.items.map((pr) => pr.id));
          const items = [...current.result.items, ...next.items.filter((pr) => !seen.has(pr.id))];
          cacheSet(key, { ...current, result: { ...current.result, items, cursor: next.cursor, hasMore: next.hasMore } });
        }
      } finally {
        inflight.delete(moreKey);
        cx.notify();
      }
    });
  }

  // Mark a list stale so the next ensure refetches it in the background; the old list stays on screen.
  revalidate(key) {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.at > MIN_REVALIDATE_MS) cacheSet(key, { ...entry, at: 0 });
  }

  ensure({ cx, key, load }) {
    const entry = cache.get(key);
    const maxAge = entry?.result.status === "error" ? ERROR_RETRY_MS : REFRESH_MS;
    if ((entry && Date.now() - entry.at < maxAge) || inflight.has(key)) return;
    inflight.add(key);
    // A throw anywhere below still clears the key, so the spinner can't stick.
    try {
      cx.notify();
      cx.spawn(async (cx) => {
        try {
          const result = await load();
          // A failed refresh keeps the last good list on screen.
          const keepOld = result.status !== "success" && entry?.result.status === "success";
          cacheSet(key, { result: keepOld ? entry.result : result, at: Date.now() });
          if (result.status === "success" && key.startsWith("ln|") && session.meta.status !== "success") this.loadMeta(cx);
        } finally {
          inflight.delete(key);
          cx.notify();
        }
      });
    } catch (error) {
      inflight.delete(key);
      throw error;
    }
  }

  loadMeta(cx) {
    session.meta = { ...session.meta, status: "loading" };
    cx.spawn(async (cx) => {
      const result = await loadLinearMeta();
      session.meta = result.status === "success" ? result : { ...result, teams: [], projects: [] };
      cx.notify();
    });
  }

  handleRefresh(cx) {
    for (const key of [this.githubKey, this.linearKey]) {
      const entry = cache.get(key);
      if (entry) cacheSet(key, { ...entry, at: 0 });
    }
    if (getPanelSettings().shouldShowLinear) this.loadMeta(cx);
    this.tick(cx);
  }

  handleKey(e, cx) {
    if (this.settingsView.isTyping()) return;
    if (this.settingsView.isOpen) {
      if (e.key === "escape") { this.settingsView.close(); cx.stop_propagation(); cx.notify(); }
      return;
    }
    if (this.isSearchFocused) {
      if (e.key === "escape" || e.key === "enter") { this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      return;
    }
    if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
    const tab = currentTab();
    const rows = this.visible[tab];
    const at = rows.findIndex((r) => r.id === this.selected[tab]);
    const row = rows[at];
    const move = (step) => {
      if (rows.length === 0) return;
      const from = at === -1 ? (step > 0 ? -1 : rows.length) : at;
      const next = rows[Math.max(0, Math.min(rows.length - 1, from + step))];
      this.selected[tab] = next.id;
      this.scroll.scroll_to_item(next.index);
    };
    switch (e.key) {
      case "j": case "down": move(1); break;
      case "k": case "up": move(-1); break;
      case "enter": row?.primary(cx); break;
      case "space": row?.openDetails(); break;
      case "o": if (row) cx.open_url(row.url); break;
      case "/": (tab === "github" ? this.githubSearch : tab === "linear" ? this.linearSearch : this.oncallView.search).focus(); break;
      case "1": if (getPanelSettings().shouldShowGithub) setShared(STORE.tab, "github"); break;
      case "2": if (getPanelSettings().shouldShowLinear) setShared(STORE.tab, "linear"); break;
      case "3": if (getPanelSettings().shouldShowOncall) setShared(STORE.tab, "oncall"); break;
      default: {
        // Keys start only the row's suggested skills (the menu shows them with their key); others do nothing.
        const skill = row ? getKeySkills({ skills: getRowSkills(), tab, actions: row.actions })[e.key] : undefined;
        if (!skill) return;
        row.start({ skill, cx });
      }
    }
    cx.stop_propagation();
    cx.notify();
  }

  // ---------- shared pieces ----------

  // [Review: me + teams ▾ | search...] like GitHub's search box with its scope picker, and under
  // it (a General setting) the filters in use as chips. The picker also lists the saved sets.
  searchRow({ store, scopeDef, state, defs }) {
    const t = theme();
    const filters = getFilters(store);
    const value = filters[scopeDef.field];
    const scopeLabel = scopeDef.options.find((o) => o.value === value)?.label ?? "";
    const activeSet = findActiveSet({ sets: getSavedSets(store), filters, defaults: defaultsFor(store) });
    const search = h_flex().h(30).items_center().rounded(6).border(1).border_color(this.isSearchFocused ? t.accent : t.input).bg(t.background).overflow_hidden()
      .child(h_flex().id(`scope-${scopeDef.field}`).h_full().max_w(SCOPE_PICKER_MAX_WIDTH).px(8).gap(4).items_center().flex_none().cursor_pointer()
        .text_size(12).text_color(t.foreground).bg(t.raised).hover((s) => s.bg(t.hover))
        .on_mouse_down("left", pressMenuButton)
        .on_click(() => openMenu({ store, groups: [scopeDef, ...savedSetGroups(store)], align: "left" }))
        .tooltip(activeSet ? `★ ${activeSet.name}` : scopeLabel)
        .child(div().min_w(0).truncate().child(activeSet ? `★ ${activeSet.name}` : scopeLabel))
        .child(svg(icon("chevron")).size(12).flex_none().text_color(t.muted)))
      .child(div().w(1).h_full().bg(t.border))
      .child(h_flex().flex_1().min_w(0).px(8).gap(6).items_center()
        .child(svg(icon("search")).size(13).text_color(t.dim))
        .child(Input.new(state).flex_1().text_size(12).text_color(t.foreground))
        .child(this.clearButton({ id: `clear-${scopeDef.field}`, state, onClear: (cx) => { this.searchChangedAt = 0; this.tick(cx); } })))
      .child(div().w(1).h_full().bg(t.border))
      .child(this.filtersButton({ store, defs, scopeLabel }));
    const chips = getFilterChips({ defs, filters, defaults: defaultsFor(store) });
    if (!getPanelSettings().shouldShowFilterChips || chips.length === 0) return search;
    return v_flex().gap(6).child(search).child(this.filterChipRow({ store, chips, defs, scopeLabel }));
  }

  // [Team is FE ✕][CI is failing ✕] +   Clear: scrolls sideways when it overflows. A chip
  // opens its filter's options; ✕ resets it; + opens every filter.
  /** @param {{ store: string, chips: import("./saved-filters.js").FilterChip[], defs: any[], scopeLabel: string }} params */
  filterChipRow({ store, chips, defs, scopeLabel }) {
    const t = theme();
    const textButton = (/** @type {string} */ id, /** @type {string} */ label, /** @type {() => void} */ onClick) => div().id(id).h(22).px(6).flex().flex_none().items_center().rounded(5)
      .text_size(11.5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", pressMenuButton).on_click(onClick).child(label);
    const chip = (/** @type {import("./saved-filters.js").FilterChip} */ c) => {
      const def = defs.find((d) => d.field === c.field);
      return h_flex().id(`chip-${c.field}`).h(22).flex_none().items_center().rounded(5).border(1).border_color(t.border).bg(t.raised).text_size(11.5).overflow_hidden()
        .child(h_flex().id(`chip-${c.field}-open`).h_full().pl(7).pr(5).gap(4).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
          .on_mouse_down("left", pressMenuButton)
          .on_click(() => { if (def) openMenu({ store, groups: [def], align: "left" }); })
          .child(div().text_color(t.muted).child(c.title))
          .child(div().text_color(t.dim).child("is"))
          .child(div().text_color(t.foreground).child(c.text)))
        .child(div().id(`chip-${c.field}-remove`).h_full().px(4).flex().items_center().cursor_pointer().border_l(1).border_color(t.border)
          .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(`Clear ${c.title}`)
          .on_click(() => patchFilters({ store, patch: { [c.field]: defaultsFor(store)[c.field] } }))
          .child(svg(icon("x")).size(10)));
    };
    return h_flex().gap(6).items_center()
      .child(h_flex().id(`chips-row-${tabOfStore(store)}`).flex_1().min_w(0).gap(5).items_center().overflow_x_scrollbar()
        .children(chips.map(chip))
        .child(textButton(`chips-add-${tabOfStore(store)}`, "+", () => openMenu({ store, groups: defs, isFilterList: true, align: "left", saveContext: { scopeLabel, defs } }))))
      .child(textButton(`chips-clear-${tabOfStore(store)}`, "Clear", () => patchFilters({ store, patch: Object.fromEntries(defs.map((d) => [d.field, defaultsFor(store)[d.field]])) })));
  }

  // An X at the end of a search box with text: empties it and keeps the keyboard in it.
  clearButton({ id, state, onClear }) {
    const t = theme();
    if (!state.value()) return div();
    return div().id(id).size(18).flex_none().flex().items_center().justify_center().rounded(4).cursor_pointer()
      .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Clear")
      .on_click((_e, cx) => {
        state.set_value("");
        state.focus();
        onClear(cx);
        cx.notify();
      })
      .child(svg(icon("x")).size(12));
  }

  // [≡ Filters ②]: every filter in one popover, with search, Clear and Save.
  filtersButton({ store, defs, scopeLabel }) {
    const t = theme();
    const count = defs.reduce((sum, def) => sum + countPicked({ store, def }), 0);
    const isOn = count > 0;
    return h_flex().id(`filters-${store}`).h_full().px(8).gap(5).items_center().flex_none().cursor_pointer().text_size(12)
      .text_color(isOn ? t.foreground : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", pressMenuButton)
      .on_click(() => openMenu({ store, groups: defs, isFilterList: true, align: "right", saveContext: { scopeLabel, defs } }))
      .child(svg(icon("filter")).size(13))
      .child("Filters")
      .when(isOn, (el) => el.child(div().px(5).rounded(8).bg(t.accent).text_color(t.accent_foreground).text_size(10.5).child(String(count))));
  }

  // A detail on a row: icon and text in its tone, on a raised surface. With a url it opens that page.
  // `content` builds custom inner content; a function, since one chip can be drawn in two places.
  chip({ id, label = null, content = null, tone = "quiet", iconName = null, tip = null, isMono = false, url = null }) {
    const t = theme();
    const color = palette(t)[tone];
    return h_flex().id(`chip-${id}`).flex_none().max_w(220).h(20).px(6).gap(4).items_center().rounded(5).bg(t.raised)
      .text_size(11).text_color(color)
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .when(Boolean(url), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); cx.open_url(url); }))
      .when(Boolean(iconName), (el) => el.child(svg(icon(iconName)).size(11).flex_none().text_color(color)))
      .child(content ? content() : div().truncate().when(isMono, (el) => el.font_family(MONO_FONT)).child(label));
  }

  // One label: its chip, with a dot in the repo's or team's color.
  /** @param {{ id: string, name: string, color?: string }} params */
  labelChip({ id, name, color }) {
    const content = () => h_flex().min_w(0).gap(5).items_center()
      .child(div().flex_none().size(7).rounded(4).bg(color ?? theme().dim))
      .child(div().truncate().child(name));
    return { id, content, tone: "neutral" };
  }

  // A strip's labels, last on its meta line: one shows by name with its color dot; more show as
  // "+N", and hovering it shows each label's chip.
  /** @param {{ id: string, labels: string[], colors?: Record<string, string> }} params */
  labelsMore({ id, labels, colors = {} }) {
    const t = theme();
    const tag = div().id(`${id}-labels`).flex_none().px(4).rounded(4).bg(t.raised).text_size(11).text_color(t.muted);
    if (labels.length === 1) {
      const [name] = labels;
      return tag.max_w(LABEL_NAME_MAX_WIDTH).flex().gap(4).items_center()
        .child(div().flex_none().size(6).rounded(3).bg(colors[name] ?? t.dim))
        .child(div().min_w(0).truncate().child(name));
    }
    const chips = labels.map((name) => this.labelChip({ id: `${id}-label-${name}`, name, color: colors[name] }));
    const card = h_flex().max_w(HOVER_CARD_WIDTH).p(6).gap(4).flex_wrap().rounded(6).bg(t.popover).border(1).border_color(t.border)
      .children(chips.map((c) => this.chip(c)));
    return HoverCard.new(`${id}-labels-card`).open_delay(HOVER_CARD_DELAY_MS).anchor("top_left").trigger(tag.child(`+${labels.length}`)).content(card);
  }

  // A strip's one meta line: refs (mono, each opens its page), then the facts, then the labels.
  // It cuts off at the end, so the facts go most important first.
  /** @param {{ id: string, refs: { text: string, url: string, tip: string }[], facts: string[], labels?: string[], labelColors?: Record<string, string> }} params */
  metaLine({ id, refs, facts, labels = [], labelColors = {} }) {
    const t = theme();
    const ref = (/** @type {{ text: string, url: string, tip: string }} */ r) => div().id(`${id}-ref-${r.text}`).flex_none().font_family(MONO_FONT).text_color(t.muted)
      .cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip(r.tip)
      .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); cx.open_url(r.url); })
      .child(r.text);
    const dot = () => div().flex_none().px(5).child("·");
    return h_flex().min_w(0).items_center().text_size(12).text_color(t.dim)
      .children(refs.flatMap((r, i) => (i === 0 ? [ref(r)] : [dot(), ref(r)])))
      .when(facts.length > 0, (el) => el.child(dot()).child(this.factsLine(facts)))
      .when(facts.length === 0, (el) => el.child(div().flex_1()))
      .when(labels.length > 0, (el) => el.child(div().flex_none().pl(6).child(this.labelsMore({ id, labels, colors: labelColors }))));
  }

  // The facts, each in its tone (a diff's + green and − red, "checks failing" red). Colored facts
  // always show whole; plain ones next to each other join into one dim run that cuts off first.
  /** @param {string[]} facts */
  factsLine(facts) {
    const t = theme();
    const colors = palette(t);
    /** @param {import("./row-action.js").FactPart} part */
    const toColor = (part) => (part.tone ? colors[part.tone] ?? t[part.tone] ?? t.dim : t.dim);
    const segments = getFactSegments(facts);
    const dot = () => div().flex_none().px(5).child("·");
    return h_flex().flex_1().min_w(0).overflow_hidden().whitespace_nowrap()
      .children(segments.map((segment, i) => (segment.kind === "plain"
        ? h_flex().min_w(0).overflow_hidden().when(i > 0, (el) => el.child(dot())).child(div().min_w(0).truncate().child(segment.text))
        : h_flex().flex_none().when(i > 0, (el) => el.child(dot()))
          .child(h_flex().gap(4).children(segment.parts.map((part) => div().text_color(toColor(part)).child(part.text)))))));
  }

  // A strip: the holder end in its group's tone with a state glyph, the title over one meta line,
  // and the action column with the split button.
  /**
   * @param {{ id: string, holder: { tone: string, icon: string, tip: string }, title: string, isTitleDim?: boolean, meta: any,
   *   primary: ReturnType<Hub["primaryFor"]>, menu: Record<string, any>, openDetails: () => void }} params
   */
  strip({ id, holder, title, isTitleDim = false, meta, primary, menu, openDetails }) {
    const t = theme();
    const tab = currentTab();
    const isSelected = this.selected[tab] === id;
    const look = holderLook({ t, tone: holder.tone });
    return h_flex().id(`row-${id}`).flex_none().mx(GUTTER - 4).mb(3).min_h(STRIP_MIN_HEIGHT).rounded(4).overflow_hidden()
      .bg(t.popover).border(1).border_color(isSelected ? t.input : t.border)
      .on_click((_e, cx) => {
        this.selected[tab] = id;
        this.handle.focus();
        if (getPanelSettings().rowClick === "details") openDetails();
        cx.notify();
      })
      .child(div().w(HOLDER_WIDTH).flex_none().self_stretch().flex().items_center().justify_center().bg(look.bg).tooltip(holder.tip)
        .child(svg(icon(holder.icon)).size(HOLDER_GLYPH_SIZE).text_color(look.glyph)))
      .child(v_flex().flex_1().min_w(0).px(10).py(6).gap(2).justify_center()
        .child(div().truncate().text_size(13.5).font_medium().text_color(isTitleDim ? t.muted : t.foreground).child(title))
        .child(meta))
      // As wide as its button (up to ACTION_COLUMN_WIDTH), so a short one leaves no gap after the title.
      .child(h_flex().max_w(ACTION_COLUMN_WIDTH).flex_none().self_stretch().px(8).items_center().justify_end()
        .border_l(1).border_color(t.border)
        .child(this.stripButton({ id: `run-${id}`, primary, menu })));
  }

  // [▶ review | ▾] in a strip: the main part runs the row's main action, ▾ opens its menu.
  // Filled for a step to take, outlined for an agent or a link, red when an agent needs you.
  // The row's agent shows in the button itself: its mark leads (spinning while it works, a check
  // once done, a ring while idle) and how long it has worked or waited follows the label.
  /** @param {{ id: string, primary: ReturnType<Hub["primaryFor"]>, menu: Record<string, any> }} params */
  stripButton({ id, primary, menu }) {
    const t = theme();
    const look = splitButtonLook({ t, style: primary.style });
    const status = primary.status;
    // On a filled button the mark takes the button's ink; on a quiet one, the agent's color.
    const statusColor = status && primary.style === "quiet" ? t[status.tone] ?? look.text : look.text;
    const getMark = () => {
      if (primary.isLoading) return svg(SPINNER_ICON).size(11).flex_none().text_color(look.text).spin(SPINNER_PERIOD_MS);
      switch (status?.tone) {
        case "working": return svg(SPINNER_ICON).size(11).flex_none().text_color(statusColor).spin(SPINNER_PERIOD_MS);
        case "blocked": return svg(icon("alert")).size(11).flex_none().text_color(statusColor);
        case "done": return svg(icon("check")).size(11).flex_none().text_color(statusColor);
        case "idle": return div().size(IDLE_RING_SIZE).mx(1.5).flex_none().rounded(IDLE_RING_SIZE).border(1.5).border_color(t.dim);
        default: return svg(icon(primary.icon)).size(11).flex_none().text_color(look.text);
      }
    };
    const elapsed = status?.elapsed ?? null;
    const tip = status ? `Agent ${status.text}${elapsed ? ` for ${elapsed}` : ""}. ${primary.tip}` : primary.tip;
    return h_flex().id(id).max_w_full().h(SPLIT_BUTTON_HEIGHT).flex_none().items_center().rounded(6).overflow_hidden()
      .bg(look.bg).border(1).border_color(look.border).text_size(12).font_medium().text_color(look.text)
      .child(h_flex().id(`${id}-run`).min_w(0).h_full().pl(7).pr(6).gap(5).items_center().cursor_pointer()
        .hover((s) => s.bg(look.hover)).tooltip(tip)
        .on_mouse_down("left", pressMenuButton).on_click((_e, cx) => { cx.stop_propagation(); primary.run(cx); })
        .child(getMark())
        .child(div().min_w(0).truncate().child(primary.label))
        .when(elapsed !== null, (el) => el.child(div().flex_none().font_family(MONO_FONT).text_size(11).font_normal().opacity(0.7).child(elapsed ?? ""))))
      .child(div().w(1).h_full().flex_none().bg(look.divider))
      .child(div().id(`${id}-more`).h_full().px(4).flex_none().flex().items_center().cursor_pointer()
        .hover((s) => s.bg(look.hover))
        .on_mouse_down("left", pressMenuButton).on_click((_e, cx) => { cx.stop_propagation(); openMenu(menu); })
        .child(svg(icon("chevron")).size(12)));
  }

  // A group's header: chevron, name and count, quiet above its strips (their holders carry the tone).
  // Clicking it collapses or expands the group.
  /** @param {{ id: string, label: string, count: number }} params */
  listHeader({ id, label, count }) {
    const t = theme();
    const isClosed = isCollapsed(id);
    return h_flex().id(`grp-${id}`).flex_none().mx(GUTTER - 4).mt(10).mb(5).px(2).h(22).gap(6).items_center().rounded(4).cursor_pointer()
      .text_color(t.muted).hover((s) => s.text_color(t.foreground))
      .tooltip(isClosed ? "Show this group" : "Hide this group")
      .on_click((_e, cx) => { toggleCollapsed(id); cx.notify(); })
      .child(svg(icon(isClosed ? "chevron-right" : "chevron")).size(11).flex_none().text_color(t.dim))
      .child(div().text_size(12).font_semibold().child(label))
      .child(div().text_size(11).font_family(MONO_FONT).text_color(t.dim).child(String(count)));
  }

  message({ title, body, action }) {
    const t = theme();
    return v_flex().p(16).gap(8).items_center().text_size(12.5)
      .child(div().text_color(t.foreground).child(title))
      .when(Boolean(body), (el) => el.child(div().text_color(t.dim).child(body)))
      .when(Boolean(action), (el) => el.child(div().id(`msg-${action.label}`).h(26).px(10).flex().items_center().rounded(6)
        .border(1).border_color(t.accent).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => action.onClick(cx)).child(action.label)));
  }

  skeleton() {
    const t = theme();
    const bar = (isFull) => div().h(10).when(isFull, (el) => el.w_full()).when(!isFull, (el) => el.w(140)).rounded(4)
      .bg(t.raised).loop("opacity", { from: 0.4, to: 1, period: 1200 });
    return v_flex().p(10).gap(14).children(Array.from({ length: SKELETON_ROWS }, (_, i) =>
      v_flex().id(`sk-${i}`).gap(7).child(bar(true)).child(bar(false))));
  }

  // Error, first-load and empty states; null when there are rows to show.
  listState({ source, label, shownCount, hasFilters, onClear }) {
    if (!source) return this.skeleton();
    if (source.status === "error") {
      if (source.reason === "auth" && label === "Linear") return this.settingsView.linearConnect(source.message);
      if (source.reason === "auth") {
        const argv = ["gh", "auth", "login"];
        return this.message({ title: `${label} CLI is not logged in`, body: `Runs \`${argv.join(" ")}\` in a new tab.`, action: { label: "Log in", onClick: () => run("tab.new", { name: `${label} login`, argv }) } });
      }
      if (source.reason === "notRepo") return this.message({ title: "Not a GitHub repo", body: `${this.folder ?? "No folder"} is not inside a repo. Focus a terminal in one.` });
      return this.message({ title: `${label} failed to load`, body: source.message, action: { label: "Retry", onClick: (cx) => this.handleRefresh(cx) } });
    }
    if (shownCount > 0) return null;
    return hasFilters
      ? this.message({ title: "Nothing matches these filters", action: { label: "Clear filters", onClick: onClear } })
      : this.message({ title: "Nothing here", body: "No open items for this view." });
  }

  note({ id, text, action }) {
    const t = theme();
    return h_flex().id(id).flex_none().px(10).py(8).gap(6).text_size(11.5).text_color(t.dim)
      .child(text)
      .when(Boolean(action), (el) => el.child(div().id(`${id}-action`).text_color(t.accent).cursor_pointer()
        .on_click((_e, cx) => action.onClick(cx)).child(action.label)));
  }

  // The end of a paged list, centered: a "Load 30 more" button over "30 of 142".
  // While a page loads, the button shows a spinner and does nothing.
  loadMoreFooter({ shown, total, hasMore }) {
    const t = theme();
    const isLoading = inflight.has(`${this.githubKey}|more`);
    const next = Math.min(PAGE_SIZE, total - shown);
    const button = h_flex().id("gh-load-more").h(30).px(14).gap(6).items_center().rounded(6).text_size(12.5)
      .border(1).border_color(t.border).bg(t.raised).text_color(isLoading ? t.muted : t.foreground)
      .when(!isLoading, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.loadMore(cx)))
      .child(isLoading
        ? svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900)
        : svg(icon("chevron")).size(12).text_color(t.muted))
      .child(isLoading ? "Loading…" : `Load ${next} more`);
    return v_flex().id("gh-more").flex_none().py(14).gap(6).items_center()
      .when(hasMore, (el) => el.child(button))
      .child(div().text_size(11).text_color(t.dim).child(`${shown} of ${total}`));
  }

  // A scrolling list whose direct children are the rows, so the keyboard can scroll to one.
  // An empty, loading or failed list shows its state below the notes, so a note like the
  // merged worktrees one still shows on a tab with no rows.
  list({ id, state, notes, entries }) {
    return v_flex().id(id).flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll)
      .on_mouse_down("left", () => this.handle.focus())
      .children(state ? [...notes, state] : entries);
  }

  // The row's main action (row-action.js) with what it runs. afterDone: its case's, for a done agent.
  /**
   * @param {{
   *   agent: ReturnType<typeof findAgentFor>, branch: string | null, skill: string | null, target: { ref: string, label: string, worktree?: string },
   *   link: { icon: string, label: string, url: string }, place: import("./row-action.js").RunPlace, isBackground?: boolean,
   *   isMergeReady?: boolean, afterDone?: import("./settings.js").AfterDone, links?: import("./row-action.js").RowLinkEntry[],
   *   start: (params: { skill: string, cx: import("gpui-kit").Context }) => void,
   * }} params
   */
  primaryFor({ agent, branch, skill, target, link, place, isBackground = false, isMergeReady = false, afterDone = null, links = [], start }) {
    const space = findSpaceOnBranch(branch);
    const action = getRowAction({
      isPreparing: preparing.has(target.label), agent: toRowAgent(agent),
      spaceName: space?.name ?? null, isMergeReady, skill, link, place, isBackground, target, afterDone, links,
    });
    /** @returns {(cx: import("gpui-kit").Context) => void} */
    const toRun = () => {
      switch (action.kind) {
        case "preparing": return () => {};
        case "agent": return () => focusAgent(agent);
        case "merge": return (cx) => cx.open_url(link.url);
        case "link": return (cx) => cx.open_url(action.url ?? link.url);
        case "nudge": return (cx) => start({ skill: action.skill ?? NUDGE_ENTRY, cx });
        case "resume": return () => run("space.select", { id: space.id });
        case "skill": return (cx) => { if (action.skill) start({ skill: action.skill, cx }); };
        default: {
          /** @type {never} */
          const unknownKind = action.kind;
          return unknownKind;
        }
      }
    };
    return { ...action, run: toRun() };
  }

  githubStore() {
    return `${STORE.github}|${this.repoId ?? "none"}`;
  }

  // Where a branch is checked out: a space on it (it may be in another repo), else one of the
  // focused repo's worktrees. null: nowhere known.
  /** @param {string | null} branch @returns {string | null} */
  worktreeFor(branch) {
    if (!branch) return null;
    const space = spaces().find((sp) => sp.branch === branch);
    return space?.folder ?? (cache.get(`wt|${this.repoId}`)?.result.items ?? []).find((w) => w.branch === branch)?.path ?? null;
  }

  // The repo's main checkout (the folder holding the shared .git), for new worktrees.
  repoMain() {
    return this.repoId?.endsWith("/.git") ? this.repoId.slice(0, -"/.git".length) : null;
  }

  // Merged worktrees, at the top of both lists: a banner with Clean up all and ✕, which expands
  // to one row per worktree with its own Remove. ✕ hides it until another worktree merges.
  cleanupNote() {
    const t = theme();
    // Alpha suffixes below need a 6-digit hex; every shipped theme has one for done.
    const done = t.done ?? t.accent;
    const merged = cache.get(`wt|${this.repoId}`)?.result.merged ?? [];
    const saved = shared(STORE.dismissedMerged);
    const dismissed = new Set(Array.isArray(saved) ? saved : []);
    if (merged.length === 0 || merged.every((w) => dismissed.has(w.path))) return [];
    const count = merged.length;
    const handleDismiss = (cx) => {
      // Only paths still merged are kept, so the list stays short.
      setShared(STORE.dismissedMerged, merged.map((w) => w.path));
      cx.notify();
    };
    const handleToggle = (cx) => { this.isMergedOpen = !this.isMergedOpen; cx.notify(); };
    const rose = t.blocked ?? t.accent;
    // Rows use the full width: the icon starts at the left edge, Remove ends at the right edge.
    const button = ({ id, label, variant, onClick }) => div().id(id).flex_none().w(88).h(24).flex().items_center().justify_center()
      .rounded(6).text_size(12).font_semibold().cursor_pointer()
      .when(variant === "primary", (el) => el.bg(done).text_color(t.solid_foreground ?? t.background).hover((s) => s.bg(done + "e6")))
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
      .child(label);
    // One 36px line, open or closed, so nothing moves on expand.
    const head = h_flex().id("wt-merged-head").h(36).px(10).gap(8).items_center().cursor_pointer()
      .tooltip(this.isMergedOpen ? "Hide the list" : "Show each worktree")
      .on_click((_e, cx) => handleToggle(cx))
      .child(svg(icon(this.isMergedOpen ? "chevron" : "chevron-right")).size(12).flex_none().text_color(done))
      .child(svg(icon("branch")).size(15).flex_none().text_color(done))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground)
        .child(`${count} worktree${count === 1 ? " is" : "s are"} merged`))
      .child(merged.some((w) => removing.has(w.path))
        ? h_flex().id("wt-merged-all").flex_none().w(88).h(24).gap(6).items_center().justify_center().rounded(6)
          .bg(done + "33").text_size(12).font_semibold().text_color(done)
          .child(svg("mods/workspace-chrome/spinner.svg").size(12).spin(900)).child("Removing")
        : button({ id: "wt-merged-all", label: count === 1 ? "Clean up" : "Clean up all", variant: "primary", onClick: () => this.openCleanup(merged) }))
      .child(div().id("wt-merged-dismiss").flex_none().size(24).flex().items_center().justify_center().rounded(6).cursor_pointer()
        .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Hide until another worktree merges")
        .on_click((_e, cx) => { cx.stop_propagation(); handleDismiss(cx); })
        .child(svg(icon("x")).size(13)));
    // A ref that opens its page; plain text when its URL isn't known.
    /** @param {{ id: string, text: string, url: string | null, tip: string, base: ReturnType<typeof div> }} params */
    const link = ({ id, text, url, tip, base }) => (url
      ? base.id(id).flex_none().cursor_pointer().hover((s) => s.text_color(t.accent)).tooltip(tip)
        .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); cx.open_url(url); }).child(text)
      : base.flex_none().child(text));
    const row = (w) => {
      const { key, title } = worktreeName(w);
      return h_flex().id(`wt-merged-${w.path}`).h(34).px(10).gap(8).items_center().border_t(1).border_color(done + "40")
        .child(svg(icon("branch")).size(15).flex_none().text_color(t.dim))
        .child(h_flex().flex_1().min_w(0).gap(6).items_center().text_size(12.5)
          .child(link({ id: `wt-key-${w.path}`, text: key, url: findLinearIssueUrl(key), tip: "Open in Linear", base: div().font_semibold().text_color(t.foreground) }))
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(title))
          .child(link({ id: `wt-pr-${w.path}`, text: `#${w.pr}`, url: w.prUrl ?? null, tip: "Open on GitHub", base: div().text_size(11.5).text_color(t.dim) })))
        // A red ✕ in the banner ✕'s column: removes this one worktree.
        .child(removing.has(w.path)
          ? div().id(`wt-remove-${w.path}`).flex_none().size(24).flex().items_center().justify_center().tooltip(`Removing ${key}…`)
            .child(svg("mods/workspace-chrome/spinner.svg").size(14).text_color(rose).spin(900))
          : div().id(`wt-remove-${w.path}`).flex_none().size(24).flex().items_center().justify_center().rounded(6).cursor_pointer()
            .bg(rose + "1f").text_color(rose).hover((s) => s.bg(rose + "40")).tooltip(`Remove ${key}`)
            .on_click((_e, cx) => { cx.stop_propagation(); this.openCleanup([w]); })
            .child(svg(icon("x")).size(13)));
    };
    return [v_flex().id("wt-merged").flex_none().mx(GUTTER - 4).mt(8).rounded(8).overflow_hidden()
      .bg(done + "1f").border(1).border_color(done + "59")
      .child(head)
      .when(Boolean(this.isMergedOpen), (el) => el.children(merged.map(row)))];
  }

  // A tab where no kind of row runs a skill (a fresh install): a line pointing to the settings.
  /** @param {"github" | "linear"} tab */
  skillsBanner(tab) {
    if (session.installedSkills === null || !hasNoDefaults({ skills: getRowSkills(), tab })) return [];
    return [this.note({
      id: `${tab}-skills-banner`,
      text: "Choose which skills your rows run.",
      action: { label: "Open settings", onClick: (/** @type {import("gpui-kit").Context} */ cx) => { this.settingsView.open({ cx, section: tab }); cx.notify(); } },
    })];
  }

  // The confirm dialog for removing some merged worktrees; its confirm runs `hub.cleanup`.
  openCleanup(items) {
    pendingCleanup = { main: this.repoMain(), repoId: this.repoId, machine: activeMachine(), items };
    const names = items.map((w) => `${worktreeName(w).key} (PR #${w.pr})`).join(", ");
    openOverlay({
      mod: "confirm", kind: "dialog", width: 460, height: 230,
      props: {
        title: items.length === 1 ? `Remove ${worktreeName(items[0]).key}?` : `Clean up ${items.length} merged worktrees?`,
        detail: `${names}.\n\nCloses their spaces, removes the worktree${items.length === 1 ? "" : "s"} and deletes the local branch${items.length === 1 ? "" : "es"}. A worktree with uncommitted changes is skipped.`,
        command: { name: "hub.cleanup" },
      },
    });
  }

  // Close each merged worktree's spaces, then remove the worktree and its branch.
  async runCleanup(cx) {
    const job = pendingCleanup;
    pendingCleanup = null;
    if (!job) return;
    const inside = (folder, path) => folder === path || folder?.startsWith(`${path}/`);
    const key = `wt|${job.repoId}`;
    // A removed worktree leaves the list at once; the refetch takes a few seconds.
    const drop = (path) => {
      const entry = cache.get(key);
      if (entry?.result.status !== "success") return;
      const keep = (w) => w.path !== path;
      cacheSet(key, { at: 0, result: { ...entry.result, items: entry.result.items.filter(keep), merged: entry.result.merged.filter(keep) } });
    };
    const removed = [];
    const skipped = [];
    // Each row shows a spinner until its worktree is removed or skipped.
    for (const w of job.items) removing.add(w.path);
    cx.notify();
    for (const w of job.items) {
      try {
        const tabsInside = new Set(panes().filter((p) => inside(p.cwd, w.path)).map((p) => p.tab));
        for (const space of spaces().filter((sp) => inside(sp.folder, w.path) || (sp.tabs ?? []).some((tab) => tabsInside.has(tab.id)))) {
          run("space.close", { id: space.id, confirmed: true });
        }
        const result = await removeWorktree({ main: job.main, path: w.path, branch: w.branch, machine: job.machine });
        if (result.status === "removed") drop(w.path);
        (result.status === "removed" ? removed : skipped).push(worktreeName(w).key);
      } finally {
        removing.delete(w.path);
        cx.notify();
      }
    }
    notify({
      title: removed.length ? `Cleaned up ${removed.join(", ")}` : "Nothing cleaned up",
      body: skipped.length ? `Skipped (uncommitted changes): ${skipped.join(", ")}` : undefined,
      level: skipped.length ? "warning" : "success",
    });
    const entry = cache.get(key);
    if (entry) cacheSet(key, { ...entry, at: 0 });
    cx.notify();
  }


  // A newly shown tab selects its row: a hub tab is named "<label> <skill>", else the
  // space's branch matches the row's. Only on a change, so j/k keep their pick meanwhile.
  followShownTab({ tab, items, label }) {
    const space = spaces().find((sp) => sp.active);
    const shownTab = space?.tabs.find((tb) => tb.active);
    if (!shownTab || shownTab.id === this.followedTab[tab] || items.length === 0) return;
    this.followedTab[tab] = shownTab.id;
    const item = items.find((i) => shownTab.name.startsWith(`${label(i)} `))
      ?? (space.branch ? items.find((i) => i.branch === space.branch) : undefined);
    if (!item) return;
    this.selected[tab] = item.id;
    this.scrollToRow[tab] = item.id;
  }

  scrollToFollowed({ tab, rows }) {
    const row = rows.find((r) => r.id === this.scrollToRow[tab]);
    if (!row) return;
    this.scrollToRow[tab] = null;
    this.scroll.scroll_to_item(row.index);
  }

  // ---------- GitHub ----------

  pullRequestEntry({ pr, group }) {
    const skills = getRowSkills();
    const situation = getGithubSituation({ pr, login: session.login });
    const entryLinks = getPullRequestLinks({ pr, login: session.login });
    // The case's actions the row can run, a rule's pick first.
    const rowActions = getPullRequestActions({ skills, pr, login: session.login, links: entryLinks });
    const skill = rowActions.main;
    const actions = rowActions.suggested;
    const target = { ref: pr.url, label: `#${pr.number}`, folder: this.folder };
    const agent = findAgentFor({ label: target.label, branch: pr.branch });
    // A link entry opens its page or nudges. Ready to merge: merging happens on GitHub. Else the case
    // says where (reviews: a background tab, so several can start in a row).
    /** @param {{ skill: string, cx: import("gpui-kit").Context }} params */
    const start = ({ skill: s, cx }) => {
      if (isLinkEntry(s)) {
        const entryLink = entryLinks.find((l) => l.entry === s);
        if (entryLink?.url) cx.open_url(entryLink.url);
        else if (entryLink) void nudgePullRequest(pr);
        return;
      }
      const { place, isBackground } = getRunFor({ tab: "github", situation, skill: s, target });
      void runSkill({ skill: s, target, role: getRole(s), isWorktree: place === "worktree", isBackground });
    };
    const runAt = skill && !isLinkEntry(skill) ? getRunFor({ tab: "github", situation, skill, target }) : { place: /** @type {const} */ ("here"), isBackground: true };
    const primary = this.primaryFor({
      agent, branch: pr.branch, skill, target, link: toGithubLink(pr.url), ...runAt, isMergeReady: group.id === "merge",
      afterDone: getCaseRun({ skills, tab: "github", situation }).afterDone, links: entryLinks, start,
    });
    const holder = { tone: group.tone, icon: PR_GROUP_GLYPH[group.id] ?? "github", tip: group.label };
    const menu = this.rowMenu({
      tab: "github", situation, suggested: actions, target, links: [toGithubLink(pr.url)], entryLinks, reason: rowActions.reason, agent, rowId: pr.id,
      pullRequest: isMyPullRequest({ pr, login: session.login }) ? "mine" : "others",
    });
    const openDetails = () => {
      const details = getRowDetails({
        row: { kind: "pullRequest", pr, groupId: group.id, login: session.login }, skills, menu: menu.sections, agent: toRowAgent(agent),
        worktree: this.worktreeFor(pr.branch), repoMain: this.repoMain(), main: primary.skill,
      });
      const repo = repoNames.get(this.repoId);
      openRowDetails({
        ...details, tab: "github", rowId: pr.id, situation, holder, title: pr.title, agentTab: menu.agent,
        refs: [`#${pr.number}`, ...(repo ? [repo] : []), ...(details.owner ? [details.owner] : [])],
        caseLabel: getCaseLabel({ tab: "github", situation }),
      });
    };
    const element = this.strip({
      id: pr.id, title: pr.title, isTitleDim: pr.isDraft, primary, holder, menu, openDetails,
      meta: this.metaLine({
        id: `pr-${pr.number}`,
        refs: [{ text: `#${pr.number}`, url: pr.url, tip: pr.branch ? `Open on GitHub · ${pr.branch}` : "Open on GitHub" }],
        facts: getPullRequestFacts({ pr, groupId: group.id, login: session.login }),
        labels: pr.labels, labelColors: pr.labelColors,
      }),
    });
    return {
      id: pr.id, url: pr.url, element, primary: primary.run, actions, openDetails, start,
    };
  }

  // The shown repo above the list; opens it on GitHub.
  repoLink(repo) {
    const t = theme();
    return h_flex().px(GUTTER - 6).pt(10).pb(2).child(h_flex().id("repo-link").min_w(0).px(6).py(3).gap(6).items_center().rounded(5).cursor_pointer()
      .text_size(12.5).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Open on GitHub")
      .on_click((_e, cx) => cx.open_url(`https://github.com/${repo}`))
      .child(svg(icon("github")).size(13).flex_none())
      .child(div().truncate().child(repo)));
  }

  githubView() {
    const t = theme();
    const store = this.githubStore();
    const f = getFilters(store);
    // While a new search or filter loads, keep showing the last list of this repo.
    const fresh = cache.get(this.githubKey)?.result;
    if (fresh) this.lastGithub = { repoId: this.repoId, result: fresh };
    const result = fresh ?? (this.lastGithub && this.lastGithub.repoId === this.repoId ? this.lastGithub.result : undefined);
    const items = result?.items ?? [];
    const search = this.githubSearch.value();
    const isPasted = isGithubQuery(this.committedSearch);
    const shown = filterPullRequests({ items, filters: f, login: session.login, isShowingReviewed: this.isShowingReviewed, search: this.committedSearch });
    const org = repoNames.get(this.repoId)?.split("/")[0];
    const teamOptions = [...new Map([
      ...f.teams.map((value) => [value, value.split("/").pop()]),
      ...(myTeams.get(org) ?? []).map((team) => [team.value, team.label]),
    ]).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    const reviewedCount = isReviewScope(f.scope) && !isPasted ? items.filter((pr) => getMyReviewState({ pr, login: session.login }) === "reviewed").length : 0;
    const defs = [
      { title: "Author", field: "authors", isMulti: true, options: getAuthorOptions({ users: repoUsers.get(this.repoId) ?? [], logins: [...items.map((p) => p.author), ...f.authors] }) },
      { title: "Label", field: "labels", isMulti: true, options: toOptions([...(repoLabels.get(this.repoId) ?? []), ...f.labels]) },
      { title: "Team", field: "teams", isMulti: true, options: teamOptions },
      { title: "Reviews", field: "reviews", isMulti: false, options: REVIEW_OPTIONS },
      {
        title: "Assignee", field: "assignees", isMulti: true,
        options: [{ value: NO_ASSIGNEE, label: "Assigned to nobody" }, ...toOptions([...items.flatMap((p) => p.assignees), ...f.assignees.filter((a) => a !== NO_ASSIGNEE)])],
      },
      { title: "CI", field: "checks", isMulti: false, options: CI_OPTIONS },
      { title: "Sort", field: "sort", isMulti: false, options: SORT_OPTIONS },
    ];
    const handleClear = () => { this.githubSearch.set_value(""); setShared(store, { ...GITHUB_DEFAULTS, scope: f.scope }); };
    const state = this.listState({
      source: result, label: "GitHub", shownCount: shown.length, onClear: handleClear,
      hasFilters: defs.some((def) => countPicked({ store, def }) > 0) || search.trim() !== "",
    });
    // Notes, headers and rows side by side, so a row's child index is known for scrolling.
    const notes = [
      ...this.skillsBanner("github"),
      ...this.cleanupNote(),
      ...(isPasted ? [this.note({ id: "gh-pasted", text: "Running your GitHub query as is. Show and Filters are off until you clear it." })] : []),
    ];
    const elements = [...notes];
    const selectable = [];
    this.followShownTab({ tab: "github", items: shown, label: (pr) => `#${pr.number}` });
    for (const group of groupPullRequests({ items: shown, login: session.login })) {
      const headerId = `pr-${group.id}`;
      elements.push(this.listHeader({ id: headerId, label: group.label, count: group.items.length }));
      if (isCollapsed(headerId)) continue;
      for (const pr of group.items) {
        const entry = this.pullRequestEntry({ pr, group });
        selectable.push({ ...entry, index: elements.length });
        elements.push(entry.element);
      }
    }
    this.visible.github = selectable;
    this.scrollToFollowed({ tab: "github", rows: selectable });
    const repo = repoNames.get(this.repoId);
    const footer = [
      ...(reviewedCount > 0 ? [this.note({
        id: "gh-reviewed",
        text: this.isShowingReviewed ? `Showing ${reviewedCount} you already reviewed.` : `${reviewedCount} you already reviewed hidden.`,
        action: { label: this.isShowingReviewed ? "Hide" : "Show", onClick: (cx) => { this.isShowingReviewed = !this.isShowingReviewed; cx.notify(); } },
      })] : []),
      ...(result?.status === "success" && result.total > items.length ? [this.loadMoreFooter({ shown: items.length, total: result.total, hasMore: result.hasMore })] : []),
    ];
    return v_flex().flex_1().min_h(0)
      .child(v_flex().px(GUTTER).pt(12).pb(12).gap(6).border_b(1).border_color(t.border)
        .child(this.searchRow({ store, scopeDef: { title: "Show", field: "scope", isMulti: false, options: GITHUB_SCOPES }, state: this.githubSearch, defs })))
      .when(Boolean(repo), (el) => el.child(this.repoLink(repo)))
      .child(this.list({ id: "gh-list", state, notes, entries: [...elements, ...footer] }));
  }

  // ---------- Linear ----------

  issueEntry({ issue, showAssignee }) {
    const situation = getLinearSituation(issue);
    const rowSkills = getRowSkills();
    const pullRequest = getTicketPullRequest(issue);
    // The case's skills the ticket can run, a rule's pick first.
    const rowActions = getTicketActions({ skills: rowSkills, issue });
    const skill = rowActions.main;
    const stage = getIssueStage(issue);
    const space = issue.branch ? spaces().find((sp) => sp.branch === issue.branch) : undefined;
    const worktree = this.worktreeFor(issue.branch);
    const target = {
      ref: issue.identifier, prRef: issue.prUrl, label: issue.identifier, branch: issue.branch, main: this.repoMain(), issue,
      ...(worktree ? { worktree } : {}), ...(space ? { space: space.id } : {}),
    };
    const agent = findAgentFor({ label: issue.identifier, branch: issue.branch });
    const skills = rowActions.suggested;
    const link = toLinearLink(issue.url);
    const menu = this.rowMenu({ tab: "linear", situation, suggested: skills, target, links: [link], reason: rowActions.reason, agent, pullRequest, rowId: issue.id, isTicket: true });
    const runAt = skill ? getRunFor({ tab: "linear", situation, skill, target }) : { place: /** @type {const} */ ("here"), isBackground: false };
    const primary = this.primaryFor({
      agent, branch: issue.branch, skill, target, link, ...runAt, afterDone: getCaseRun({ skills: rowSkills, tab: "linear", situation }).afterDone,
      start: ({ skill: s }) => startTicketSkill({ skill: s, menu }),
    });
    const priority = PRIORITY_OPTIONS.find((p) => p.value === issue.priority);
    const isPressing = issue.priority === URGENT || issue.priority === HIGH;
    const holder = { tone: STAGE_STATUS[stage], icon: `state-${stage}`, tip: issue.state };
    const openDetails = () => {
      const details = getRowDetails({
        row: { kind: "issue", issue }, skills: rowSkills, menu: menu.sections, agent: toRowAgent(agent), worktree, repoMain: this.repoMain(), main: primary.skill,
      });
      openRowDetails({
        ...details, tab: "linear", rowId: issue.id, situation, holder, title: issue.title, agentTab: menu.agent,
        links: [...details.links, ...(issue.prUrl ? [{ ...toGithubLink(issue.prUrl), entry: null }] : [])],
        refs: [issue.identifier, ...(issue.team ? [issue.team] : []), ...(details.owner ? [details.owner] : [])],
        caseLabel: getCaseLabel({ tab: "linear", situation }),
      });
    };
    const element = this.strip({
      id: issue.id, title: issue.title, primary, holder, openDetails,
      meta: this.metaLine({
        id: issue.identifier,
        refs: [
          { text: issue.identifier, url: issue.url, tip: "Open in Linear" },
          ...(issue.prUrl ? [{ text: `#${issue.prUrl.split("/").pop()}`, url: issue.prUrl, tip: "Open on GitHub" }] : []),
        ],
        facts: [
          ...(isPressing && priority ? [priority.label.toLowerCase()] : []),
          ...(issue.project ? [issue.project] : []),
          ...(showAssignee ? [issue.assignee ?? UNASSIGNED] : []),
        ],
        labels: issue.labels, labelColors: issue.labelColors,
      }),
      menu,
    });
    return {
      id: issue.id, url: issue.url, element, primary: primary.run, actions: skills, openDetails,
      start: (/** @type {string} */ s) => startTicketSkill({ skill: s, menu }),
    };
  }

  linearView() {
    const t = theme();
    const store = STORE.linear;
    const f = getFilters(store);
    const result = cache.get(this.linearKey)?.result;
    const items = result?.items ?? [];
    const search = this.linearSearch.value();
    const shown = filterIssues({ items, filters: f, search });
    const defs = [
      { title: "Team", field: "teams", isMulti: true, options: session.meta.teams },
      { title: "Project", field: "projects", isMulti: true, options: getProjectOptions({ projects: session.meta.projects, teams: f.teams }) },
      { title: "Status", field: "statuses", isMulti: true, options: toOptions([...items.map((i) => i.state), ...f.statuses]) },
      { title: "Priority", field: "priorities", isMulti: true, options: PRIORITY_OPTIONS },
      { title: "Label", field: "labels", isMulti: true, options: toOptions([...items.flatMap((i) => i.labels), ...f.labels]) },
      ...(f.mine ? [] : [{ title: "Assignee", field: "assignees", isMulti: true, options: [{ value: UNASSIGNED, label: UNASSIGNED }, ...toOptions(items.map((i) => i.assignee))] }]),
      { title: "Sort", field: "sort", isMulti: false, options: LINEAR_SORT_OPTIONS },
    ];
    const handleClear = () => { this.linearSearch.set_value(""); setShared(store, { ...LINEAR_DEFAULTS, mine: f.mine }); };
    const state = this.listState({
      source: cache.get(this.linearKey)?.result, label: "Linear", shownCount: shown.length, onClear: handleClear,
      hasFilters: defs.some((def) => countPicked({ store, def }) > 0) || search.trim() !== "",
    });
    // Notes, headers and rows side by side, so a row's child index is known for scrolling.
    const notes = [...this.skillsBanner("linear"), ...this.cleanupNote()];
    const elements = [...notes];
    const selectable = [];
    this.followShownTab({ tab: "linear", items: shown, label: (issue) => issue.identifier });
    for (const group of groupIssuesByState(shown, f.sort)) {
      const headerId = `ln-${group.state}`;
      elements.push(this.listHeader({ id: headerId, label: group.state, count: group.items.length }));
      if (isCollapsed(headerId)) continue;
      for (const issue of group.items) {
        const entry = this.issueEntry({ issue, showAssignee: !f.mine });
        selectable.push({ ...entry, index: elements.length });
        elements.push(entry.element);
      }
    }
    this.visible.linear = selectable;
    this.scrollToFollowed({ tab: "linear", rows: selectable });
    if (result?.isCapped) elements.push(this.note({ id: "ln-cap", text: "Showing the 100 most recently updated. Narrow the filters to see more." }));
    return v_flex().flex_1().min_h(0)
      .child(v_flex().px(GUTTER).pt(12).pb(12).gap(6).border_b(1).border_color(t.border)
        .child(this.searchRow({ store, scopeDef: { title: "Show", field: "mine", isMulti: false, options: LINEAR_SCOPES }, state: this.linearSearch, defs })))
      .child(this.list({ id: "ln-list", state, notes, entries: elements }));
  }

  // ---------- settings ----------

  // The Linear lists and filters load again with the new key, or show the key field without one.
  /** @param {import("gpui-kit").Context} cx */
  reloadLinear(cx) {
    for (const key of [...cache.keys()]) if (key.startsWith("ln|")) cache.delete(key);
    session.meta = { status: "idle", teams: [], projects: [] };
    if (getPanelSettings().shouldShowLinear) this.loadMeta(cx);
    this.tick(cx);
  }

  // ---------- cases ----------

  // The rows the panel's lists show now, of a tab; null while its list is not loaded.
  /**
   * @param {import("./settings.js").Tab} tab
   * @returns {{ ref: string, situation: import("./settings.js").Situation, toPreview: () => import("./case-editor.js").CasePreview }[] | null}
   */
  shownItems(tab) {
    switch (tab) {
      case "github": {
        const result = cache.get(this.githubKey)?.result;
        if (result?.status !== "success") return null;
        return filterPullRequests({ items: result.items, filters: getFilters(this.githubStore()), login: session.login, isShowingReviewed: this.isShowingReviewed, search: this.committedSearch })
          .map((/** @type {PullRequestItem} */ pr) => ({ ref: `#${pr.number}`, situation: getGithubSituation({ pr, login: session.login }), toPreview: () => this.pullRequestPreview(pr) }));
      }
      case "linear": {
        const result = cache.get(this.linearKey)?.result;
        if (result?.status !== "success") return null;
        return filterIssues({ items: result.items, filters: getFilters(STORE.linear), search: this.linearSearch.value() })
          .map((/** @type {IssueItem} */ issue) => ({ ref: issue.identifier, situation: getLinearSituation(issue), toPreview: () => this.issuePreview(issue) }));
      }
      case "oncall": return this.oncallView.shownItems();
      default: {
        /** @type {never} */
        const unknownTab = tab;
        return unknownTab;
      }
    }
  }

  // How many of the shown rows a case matches, and their refs.
  /** @param {{ tab: import("./settings.js").Tab, situation: import("./settings.js").Situation }} params */
  getCaseMatches({ tab, situation }) {
    const items = this.shownItems(tab);
    if (!items) return null;
    const refs = items.filter((item) => item.situation === situation).map((item) => item.ref);
    return { count: refs.length, refs };
  }

  /** @param {PullRequestItem} pr @returns {import("./case-editor.js").CasePreview} */
  pullRequestPreview(pr) {
    const groupId = getPullRequestGroup({ pr, login: session.login });
    const group = PULL_REQUEST_GROUPS.find((g) => g.id === groupId);
    return {
      title: pr.title, meta: [`#${pr.number}`, ...getPullRequestFacts({ pr, groupId, login: session.login })].join(" · "),
      holder: { tone: group?.tone ?? "quiet", icon: PR_GROUP_GLYPH[groupId] ?? "github" }, targetLabel: `#${pr.number}`,
      isMergeReady: groupId === "merge", hasWorktreeTarget: false, hasWorktree: false, oncall: null,
      source: { kind: "pullRequest", pr, login: session.login, links: getPullRequestLinks({ pr, login: session.login }) },
    };
  }

  /** @param {IssueItem} issue @returns {import("./case-editor.js").CasePreview} */
  issuePreview(issue) {
    const stage = getIssueStage(issue);
    return {
      title: issue.title, meta: [issue.identifier, issue.state, ...(issue.project ? [issue.project] : [])].join(" · "),
      holder: { tone: STAGE_STATUS[stage], icon: `state-${stage}` }, targetLabel: issue.identifier, isMergeReady: false,
      hasWorktreeTarget: Boolean(this.repoMain() && issue.branch), hasWorktree: Boolean(this.worktreeFor(issue.branch)), oncall: null,
      source: { kind: "issue", issue },
    };
  }

  // The case editor dialog, with the rows the case matches now and the first of them as its preview.
  /** @param {{ tab: import("./settings.js").Tab, situation: import("./settings.js").Situation }} params */
  openCaseEditorFor({ tab, situation }) {
    const first = this.shownItems(tab)?.find((item) => item.situation === situation);
    openCaseEditor({
      editor: { tab, situation, matches: this.getCaseMatches({ tab, situation }), preview: first ? first.toPreview() : null },
      skills: getPanelSettings().skills,
    });
  }

  // The list groups Start collapsed offers: GitHub's, and the Linear states shown now.
  getGroupOptions() {
    const linear = cache.get(this.linearKey)?.result;
    /** @type {string[]} */
    const states = linear?.status === "success" ? [...new Set(linear.items.map((/** @type {{ state: string }} */ issue) => issue.state))] : [];
    return [
      ...PULL_REQUEST_GROUPS.map((g) => ({ value: `pr-${g.id}`, label: `GitHub · ${g.label}` })),
      ...states.map((state) => ({ value: `ln-${state}`, label: `Linear · ${state}` })),
    ];
  }

  // Each tick: a row's agent that just turned to needing you notifies once, its click goes to the agent.
  watchAgents() {
    const github = cache.get(this.githubKey)?.result;
    const linear = cache.get(this.linearKey)?.result;
    const rows = [
      ...(github?.status === "success" ? github.items.map((/** @type {PullRequestItem} */ pr) => ({
        id: `pr-${pr.id}`, ref: `#${pr.number}`, title: pr.title, agent: findAgentFor({ label: `#${pr.number}`, branch: pr.branch }),
      })) : []),
      ...(linear?.status === "success" ? linear.items.map((/** @type {IssueItem} */ issue) => ({
        id: `ln-${issue.id}`, ref: issue.identifier, title: issue.title, agent: findAgentFor({ label: issue.identifier, branch: issue.branch }),
      })) : []),
    ];
    const { notices, next } = getNewlyBlocked({ previous: agentStatuses, rows: rows.map((row) => ({ ...row, status: row.agent?.status ?? null })) });
    agentStatuses = next;
    if (!getPanelSettings().shouldNotifyBlocked) return;
    for (const notice of notices) {
      const agent = rows.find((row) => row.id === notice.id)?.agent;
      if (!agent) continue;
      blockedAgent = { space: agent.space, tab: agent.tab };
      notify({ title: `${notice.ref} needs you`, body: notice.title, level: "warning", action: { name: "hub.agent-needs-you" } });
    }
  }

  // The On-call rows' skills: the settings' ones that can run here.
  getOncallSkills() {
    return getRowSkills();
  }

  // The agent on an On-call row's issue (in a tab named after its short id), and as row-action.js reads it.
  /** @param {string} label */
  findOncallAgent(label) {
    const agent = findAgentFor({ label, branch: null });
    return { agent, rowAgent: toRowAgent(agent) };
  }

  // The Linear tab is showing its key field: ⚙ then opens on the Linear section.
  isLinearKeyMissing() {
    const result = cache.get(this.linearKey)?.result;
    return currentTab() === "linear" && result?.status === "error" && result.reason === "auth";
  }

  // ---------- menu popup ----------

  // Every pickable row registers here, in order, so ↑/↓ and ↵ can reach it.
  registerMenuItem({ onClick, scroll = null }) {
    const index = this.menuItems.length;
    this.menuItems.push({ onClick, scroll });
    return index === this.menuIndex;
  }

  // An action row gets a leading `actionIcon`; a choice row (`isChecked` set) gets a leading checkbox.
  // isDisabled: dimmed, not clickable and skipped by ↑/↓. isLoading: a spinner in place of the icon.
  // onEdit, onRemove: a trailing ✎ and ✕, like a saved filter set's rename and delete.
  /**
   * @param {{ id: string, label: string, actionIcon?: string | null, iconColor?: string | null, isChecked?: boolean | null,
   *   onClick: (cx: import("gpui-kit").Context) => void, scroll?: { handle: any, index: number } | null, isDisabled?: boolean, isLoading?: boolean,
   *   onRemove?: (() => void) | null, onEdit?: (() => void) | null, hint?: string | null }} params
   */
  menuRow({ id, label, actionIcon = null, iconColor = null, isChecked = null, onClick, scroll = null, isDisabled = false, isLoading = false, onRemove = null, onEdit = null, hint = null }) {
    const t = theme();
    if (isDisabled) {
      return h_flex().id(id).h(MENU_ROW_HEIGHT).flex_none().px(9).gap(8).items_center().rounded(6).bg(t.popover).text_color(t.dim)
        .child(isLoading
          ? svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working).spin(900)
          : svg(icon(actionIcon ?? "x")).size(11).flex_none().text_color(t.dim))
        .child(div().flex_1().truncate().child(label));
    }
    const isActive = this.registerMenuItem({ onClick, scroll });
    return h_flex().id(id).h(MENU_ROW_HEIGHT).flex_none().px(9).gap(8).items_center().rounded(6).cursor_pointer()
      .bg(isActive ? t.selected : t.popover).text_color(t.foreground).hover((s) => s.bg(t.selected)).on_click((_e, cx) => onClick(cx))
      .when(isChecked !== null, (el) => el.child(svg(icon(isChecked ? "checkbox-checked" : "checkbox")).size(14).flex_none().text_color(isChecked ? t.accent : t.dim)))
      .when(Boolean(actionIcon), (el) => el.child(svg(icon(actionIcon)).size(11).flex_none().text_color(iconColor ?? t.accent)))
      .child(div().flex_1().truncate().child(label))
      // The key that starts it on the selected row.
      .when(Boolean(hint), (el) => el.child(div().flex_none().font_family(MONO_FONT).text_size(11).text_color(t.dim).child(hint)))
      .when(Boolean(onEdit), (el) => el.child(div().id(`${id}-edit`).size(18).flex_none().flex().items_center().justify_center().rounded(4)
        .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Rename")
        .on_click((_e, cx) => { cx.stop_propagation(); onEdit?.(); })
        .child(svg(icon("pencil")).size(11))))
      .when(Boolean(onRemove), (el) => el.child(div().id(`${id}-remove`).size(18).flex_none().flex().items_center().justify_center().rounded(4)
        .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Delete")
        .on_click((_e, cx) => { cx.stop_propagation(); onRemove?.(); cx.notify(); })
        .child(svg(icon("x")).size(10))));
  }

  handleMenuKey(e, cx) {
    const count = this.menuItems.length;
    if (count === 0) return;
    const move = (step) => {
      this.menuIndex = Math.max(0, Math.min(count - 1, this.menuIndex + step));
      const scroll = this.menuItems[this.menuIndex]?.scroll;
      if (scroll) scroll.handle.scroll_to_item(scroll.index);
    };
    if (e.key === "down") move(1);
    else if (e.key === "up") move(-1);
    else if (e.key === "enter") this.menuItems[this.menuIndex]?.onClick(cx);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  matchesMenuSearch(label) {
    return String(label).toLowerCase().includes(this.menuSearch.value().trim().toLowerCase());
  }

  optionRows({ store, def, scrollHandle }) {
    if (def.field === SAVED_FIELD) return this.savedSetRows({ store });
    const value = getFilters(store)[def.field];
    const isPinned = (o) => def.isMulti && this.pinned.has(`${def.field}:${o.value}`);
    const options = def.options.filter((o) => this.matchesMenuSearch(o.label))
      .sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)));
    if (options.length === 0) return [div().flex_none().px(9).py(6).text_color(theme().dim).child(def.options.length ? "No matches" : "No options yet")];
    const firstIndex = this.menuItems.length;
    return options.map((o, i) => {
      const isChecked = def.isMulti ? value.includes(o.value) : value === o.value;
      return this.menuRow({
        // The list's own children: a group title (in a combined menu) may sit before them.
        id: `opt-${def.field}-${o.value}`, label: o.label, isChecked,
        scroll: scrollHandle ? { handle: scrollHandle, index: firstIndex - this.menuListOffset + i } : null,
        onClick: () => {
          const next = def.isMulti ? (isChecked ? value.filter((v) => v !== o.value) : [...value, o.value]) : o.value;
          patchFilters({ store, patch: { [def.field]: next } });
          if (!def.isMulti && !props().menu.isFilterList) closeOverlay(props().overlay);
        },
      });
    });
  }

  // "3 picked · Clear" under a multiselect's options; it stays open while picking.
  /** @param {{ store: string, def: { field: string } }} params */
  multiFooter({ store, def }) {
    const t = theme();
    const count = getFilters(store)[def.field].length;
    return h_flex().id(`multi-footer-${def.field}`).h(MENU_FOOTER_HEIGHT - 4).flex_none().px(9).gap(6).items_center().text_size(12)
      .child(div().flex_1().text_color(t.dim).child(count > 0 ? `${count} picked` : "None picked"))
      .when(count > 0, (el) => el.child(div().id(`multi-clear-${def.field}`).px(6).py(2).rounded(5).text_color(t.accent).cursor_pointer().hover((s) => s.bg(t.selected))
        .on_click((_e, cx) => { patchFilters({ store, patch: { [def.field]: [] } }); cx.notify(); })
        .child("Clear")));
  }

  // The scope picker's saved sets: ✓ on the one in use, ✎ to rename, ✕ to delete.
  savedSetRows({ store }) {
    // Read fresh, not from the menu's props: a set deleted here leaves the list at once.
    const sets = getSavedSets(store);
    const active = findActiveSet({ sets, filters: getFilters(store), defaults: defaultsFor(store) });
    if (sets.length === 0) return [div().flex_none().px(9).py(6).text_color(theme().dim).child("No saved filters")];
    return sets.filter((set) => this.matchesMenuSearch(set.name)).map((set) => this.menuRow({
      id: `saved-${set.id}`, label: `★ ${set.name}`, isChecked: active?.id === set.id,
      onClick: () => { applySavedSet({ store, id: set.id }); closeOverlay(props().overlay); },
      onRemove: () => setShared(SAVED_FILTERS_STORE, removeFilterSet({ saved: shared(SAVED_FILTERS_STORE), tab: tabOfStore(store), id: set.id })),
      onEdit: () => {
        closeOverlay(props().overlay);
        openOverlay({ mod: "hub", kind: "popup", ...SAVE_POPUP_SIZE, at: "pointer", props: { saveFilters: { tab: tabOfStore(store), filters: set.filters, name: set.name, editId: set.id } } });
      },
    }));
  }

  // A row's ▾ menu (row-action.js getRowMenu): its sections, a line between them.
  /** @param {Record<string, any>} menu */
  skillRows(menu) {
    const t = theme();
    /** @param {{ skill: string, place: import("./row-action.js").RunPlace, isBackground: boolean, cx: import("gpui-kit").Context }} params */
    const handleSkill = ({ skill, place, isBackground, cx }) => {
      if (place === "ask") {
        this.askSkill = skill;
        this.menuIndex = 0;
        cx.notify();
        return;
      }
      this.queueStart({ skill, target: menu.target, role: getRole(skill), isWorktree: place === "worktree", isBackground });
    };
    const close = () => closeOverlay(props().overlay);
    /** @param {{ label: string, reason?: string | null }} params */
    const withReason = ({ label, reason }) => (reason ? `${label} · ${reason}` : label);
    /** @param {import("./row-action.js").RowMenuItem} item */
    const itemRow = (item) => {
      switch (item.kind) {
        case "skill": {
          // An On-call row's skill runs on its issue, from here.
          if (menu.tab === "oncall") {
            return this.menuRow({
              id: `skill-${item.skill}`, label: item.skill, actionIcon: "play", hint: item.key,
              onClick: () => { runSkillOnIssue({ skill: item.skill, ...menu.oncall }); close(); },
            });
          }
          const { place, isBackground } = getRunFor({ tab: menu.tab, situation: menu.situation, skill: item.skill, target: menu.target });
          return this.menuRow({
            id: `skill-${item.skill}`, label: withReason({ label: item.skill, reason: item.reason }), actionIcon: place === "worktree" ? "branch" : "play", hint: item.key,
            onClick: (cx) => handleSkill({ skill: item.skill, place, isBackground, cx }),
          });
        }
        case "link": return this.menuRow({
          id: `link-${item.label}`, label: item.label, actionIcon: item.icon, iconColor: t.muted,
          onClick: (cx) => { cx.open_url(item.url); close(); },
        });
        // A page opens from here; the nudge runs gh, so the panel runs it on the row (`hub.row-start`).
        case "linkEntry": return this.menuRow({
          id: `entry-${item.entry}`, label: withReason({ label: item.label, reason: item.reason }), actionIcon: item.icon, iconColor: t.muted, hint: item.key,
          onClick: (cx) => {
            if (item.url) {
              cx.open_url(item.url);
              close();
              return;
            }
            pendingRowStart = { tab: menu.tab, rowId: menu.rowId, skill: item.entry };
            close();
            run("hub.row-start");
          },
        });
        // A re-run writes a file first: the popup stays until it is written, or closing would cancel it.
        // While one is pending (or the AI is on the issue), Re-run spins and can't be clicked again.
        case "oncall": {
          const isTriaging = item.id === "rerun" && Boolean(menu.oncall.isTriaging);
          return this.menuRow({
            id: `oncall-${item.id}`, label: isTriaging ? "Triaging…" : ONCALL_MENU_ITEMS[item.id].label, actionIcon: ONCALL_MENU_ITEMS[item.id].icon,
            iconColor: t.muted, hint: item.key, isDisabled: isTriaging, isLoading: isTriaging,
            onClick: (cx) => {
              cx.spawn(async () => {
                await runOncallAction({ action: item.id, decision: menu.oncall.decision, config: menu.oncall.config });
                close();
              });
            },
          });
        }
        case "agent": return this.menuRow({
          id: "agent", label: "Go to agent tab", actionIcon: "resume", iconColor: t.muted,
          onClick: () => { focusAgent(menu.agent); close(); },
        });
        case "details": return this.menuRow({
          id: "details", label: "Details", actionIcon: "chevron-right", iconColor: t.muted, hint: "space",
          onClick: () => { pendingDetails = { tab: menu.tab, rowId: menu.rowId }; close(); run("hub.details"); },
        });
        case "editCase": return this.menuRow({
          id: "edit-case", label: "Edit this case", actionIcon: "settings", iconColor: t.muted,
          onClick: () => { pendingCaseEdit = { tab: menu.tab, situation: menu.situation }; close(); run("hub.edit-case"); },
        });
        // A panel command (`hub.oncall-triage`), for a menu that is not a row's.
        case "command": return this.menuRow({
          id: `command-${item.id}`, label: item.label, actionIcon: item.icon, iconColor: t.muted,
          onClick: () => { close(); run(item.command); },
        });
        default: {
          /** @type {never} */
          const unknownItem = item;
          return unknownItem;
        }
      }
    };
    /** @type {import("./row-action.js").RowMenuSection[]} */
    const sections = menu.sections ?? [];
    return sections.flatMap((section, index) => [
      ...(index > 0 ? [this.menuSeparator(section.id)] : []),
      ...(section.title ? [div().h(MENU_SECTION_TITLE_HEIGHT).flex_none().px(9).pt(4).flex().items_center().text_size(10.5).font_semibold().text_color(t.dim)
        .child(section.title.toUpperCase())] : []),
      ...section.items.map(itemRow),
    ]);
  }

  // A row's ▾ menu: its case's actions first, then the tab's other skills, links, Details and Edit this case.
  /**
   * @param {{ tab: "github" | "linear", situation: import("./settings.js").Situation, suggested: string[], target: Record<string, any>,
   *   links: ReturnType<typeof toGithubLink>[], agent: ReturnType<typeof findAgentFor>, pullRequest: import("./settings.js").PullRequestOwner,
   *   rowId: string, isTicket?: boolean, entryLinks?: import("./row-action.js").RowLinkEntry[], reason?: string | null }} params
   */
  rowMenu({ tab, situation, suggested, target, links, agent, pullRequest, rowId, isTicket = false, entryLinks = [], reason = null }) {
    const skills = getRowSkills();
    const sections = getRowMenu({
      suggested, list: skills[tab].list, links, hasAgent: Boolean(agent), reviewSkills: getReviewSkills({ skills, tab }), pullRequest, entryLinks, reason,
    });
    return { skills: suggested, sections, target, tab, situation, rowId, isTicket, agent: agent ? { space: agent.space, tab: agent.tab } : null };
  }

  // A ticket's first run: "THU-123 · where should plan run?": New worktree (its branch) / This space
  // (the shown space), then Back.
  askRows({ skill, target }) {
    const t = theme();
    const title = div().h(MENU_TITLE_HEIGHT).flex_none().px(9).flex().items_center().text_size(11.5).text_color(t.muted).truncate()
      .child(`${target.label} · where should ${shortSkill(skill)} run?`);
    const back = this.menuRow({
      id: "where-back", label: "Back", actionIcon: "chevron-left", iconColor: t.muted,
      onClick: (cx) => { this.askSkill = null; this.menuIndex = NO_MENU_ROW; cx.notify(); },
    });
    /** @type {Record<string, string | null>} */
    const hints = { worktree: target.branch ?? null, here: spaces().find((sp) => sp.active)?.name ?? null };
    return [title, ...WHERE_OPTIONS.map((o) => this.menuRow({
      id: `where-${o.id}`, label: o.label, actionIcon: o.icon, hint: hints[o.id],
      onClick: () => this.queueStart({ skill, target, role: getRole(skill), isWorktree: o.isWorktree }),
    })), this.menuSeparator("back"), back];
  }

  menuSeparator(id) {
    return div().id(`sep-${id}`).h(1).flex_none().my(3).bg(theme().border);
  }

  // The panel runs the start (`hub.start`): this popup closes, which would cancel its async work.
  queueStart(start) {
    pendingStart = start;
    closeOverlay(props().overlay);
    run("hub.start");
  }

  // A search shrinks the list, so it scrolls back to the top; a kept offset would show it empty.
  handleMenuSearchChange() {
    this.menuIndex = this.expanded ? this.firstOptionIndex ?? 0 : 0;
    this.optionScroll.scroll_to_item(0);
    this.menuScroll.scroll_to_item(0);
  }

  menuSearchBox() {
    const t = theme();
    return h_flex().h(30).flex_none().px(8).gap(6).items_center().rounded(6).border(1).border_color(t.input).bg(t.background)
      .child(svg(icon("search")).size(13).text_color(t.dim))
      .child(Input.new(this.menuSearch).flex_1().text_size(12).text_color(t.foreground))
      .child(this.clearButton({ id: "clear-menu", state: this.menuSearch, onClear: () => this.handleMenuSearchChange() }));
  }

  // The Filters popover: one row per filter; clicking a row opens its options in place (one at a time).
  filterListRows(menu) {
    const t = theme();
    const { store, groups } = menu;
    const total = groups.reduce((sum, def) => sum + countPicked({ store, def }), 0);
    const rows = groups.flatMap((def) => {
      const count = countPicked({ store, def });
      const isOpen = this.expanded === def.field;
      const handleToggle = (cx) => {
        this.expanded = isOpen ? null : def.field;
        this.menuSearch.set_value("");
        this.shouldSelectFirstOption = !isOpen;
        if (!isOpen) this.menuSearch.focus();
        cx.notify();
      };
      const isActive = this.registerMenuItem({ onClick: handleToggle });
      const header = h_flex().id(`fl-${def.field}`).h(MENU_ROW_HEIGHT).flex_none().px(9).gap(6).items_center().rounded(6).cursor_pointer()
        .bg(isOpen || isActive ? t.selected : t.popover).text_color(count > 0 || isOpen ? t.foreground : t.muted)
        .hover((s) => s.bg(t.selected).text_color(t.foreground))
        .on_click((_e, cx) => handleToggle(cx))
        .child(div().flex_1().child(def.title))
        .when(count > 0, (el) => el.child(div().px(5).rounded(8).bg(t.accent).text_color(t.accent_foreground).text_size(10.5).child(String(count))))
        .child(svg(icon(isOpen ? "chevron-up" : "chevron")).size(12));
      if (!isOpen) return [header];
      this.firstOptionIndex = this.menuItems.length;
      if (this.shouldSelectFirstOption) { this.menuIndex = this.firstOptionIndex; this.shouldSelectFirstOption = false; }
      this.menuListOffset = this.firstOptionIndex;
      const options = this.optionRows({ store, def, scrollHandle: this.optionScroll });
      return [header, v_flex().flex_none().pl(8).pt(4).pb(4).gap(4)
        .child(this.menuSearchBox())
        .child(v_flex().id(`fl-list-${def.field}`).h(Math.min(options.length, FILTER_OPTIONS_VISIBLE) * MENU_ROW_HEIGHT).overflow_y_scrollbar().track_scroll(this.optionScroll).children(options))
        .when(Boolean(def.isMulti), (el) => el.child(this.multiFooter({ store, def })))];
    });
    const handleSave = () => {
      closeOverlay(props().overlay);
      openSaveFilters({ store, scopeLabel: menu.saveContext?.scopeLabel ?? "", defs: menu.saveContext?.defs ?? groups });
    };
    // [Clear all        Save as set…]: Save keeps the filters as a set in the scope picker.
    return [...rows, div().h(1).flex_none().my(3).bg(t.border),
      h_flex().flex_none().h(MENU_FOOTER_HEIGHT).px(4).gap(4).items_center().text_size(12)
        .child(h_flex().id("fl-clear").h(MENU_ROW_HEIGHT - 6).px(6).items_center().rounded(6).text_color(total > 0 ? t.foreground : t.dim)
          .when(total > 0, (el) => el.cursor_pointer().hover((s) => s.bg(t.selected))
            .on_click(() => patchFilters({ store, patch: Object.fromEntries(groups.map((def) => [def.field, defaultsFor(store)[def.field]])) })))
          .child(total > 0 ? "Clear all" : "No filters on"))
        .child(div().flex_1())
        .when(total > 0, (el) => el.child(button({ id: "fl-save", label: "Save as set…", onClick: handleSave })))];
  }

  // A ticket's skill without a worktree first asks where to run. The popup view can outlive one
  // opening, so each new overlay starts on its own step (the skill list, or "where" via askSkill).
  resetMenuStep() {
    this.menuOverlay = props().overlay;
    this.askSkill = props().menu.askSkill ?? null;
    // A skill menu opens with no active row, so nothing looks preselected; ↑/↓ picks one.
    this.menuIndex = props().menu.skills && !this.askSkill ? NO_MENU_ROW : 0;
  }

  menuView() {
    const t = theme();
    const menu = props().menu;
    if (props().overlay !== this.menuOverlay) this.resetMenuStep();
    const groups = menu.groups ?? [];
    this.menuItems = [];
    this.menuListOffset = 0;
    if (menu.isFilterList) {
      // Frameless popup: draw the box ourselves, sized to its content.
      return v_flex().id("hub-filters").size_full().text_size(12.8)
        .track_focus(this.menuHandle).on_key_down((e, cx) => this.handleMenuKey(e, cx))
        .child(v_flex().w_full().flex_none().p(5).gap(1).rounded(8).border(1).border_color(t.border).bg(t.popover).shadow_lg()
          .children(this.filterListRows(menu)));
    }
    const hasSearch = !menu.skills;
    const rows = this.askSkill ? this.askRows({ skill: this.askSkill, target: menu.target })
      : menu.skills ? this.skillRows(menu)
      : groups.filter((def) => groups.length === 1 || def.options.some((o) => this.matchesMenuSearch(o.label))).flatMap((def) => [
        ...(groups.length > 1 && def.title ? [div().flex_none().px(9).pt(8).pb(2).text_size(11).font_semibold().text_color(t.muted).child(def.title)] : []),
        ...(groups.length > 1 && !def.title ? [div().h(1).flex_none().my(3).bg(t.border)] : []),
        ...this.optionRows({ store: menu.store, def, scrollHandle: groups.length === 1 ? this.menuScroll : null }),
      ]);
    this.menuIndex = Math.min(this.menuIndex, Math.max(0, this.menuItems.length - 1));
    const isMulti = !this.askSkill && isMultiSelect(menu);
    const listHeight = menu.height - MENU_PADDING - (hasSearch ? MENU_SEARCH_HEIGHT : 0) - (isMulti ? MENU_FOOTER_HEIGHT : 0);
    return v_flex().id("hub-menu").w_full().bg(t.popover).p(5).gap(4).text_size(12.8)
      .track_focus(this.menuHandle).on_key_down((e, cx) => this.handleMenuKey(e, cx))
      .when(hasSearch, (el) => el.child(this.menuSearchBox()))
      .child(v_flex().id("hub-menu-list").h(listHeight).overflow_y_scrollbar().track_scroll(this.menuScroll).children(rows))
      .when(isMulti, (el) => el.child(div().h(1).flex_none().bg(t.border)).child(this.multiFooter({ store: menu.store, def: groups[0] })));
  }

  // ---------- panel ----------

  // A main tab: icon, name and count pill, with an accent underline when shown. Pressing and
  // moving onto another tab drags it; the accent line shows where it lands. A plain click shows it.
  /**
   * @param {{ id: import("./settings.js").PanelTab, label: string, iconName: string, count: number | null, isOn: boolean,
   *   isAlert?: boolean, index: number, order: import("./settings.js").PanelTab[] }} params
   */
  tabButton({ id, label, iconName, count, isOn, isAlert = false, index, order }) {
    const t = theme();
    const drag = this.tabDrag;
    const isDragging = Boolean(drag?.isMoved);
    const isLineBefore = isDragging && drag?.to === index;
    const isLineAfter = isDragging && drag?.to === order.length && index === order.length - 1;
    return v_flex().id(`tab-${id}`).relative().h_full().px(4).cursor_pointer()
      .when(isDragging && drag?.tab === id, (el) => el.opacity(0.5))
      .when(isLineBefore || isLineAfter, (el) => el.child(div().absolute().top(6).bottom(6).w(2).rounded(1).bg(t.accent)
        .when(isLineBefore, (line) => line.left(-1))
        .when(isLineAfter, (line) => line.right(-1))))
      .on_mouse_down("left", (_e, cx) => { this.tabDrag = { tab: id, to: null, isMoved: false }; cx.notify(); })
      .on_mouse_move((e, cx) => {
        if (!this.tabDrag) return;
        const to = index + Number(e.local_position.x > e.bounds.width / 2);
        const isMoved = this.tabDrag.isMoved || this.tabDrag.tab !== id;
        if (to === this.tabDrag.to && isMoved === this.tabDrag.isMoved) return;
        this.tabDrag = { ...this.tabDrag, to, isMoved };
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => {
        const done = this.tabDrag;
        this.tabDrag = null;
        if (done?.isMoved && done.to !== null) {
          setShared(STORE.tabOrder, moveTab({ order, tab: done.tab, to: done.to }));
        } else {
          this.settingsView.close();
          setShared(STORE.tab, id);
        }
        cx.notify();
      })
      .child(h_flex().flex_1().px(8).gap(7).items_center().text_size(13.5).font_medium()
        .text_color(isOn ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
        .child(svg(icon(iconName)).size(15))
        .child(label)
        .when(count !== null, (el) => el.child(div().px(6).rounded(8).text_size(11)
          .bg(isAlert ? palette(t).danger : isOn ? t.accent : t.raised).text_color(isAlert ? t.background : isOn ? t.accent_foreground : t.muted).child(String(count)))))
      .child(div().h(2).w_full().rounded(1).bg(isOn ? t.accent : t.surface));
  }

  // The shown tabs in the saved order.
  /** @param {{ tab: import("./settings.js").PanelTab, settings: import("./settings.js").Settings, countOf: (key: string) => number | null }} params */
  headerTabs({ tab, settings, countOf }) {
    const shown = getTabOrder(shared(STORE.tabOrder)).filter((id) => {
      switch (id) {
        case "github": return settings.shouldShowGithub;
        case "linear": return settings.shouldShowLinear;
        case "oncall": return settings.shouldShowOncall;
        default: {
          /** @type {never} */
          const unknownTab = id;
          return unknownTab;
        }
      }
    });
    /** @param {import("./settings.js").PanelTab} id */
    const details = (id) => {
      switch (id) {
        case "github": return { label: "GitHub", iconName: "github", count: countOf(this.githubKey), isAlert: false };
        case "linear": return { label: "Linear", iconName: "linear", count: countOf(this.linearKey), isAlert: false };
        case "oncall": return { label: "On-call", iconName: "oncall", count: this.oncallView.unseenCount() || null, isAlert: true };
        default: {
          /** @type {never} */
          const unknownTab = id;
          return unknownTab;
        }
      }
    };
    return shown.map((id, index) => this.tabButton({ id, ...details(id), isOn: tab === id, index, order: shown }));
  }

  /** @param {import("./settings.js").PanelTab} tab */
  mainView(tab) {
    if (this.settingsView.isOpen) return this.settingsView.render();
    if (tab === "oncall") return this.oncallView.render({ openSettings: (cx) => { this.settingsView.open({ cx, section: "oncall" }); cx.notify(); } });
    return tab === "github" ? this.githubView() : this.linearView();
  }

  render(cx) {
    if (this.gh44Dialog) return this.gh44Dialog.render();
    if (this.caseEditorDialog) return this.caseEditorDialog.render();
    if (this.rowDetailsDialog) return this.rowDetailsDialog.render();
    if (this.oncallTextDialog) return this.oncallTextDialog.render();
    if (this.oncallTriageDialog) return this.oncallTriageDialog.render();
    if (this.filterSavePopup) return this.filterSavePopup.render();
    if (this.reportView) return this.reportView.render();
    if (this.isMenu) return this.menuView();
    const settings = readPanelSettings();
    frame = { settings, tab: getShownTab({ saved: shared(STORE.tab), settings }) };
    try {
      return this.renderPanel(cx);
    } finally {
      frame = null;
    }
  }

  /** @param {import("gpui-kit").Context} cx */
  renderPanel(cx) {
    // Herdr re-renders on every space, tab or focus change: switch repos now instead of on the
    // next tick. render may not notify, and spawn runs its body at once, so the task sleeps
    // past this render before the tick (a notify inside render throws and strands the load).
    const folder = currentFolder();
    if (folder !== this.folder && folder !== this.pendingFolder) {
      this.pendingFolder = folder;
      cx.spawn(async (cx) => { await cx.sleep(0); this.pendingFolder = undefined; this.tick(cx); });
    }
    const t = theme();
    const tab = currentTab();
    const settings = getPanelSettings();
    const isLoading = inflight.has(this.githubKey) || inflight.has(this.linearKey);
    const countOf = (key) => {
      const result = cache.get(key)?.result;
      return result?.status === "success" ? (result.total ?? result.items.length) : null;
    };
    return v_flex().id("hub").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .track_focus(this.handle).on_key_down((e, cx) => this.handleKey(e, cx))
      .child(h_flex().id("hub-tabs").flex_none().h(TAB_BAR_HEIGHT).px(GUTTER - 4).gap(2).items_end().bg(t.surface).border_b(1).border_color(t.border)
        // Let go anywhere else in the bar: the drag ends where it was.
        .on_mouse_up("left", (_e, cx) => { if (this.tabDrag) { this.tabDrag = null; cx.notify(); } })
        .children(this.headerTabs({ tab, settings, countOf }))
        .child(div().flex_1())
        .child(div().id("hub-refresh").self_center().size(26).flex().items_center().justify_center().rounded(6).cursor_pointer()
          .text_color(t.muted).hover((s) => s.bg(t.hover)).tooltip("Refresh")
          .on_click((_e, cx) => this.handleRefresh(cx))
          .child(isLoading ? svg("mods/workspace-chrome/spinner.svg").size(14).text_color(t.working).spin(900) : svg(icon("refresh")).size(14)))
        .child(div().id("hub-settings").self_center().size(26).flex().items_center().justify_center().rounded(6).cursor_pointer()
          .text_color(this.settingsView.isOpen ? t.foreground : t.muted).when(this.settingsView.isOpen, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
          .tooltip(this.settingsView.isOpen ? "Close settings" : "Settings")
          .on_click((_e, cx) => {
            if (this.settingsView.isOpen) this.settingsView.close();
            // On a Linear tab asking for its key, land on the key.
            else this.settingsView.open({ cx, section: this.isLinearKeyMissing() ? "linear" : undefined });
            cx.notify();
          })
          .child(svg(icon("settings")).size(14))))
      .child(this.mainView(tab));
  }
}

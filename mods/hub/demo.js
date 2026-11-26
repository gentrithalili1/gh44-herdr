// Made-up data for README screenshots: a fictional "Orbit" storefront team. Nothing here comes
// from GitHub, Linear or Sentry. Times are relative to now, so ages read the same on every run.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** @param {number} ms */
const ago = (ms) => new Date(Date.now() - ms).toISOString();

// Typed empties, so the made-up objects match the real shapes.
/** @type {{ value: string, label: string }[]} */
const NO_TEAMS = [];
/** @type {string | null} */
const NO_TEXT = null;
/** @type {{ shortId: string, title: string } | null} */
const NO_CURRENT = null;
/** @type {{ reason: string, message: string } | null} */
const NO_ERROR = null;

export const DEMO_LOGIN = "mara-k";
export const DEMO_REPO = "orbit-labs/storefront";
const DEMO_MAIN = "/demo/orbit-labs/storefront";
export const DEMO_REPO_ID = `${DEMO_MAIN}/.git`;
const PULL_URL = `https://github.com/${DEMO_REPO}/pull`;
const LINEAR_URL = "https://linear.app/orbit/issue";

/**
 * @param {{ number: number, title: string, author: string, branch: string, age: number, ci?: string, decision?: string | null,
 *   isDraft?: boolean, hasConflicts?: boolean, labels?: Record<string, string>, reviewers?: string[], requestedUsers?: string[],
 *   additions: number, deletions: number, failingChecks?: string[] }} pr
 */
const toPullRequest = ({ number, title, author, branch, age, ci = "passing", decision = null, isDraft = false, hasConflicts = false,
  labels = {}, reviewers = [], requestedUsers = [], additions, deletions, failingChecks = [] }) => ({
  id: `${PULL_URL}/${number}`, number, title, url: `${PULL_URL}/${number}`, author, assignees: [author], branch, isDraft, hasConflicts,
  labels: Object.keys(labels), labelColors: labels, ci, failingChecks, requestedUsers, requestedTeams: NO_TEAMS, reviewers, decision,
  additions, deletions, createdAt: ago(age),
});

const PULL_REQUESTS = [
  toPullRequest({
    number: 1284, title: "Checkout: keep the promo code after a failed payment", author: DEMO_LOGIN, branch: "web-412-keep-promo-code",
    age: 3 * HOUR_MS, ci: "failing", failingChecks: ["e2e / checkout"], labels: { checkout: "#d4a72c" }, additions: 142, deletions: 38,
  }),
  toPullRequest({
    number: 1279, title: "Cart drawer: skeleton while prices load", author: DEMO_LOGIN, branch: "web-398-cart-skeleton",
    age: 26 * HOUR_MS, decision: "APPROVED", reviewers: ["jonas-b"], labels: { ui: "#5b8def" }, additions: 87, deletions: 21,
  }),
  toPullRequest({
    number: 1291, title: "Search: debounce suggestions and cancel stale requests", author: "jonas-b", branch: "web-420-search-debounce",
    age: 45 * MINUTE_MS, reviewers: [DEMO_LOGIN], requestedUsers: [DEMO_LOGIN], additions: 64, deletions: 19,
  }),
  toPullRequest({
    number: 1288, title: "Product page: lazy-load the review gallery", author: "priya-s", branch: "web-415-lazy-gallery",
    age: 2 * HOUR_MS, requestedUsers: [DEMO_LOGIN], labels: { performance: "#2da44e" }, additions: 211, deletions: 96,
  }),
  toPullRequest({
    number: 1276, title: "Account: move saved addresses to TanStack Query", author: DEMO_LOGIN, branch: "web-389-addresses-query",
    age: 2 * DAY_MS, ci: "pending", requestedUsers: ["priya-s"], additions: 318, deletions: 274,
  }),
  toPullRequest({
    number: 1293, title: "Wishlist: share a list by link", author: "theo-r", branch: "web-424-share-wishlist",
    age: 20 * MINUTE_MS, isDraft: true, additions: 56, deletions: 4,
  }),
];

/**
 * @param {{ number: number, title: string, branch: string, state: string, stateType: string, priority: number, age: number,
 *   project?: string | null, labels?: Record<string, string>, prNumber?: number }} issue
 */
const toIssue = ({ number, title, branch, state, stateType, priority, age, project = null, labels = {}, prNumber }) => ({
  id: `web-${number}`, identifier: `WEB-${number}`, title, url: `${LINEAR_URL}/WEB-${number}`, branch, priority,
  createdAt: ago(age * 3), updatedAt: ago(age), state, stateType, team: "WEB", teamId: "team-web", project,
  assignee: "Mara K", labels: Object.keys(labels), labelColors: labels,
  prUrl: prNumber ? `${PULL_URL}/${prNumber}` : null, isMyPullRequest: Boolean(prNumber),
});

const ISSUES = [
  toIssue({
    number: 412, title: "Checkout: keep the promo code after a failed payment", branch: "web-412-keep-promo-code", state: "In Progress",
    stateType: "started", priority: 1, age: 2 * HOUR_MS, project: "Checkout v2", labels: { Bug: "#eb5757" }, prNumber: 1284,
  }),
  toIssue({
    number: 398, title: "Cart drawer: show a skeleton while prices load", branch: "web-398-cart-skeleton", state: "In Review",
    stateType: "started", priority: 3, age: 20 * HOUR_MS, project: "Checkout v2", labels: { Improvement: "#4ea7fc" }, prNumber: 1279,
  }),
  toIssue({
    number: 427, title: "Order history: filter by status and date", branch: "web-427-order-history-filters", state: "Todo",
    stateType: "unstarted", priority: 2, age: 5 * HOUR_MS, project: "Account", labels: { Feature: "#bb87fc" },
  }),
  toIssue({
    number: 431, title: "Product page: size guide opens behind the sticky header", branch: "web-431-size-guide-z-index", state: "Todo",
    stateType: "unstarted", priority: 1, age: 40 * MINUTE_MS, labels: { Bug: "#eb5757" },
  }),
  toIssue({
    number: 433, title: "Newsletter banner: respect the dismissed state across tabs", branch: "web-433-newsletter-dismiss", state: "Backlog",
    stateType: "backlog", priority: 4, age: 3 * DAY_MS, labels: { Improvement: "#4ea7fc" },
  }),
];

const WORKTREES = [
  { path: `${DEMO_MAIN}/.worktrees/web-412-keep-promo-code`, branch: "web-412-keep-promo-code", head: "a1", isLocked: false },
  { path: `${DEMO_MAIN}/.worktrees/web-405-free-shipping-bar`, branch: "web-405-free-shipping-bar", head: "b2", isLocked: false },
  { path: `${DEMO_MAIN}/.worktrees/web-401-gift-card-balance`, branch: "web-401-gift-card-balance", head: "c3", isLocked: false },
];
const MERGED_WORKTREES = [
  { ...WORKTREES[1], pr: 1268, prUrl: `${PULL_URL}/1268` },
  { ...WORKTREES[2], pr: 1262, prUrl: `${PULL_URL}/1262` },
];

// Agents on rows, as findAgentFor returns them; `since` stands in for the tab's times.
const AGENTS = [
  { label: "WEB-412", branch: "web-412-keep-promo-code", status: "working", tab_name: "WEB-412 implement", since: 12 * MINUTE_MS },
  { label: "#1291", status: "blocked", tab_name: "#1291 code-review", since: 4 * MINUTE_MS },
  { label: "WEB-398", status: "done", tab_name: "WEB-398 address-review", since: 0 },
].map((a, i) => ({ ...a, space: "demo-space", tab: `demo-tab-${i}`, seq: i, since: a.status === "done" ? null : Date.now() - a.since }));

/** @param {{ label: string, branch?: string | null }} params */
export const findDemoAgent = ({ label, branch }) => AGENTS.find((a) => a.label === label || (branch && a.branch === branch)) ?? null;

const SENTRY_URL = "https://orbit.sentry.io/issues";

/**
 * @param {{ id: string, shortId: string, title: string, project: string, priority: string, count: number, userCount: number,
 *   age: number, severity: string | null, outcome: string, stage: string, summary: string, isNotified?: boolean, trigger?: string }} d
 */
const toDecision = ({ id, shortId, title, project, priority, count, userCount, age, severity, outcome, stage, summary, isNotified = false, trigger = "new" }) => ({
  issueId: id, shortId, title, project, url: `${SENTRY_URL}/${id}/`, kind: "ongoing", priority, count, userCount,
  lastSeen: ago(age), decidedAt: ago(age), trigger, severity, matchedRule: NO_TEXT, sessionId: NO_TEXT, reportPath: NO_TEXT, cwd: NO_TEXT,
  costUsd: outcome === "reported" ? 0.18 : null, isNotified, stage, outcome, summary,
});

const DECISIONS = [
  toDecision({
    id: "9001", shortId: "STOREFRONT-3K", title: "TypeError: Cannot read properties of undefined (reading 'currency')", project: "storefront",
    priority: "high", count: 214, userCount: 87, age: 6 * MINUTE_MS, severity: "high", outcome: "reported", stage: "ai", isNotified: true,
    summary: "Checkout summary crashes when a cart line has no price yet: 214 events, 87 users since v12.4.0. Guard the price in CartSummary.",
  }),
  toDecision({
    id: "9002", shortId: "STOREFRONT-3H", title: "ChunkLoadError: Loading chunk 812 failed", project: "storefront",
    priority: "medium", count: 41, userCount: 33, age: 48 * MINUTE_MS, severity: "medium", outcome: "reported", stage: "ai", isNotified: true,
    summary: "Old tabs request a chunk from the previous deploy. Reload once on ChunkLoadError instead of showing the error page.",
  }),
  toDecision({
    id: "9003", shortId: "ACCOUNT-1F", title: "ApolloError: Response not successful: 502", project: "account",
    priority: "medium", count: 3, userCount: 2, age: 2 * HOUR_MS, severity: null, outcome: "held", stage: "impact",
    summary: "Waiting for impact: 3 events, 2 users",
  }),
  toDecision({
    id: "9004", shortId: "STOREFRONT-3D", title: "ResizeObserver loop completed with undelivered notifications", project: "storefront",
    priority: "low", count: 1290, userCount: 640, age: 3 * HOUR_MS, severity: null, outcome: "ignored", stage: "priority",
    summary: "Sentry priority low; the AI looks at high, medium",
  }),
];

export const demo = {
  loadRepoId: async () => DEMO_REPO_ID,
  loadRepoName: async () => DEMO_REPO,
  loadRepoLabels: async () => ["checkout", "ui", "performance", "dependencies"],
  loadRepoUsers: async () => [
    { login: DEMO_LOGIN, name: "Mara K" }, { login: "jonas-b", name: "Jonas B" }, { login: "priya-s", name: "Priya S" }, { login: "theo-r", name: "Theo R" },
  ],
  loadMyTeams: async () => [{ value: "orbit-labs/web", label: "web" }],
  loadGithubLogin: async () => DEMO_LOGIN,
  loadWorktrees: async () => WORKTREES,
  loadMergedWorktrees: async () => MERGED_WORKTREES,
  loadPullRequests: async () => ({ status: "success", items: PULL_REQUESTS, total: PULL_REQUESTS.length, cursor: NO_TEXT, hasMore: false }),
  loadIssues: async () => ({ status: "success", items: ISSUES, isCapped: false }),
  loadLinearMeta: async () => ({
    status: "success",
    teams: [{ value: "team-web", label: "Web (WEB)" }],
    projects: [{ id: "p-checkout", name: "Checkout v2", teamIds: ["team-web"] }, { id: "p-account", name: "Account", teamIds: ["team-web"] }],
  }),
  loadDecisions: async () => DECISIONS,
  loadServiceStatus: async () => ({
    isRunning: true, startedAt: ago(5 * HOUR_MS), lastPollAt: ago(20_000), nextPollAt: new Date(Date.now() + 40_000).toISOString(),
    alertCount: 2, current: NO_CURRENT, lastError: NO_ERROR,
  }),
  hasTrackerToken: async () => true,
};

const DEMO_ORG = { slug: "orbit", name: "Orbit", apiUrl: "https://sentry.io" };
const DEMO_PROJECTS = [{ id: "1", slug: "storefront" }, { id: "2", slug: "account" }, { id: "3", slug: "admin" }];
const DEMO_FOLDER = "~/code/storefront";

// On-call settings for the demo: the real ones with a made-up org, projects, checkout and repo profile.
/** @param {Record<string, any>} config */
export const toDemoOncallConfig = (config) => ({
  ...config,
  isOn: true,
  org: DEMO_ORG,
  projects: DEMO_PROJECTS,
  projectsByOrg: { [DEMO_ORG.slug]: DEMO_PROJECTS },
  codeFolder: DEMO_FOLDER,
  domain: "Storefront and account pages: checkout, cart, product, search.",
  nudgeRules: [{ id: "nudge-checkout", text: "Anything that breaks checkout or payment", isOn: true }],
  repoProfile: {
    folder: DEMO_FOLDER,
    scannedAt: ago(DAY_MS),
    costUsd: 0.03,
    summary: "## Apps and areas\n- `apps/storefront`: product, cart and checkout pages. `@orbit-labs/web`.\n- `apps/account`: sign-in, orders, addresses. `@orbit-labs/web`.\n- `packages/ui`: shared components. `@orbit-labs/design`.",
    codeowners: "* @orbit-labs/web\n/packages/ui/ @orbit-labs/design",
    noiseRules: { ignoreErrors: ["/ResizeObserver loop/"] },
    setupFiles: ["apps/storefront/src/sentry.ts", "apps/account/src/sentry.ts"],
  },
});

// Settings while in demo mode: who the keys belong to, and writes that do nothing.
export const demoSettings = {
  loadLinearViewer: async () => ({ status: "success", name: "Mara K" }),
  loadTrackerAccount: async () => ({ status: "success", user: "Mara K", orgs: [DEMO_ORG] }),
  loadTrackerProjects: async () => ({ status: "success", projects: DEMO_PROJECTS }),
  refused: async () => ({ status: "error", reason: "failed", message: "Demo mode: nothing is saved or run." }),
};

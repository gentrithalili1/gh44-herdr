// The panel's data loaders and settings writes: the real ones, or demo.js's made-up data while demo mode is on
// (`herdr-app do hub.demo-on`, then ./reload.sh; `hub.demo-off` to leave). For README screenshots.
import { shared } from "herdr";
import * as github from "./github.js";
import * as linear from "./linear.js";
import * as oncall from "./oncall/client.js";
import * as actions from "./actions.js";
import { demo, demoSettings, findDemoAgent, toDemoOncallConfig } from "./demo.js";

export const DEMO_STORE = "hub.demo";
export const isDemo = () => shared(DEMO_STORE) === true;

// The demo stand-in takes the same arguments; its result is made up, so it is not held to the real type.
/**
 * @template {(...args: any[]) => any} F
 * @param {F} real @param {(...args: Parameters<F>) => any} fake
 * @returns {(...args: Parameters<F>) => ReturnType<F>}
 */
const pick = (real, fake) => (...args) => (isDemo() ? fake(...args) : real(...args));

export const loadRepoId = pick(github.loadRepoId, demo.loadRepoId);
export const loadRepoName = pick(github.loadRepoName, demo.loadRepoName);
export const loadRepoLabels = pick(github.loadRepoLabels, demo.loadRepoLabels);
export const loadRepoUsers = pick(github.loadRepoUsers, demo.loadRepoUsers);
export const loadMyTeams = pick(github.loadMyTeams, demo.loadMyTeams);
export const loadGithubLogin = pick(github.loadGithubLogin, demo.loadGithubLogin);
export const loadWorktrees = pick(github.loadWorktrees, demo.loadWorktrees);
export const loadMergedWorktrees = pick(github.loadMergedWorktrees, demo.loadMergedWorktrees);
export const loadPullRequests = pick(github.loadPullRequests, demo.loadPullRequests);
export const loadIssues = pick(linear.loadIssues, demo.loadIssues);
export const loadLinearMeta = pick(linear.loadLinearMeta, demo.loadLinearMeta);
export const loadDecisions = pick(oncall.loadDecisions, demo.loadDecisions);
export const loadServiceStatus = pick(oncall.loadServiceStatus, demo.loadServiceStatus);
export const hasTrackerToken = pick(oncall.hasTrackerToken, demo.hasTrackerToken);
export const loadOncallConfig = pick(oncall.loadOncallConfig, async () => toDemoOncallConfig(await oncall.loadOncallConfig()));
export const findAgentFor = pick(actions.findAgentFor, findDemoAgent);

// Settings: in demo mode they read made-up accounts, and every write is refused, so the real
// keys and On-call config stay as they are.
export const loadLinearViewer = pick(linear.loadLinearViewer, demoSettings.loadLinearViewer);
export const saveLinearKey = pick(linear.saveLinearKey, demoSettings.refused);
export const removeLinearKey = pick(linear.removeLinearKey, demoSettings.refused);
export const loadTrackerAccount = pick(oncall.loadTrackerAccount, demoSettings.loadTrackerAccount);
export const loadTrackerProjects = pick(oncall.loadTrackerProjects, demoSettings.loadTrackerProjects);
export const saveOncallConfig = pick(oncall.saveOncallConfig, demoSettings.refused);
export const saveTrackerToken = pick(oncall.saveTrackerToken, demoSettings.refused);
export const removeTrackerToken = pick(oncall.removeTrackerToken, demoSettings.refused);
export const startOncall = pick(oncall.startOncall, demoSettings.refused);
export const stopOncall = pick(oncall.stopOncall, demoSettings.refused);
export const loadPreview = pick(oncall.loadPreview, demoSettings.refused);
export const testDomain = pick(oncall.testDomain, demoSettings.refused);
export const scanRepo = pick(oncall.scanRepo, demoSettings.refused);

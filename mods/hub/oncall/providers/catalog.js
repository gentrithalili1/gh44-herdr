// The issue trackers On-call can watch: what the panel and the prompts call things for each one.
// Pure, so the panel, the Node service and tests/ all load it. A provider's API calls live in
// providers/<id>.mjs, which only the service loads. See oncall/README.md, "Add a provider".

/** @typedef {"sentry"} ProviderId */
/**
 * @typedef {{
 *   id: ProviderId,
 *   name: string,
 *   url: string,
 *   token: { placeholder: string, help: string, createUrl: string, createLabel: string },
 *   orgLabel: string,
 *   projectsLabel: string,
 *   priorityLabel: string,
 *   setupScan: { filePattern: string, noiseKeys: readonly string[], sdkName: string },
 *   aiTools: { allowed: readonly string[], disallowed: readonly string[] },
 * }} Provider
 */

/** @type {Record<ProviderId, Provider>} */
export const PROVIDERS = {
  sentry: {
    id: "sentry",
    name: "Sentry",
    url: "https://sentry.io",
    token: {
      placeholder: "sntryu_…",
      help: "A personal token with org:read, project:read and event:read.",
      createUrl: "https://sentry.io/settings/account/api/auth-tokens/",
      createLabel: "Create a token in Sentry: Settings › Personal Tokens",
    },
    orgLabel: "Organization",
    projectsLabel: "Projects",
    priorityLabel: "Sentry priority",
    // The repo files that set up the SDK, and the noise rules in them the scan reads.
    setupScan: { filePattern: "Sentry\\.init|ignoreErrors|denyUrls", noiseKeys: ["ignoreErrors", "denyUrls"], sdkName: "Sentry SDK" },
    // The provider's MCP tools the triage may use (read only), and the ones it must not.
    aiTools: {
      allowed: [
        "mcp__claude_ai_Sentry__get_sentry_resource", "mcp__claude_ai_Sentry__search_issues", "mcp__claude_ai_Sentry__search_errors",
        "mcp__claude_ai_Sentry__search_replays", "mcp__claude_ai_Sentry__analyze_issue_with_seer",
      ],
      disallowed: ["mcp__claude_ai_Sentry__update_issue"],
    },
  },
};

/** @type {ProviderId} */
export const DEFAULT_PROVIDER = "sentry";

/** @param {unknown} id @returns {Provider} */
export const getProvider = (id) => Object.values(PROVIDERS).find((p) => p.id === id) ?? PROVIDERS[DEFAULT_PROVIDER];

// Sentry's API for the On-call service: the ProviderApi of providers/contract.js.
import { ProviderError, NOT_FOUND } from "./contract.js";
import { toAlert, toAlerts, toOrgs, toProjects, toEventContext, buildIssuesPath, SENTRY_URL } from "./sentry-parse.mjs";

const REQUEST_TIMEOUT_MS = 30_000;

/** @typedef {import("./contract.js").Org} Org */

// Sentry's error detail as text: a string, or an object with a message (403s answer that way).
/** @param {string} text @returns {string | null} */
function readErrorDetail(text) {
  let detail = null;
  try {
    detail = JSON.parse(text).detail;
  } catch {
    return null;
  }
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && typeof detail.message === "string") return detail.message;
  return detail ? JSON.stringify(detail) : null;
}

/** @param {{ baseUrl: string, path: string, token: string }} params */
async function sentryGet({ baseUrl, path, token }) {
  const response = await fetch(`${baseUrl}/api/0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new ProviderError({ status: response.status, message: readErrorDetail(text) ?? `Sentry answered ${response.status}` });
  return JSON.parse(text);
}

/** @param {Org} org */
const orgPath = (org) => `/organizations/${encodeURIComponent(org.slug)}`;

/** @type {import("./contract.js").ProviderApi} */
export const sentry = {
  // The token's owner and orgs. Org lists and the user live on sentry.io, whatever the region.
  async listOrgs({ token }) {
    const [auth, orgs] = await Promise.all([
      sentryGet({ baseUrl: SENTRY_URL, path: "/auth/", token }).catch(() => null),
      sentryGet({ baseUrl: SENTRY_URL, path: "/organizations/?member=1", token }),
    ]);
    return { user: auth?.name || auth?.email || null, orgs: toOrgs(orgs) };
  },

  async listProjects({ token, org }) {
    return toProjects(await sentryGet({ baseUrl: org.apiUrl, path: `${orgPath(org)}/projects/?per_page=100`, token }));
  },

  async listIssues({ token, org, projectIds, environments, hours }) {
    return toAlerts(await sentryGet({ baseUrl: org.apiUrl, path: buildIssuesPath({ org: org.slug, projectIds, environments, hours }), token }));
  },

  async getIssue({ token, org, id }) {
    return toAlert(await sentryGet({ baseUrl: org.apiUrl, path: `${orgPath(org)}/issues/${encodeURIComponent(id)}/`, token }).catch(() => null));
  },

  // The latest event in the first picked environment; any environment when it has none there.
  async getContext({ token, org, id, environments }) {
    const path = `${orgPath(org)}/issues/${encodeURIComponent(id)}/events/latest/`;
    const environment = environments[0];
    try {
      return toEventContext(await sentryGet({ baseUrl: org.apiUrl, path: environment ? `${path}?${new URLSearchParams({ environment })}` : path, token }));
    } catch (error) {
      if (error instanceof ProviderError && error.status === NOT_FOUND && environment) {
        return toEventContext(await sentryGet({ baseUrl: org.apiUrl, path, token }).catch(() => null));
      }
      return null;
    }
  },
};

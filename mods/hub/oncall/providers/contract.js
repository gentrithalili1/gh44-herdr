// What every provider gives On-call. The service only talks to this, so adding a tracker means
// one providers/<id>.mjs that implements ProviderApi, plus its entry in catalog.js.

/** @typedef {"new" | "regressed" | "escalating" | "ongoing" | "other"} AlertKind */
/**
 * @typedef {{
 *   id: string, shortId: string, title: string, culprit: string, level: string, priority: string | null,
 *   project: string, url: string, kind: AlertKind, firstSeen: string, lastSeen: string,
 *   count: number, userCount: number, isUnhandled: boolean,
 * }} Alert
 */
/** @typedef {{ fn: string, file: string, line: number | null, isInApp: boolean }} Frame */
/** @typedef {{ message: string, frames: Frame[], tags: Record<string, string> }} EventContext */

/** @typedef {import("../config.js").Org} Org */
/** @typedef {import("../config.js").Project} Project */
/**
 * @typedef {{
 *   listOrgs: (params: { token: string }) => Promise<{ user: string | null, orgs: Org[] }>,
 *   listProjects: (params: { token: string, org: Org }) => Promise<Project[]>,
 *   listIssues: (params: { token: string, org: Org, projectIds: string[], environments: string[], hours: number }) => Promise<Alert[]>,
 *   getIssue: (params: { token: string, org: Org, id: string }) => Promise<Alert | null>,
 *   getContext: (params: { token: string, org: Org, id: string, environments: string[] }) => Promise<EventContext | null>,
 * }} ProviderApi
 */

export const UNAUTHORIZED = 401;
export const NOT_FOUND = 404;

// A failed call to the provider, with its HTTP status: 401 means the token is not accepted.
export class ProviderError extends Error {
  /** @param {{ status: number, message: string }} params */
  constructor({ status, message }) {
    super(message);
    this.status = status;
  }
}

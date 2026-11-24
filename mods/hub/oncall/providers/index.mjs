// The providers' APIs by id, for the service. The panel reads catalog.js only.
import { sentry } from "./sentry.mjs";

/** @type {Record<import("./catalog.js").ProviderId, import("./contract.js").ProviderApi>} */
export const PROVIDER_APIS = { sentry };

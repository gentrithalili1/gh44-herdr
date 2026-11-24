// The repo scan at setup: what code reads exactly (CODEOWNERS, the noise rules in the tracker
// SDK's setup, like Sentry's ignoreErrors), the prompt for the short AI read of the rest, and how
// the result goes into a triage prompt. Pure, so tests/ can load it.

/** @typedef {import("../config.js").RepoProfile} RepoProfile */
/** @typedef {import("../providers/catalog.js").Provider} Provider */
// noiseRules: each noise key of the provider's SDK setup (ignoreErrors, denyUrls…) and its patterns.
/** @typedef {{ codeowners: string, codeownersPath: string | null, setupFiles: string[], noiseRules: Record<string, string[]>, spreads: string[] }} RepoFacts */

export const CODEOWNERS_PATHS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];
// The SDK setup files read, at most: found with the provider's git grep pattern, tests left out.
export const MAX_SETUP_FILES = 12;
const MAX_CODEOWNERS_LINES = 300;
const MAX_PATTERNS = 200;

// CODEOWNERS without comments and blank lines, cut to MAX_CODEOWNERS_LINES.
/** @param {string} text */
export const cleanCodeowners = (text) => text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).slice(0, MAX_CODEOWNERS_LINES).join("\n");

// Where an array that starts at `open` (its "[") ends, skipping strings and nested brackets. -1: never.
/** @param {{ source: string, open: number }} params */
function findArrayEnd({ source, open }) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (c === "'" || c === '"' || c === "`") {
      const close = source.indexOf(c, i + 1);
      if (close === -1) return -1;
      i = close;
    } else if (c === "[") {
      depth += 1;
    } else if (c === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// The patterns of every `key: [ ... ]` in a file: string and regex literals as written, and the
// names spread into it (`...COMMON_ERRORS`), which only the AI can follow.
/** @param {{ source: string, key: string }} params @returns {{ patterns: string[], spreads: string[] }} */
export function extractArrayPatterns({ source, key }) {
  const patterns = [];
  const spreads = [];
  const start = new RegExp(`\\b${key}\\s*:\\s*\\[`, "g");
  for (const match of source.matchAll(start)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const end = findArrayEnd({ source, open });
    if (end === -1) continue;
    const body = source.slice(open + 1, end);
    for (const literal of body.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`]*)`|(\/(?:[^/\\\n]|\\.)+\/[a-z]*)/g)) {
      patterns.push(literal[1] ?? literal[2] ?? literal[3] ?? literal[4] ?? "");
    }
    for (const spread of body.matchAll(/\.\.\.\s*([A-Za-z_$][\w$.]*)/g)) spreads.push(spread[1]);
  }
  return { patterns, spreads };
}

// The noise rules of the SDK setup files under each key, each pattern once.
/** @param {{ files: { path: string, source: string }[], keys: readonly string[] }} params @returns {Pick<RepoFacts, "noiseRules" | "spreads">} */
export function collectNoiseRules({ files, keys }) {
  /** @type {Record<string, string[]>} */
  const found = {};
  for (const key of keys) found[key] = [];
  const spreads = [];
  for (const file of files) {
    for (const key of keys) {
      const r = extractArrayPatterns({ source: file.source, key });
      found[key].push(...r.patterns);
      spreads.push(...r.spreads);
    }
  }
  /** @param {string[]} list */
  const unique = (list) => [...new Set(list.filter(Boolean))].slice(0, MAX_PATTERNS);
  return { noiseRules: Object.fromEntries(keys.map((key) => [key, unique(found[key])])), spreads: unique(spreads) };
}

/** @param {string[]} list */
const bullets = (list) => (list.length ? list.map((x) => `- ${x}`).join("\n") : "- (none)");

/** @param {Provider} provider */
const getScanInstructions = (provider) => `You prepare an on-call engineer's repo profile. Another AI reads it before it triages every ${provider.name} issue from this repo, so it must say what decides ownership, severity and noise. You run inside the repo.

Rules:
- Read only. Never edit files, never run anything that changes the repo.
- Be fast: list the top folders, read the workspace config (package.json workspaces, pnpm-workspace.yaml, nx or turbo config), the ${provider.setupScan.sdkName} setup files below and what they spread in. Don't read the whole codebase.
- Never invent paths or teams. Use what you read and the CODEOWNERS below.

Write markdown, at most 400 words, with exactly these sections:

## Apps and areas
One line per app or package that ships code: its path, what it is, its owner from CODEOWNERS.

## Critical flows
The flows that block users when broken (login, signup, checkout, payment, publishing, or this repo's own), each with the folder it lives in.

## Error wrappers
Files that report other code's errors and so are never the cause (GraphQL error links, HTTP interceptors, error boundaries, global handlers), each with what to look at instead. A micro-frontend host whose project collects remote apps' errors goes here too.

## Noise already filtered
What the ${provider.setupScan.sdkName} setup drops, in plain words, including the spread constants listed below once resolved.

## Ownership notes
Anything that makes ownership tricky: shared packages, generated code, code moved between teams.`;

// The prompt for the AI part of the scan: the facts code read, then what to find out.
/** @param {{ folder: string, facts: RepoFacts, provider: Provider }} params */
export function buildScanPrompt({ folder, facts, provider }) {
  const noise = Object.entries(facts.noiseRules).map(([key, patterns]) => `## ${key} found\n${bullets(patterns)}`).join("\n\n");
  return `${getScanInstructions(provider)}

## Repo
${folder}

## CODEOWNERS${facts.codeownersPath ? ` (${facts.codeownersPath})` : ""}
${facts.codeowners || "(none found)"}

## ${provider.setupScan.sdkName} setup files
${bullets(facts.setupFiles)}

${noise}

## Spread into them (resolve these)
${bullets(facts.spreads)}
`;
}

// The repo part of a triage prompt; "" without a profile.
/** @param {RepoProfile | null} profile */
export function formatRepoContext(profile) {
  if (!profile) return "";
  const rules = Object.entries(profile.noiseRules).filter(([, patterns]) => patterns.length);
  const noise = rules.length
    ? `\n## Noise rules in the repo's SDK setup\n${rules.map(([key, patterns]) => `${key}:\n${bullets(patterns)}`).join("\n")}\n`
    : "";
  return `
## Repo profile (${profile.folder}, scanned ${profile.scannedAt.slice(0, 10)})
${profile.summary || "(no summary)"}
${noise}
## CODEOWNERS
${profile.codeowners || "(none found)"}
`;
}

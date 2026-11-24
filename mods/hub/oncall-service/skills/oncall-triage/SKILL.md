---
name: oncall-triage
description: Triage one Sentry issue for an on-call engineer. Finds the real code path, the owner and the severity, and writes a short report with the fix. The On-call service of gh44-herdr runs it by default; anyone can read it for the same triage by hand.
---

# On-call triage

Answer one question for one Sentry issue: **does the on-call engineer need to act on it now?**

The service that runs you gives you the issue data, the stack, the engineer's domain and rules, and the answer format. Treat the data as a starting point, not as the truth.

## Rules

- You run unattended. Read only: never change anything in Sentry (no resolve, archive, assign, comment or autofix), never post anywhere, never edit files.
- If you run inside a code folder, read it. If the Sentry tools are available, use them; if not, work from the data given and say so in the report.
- Never invent counts, users, releases or statuses.
- Be fast. Fetch only what changes the answer.

## Steps

1. **Read the issue.** Title, message, culprit, top frames, events, users, first and last seen, release, and why it triggered (new, regressed, escalating, grew).

2. **Find the real code path.** Map the in-app frames to files in the code folder. Watch for these traps:
   - Error-reporting wrappers report other code's errors and are never the cause: GraphQL error links, HTTP client interceptors, error boundaries, global `onerror` handlers. Look at the operation, request, route or component they report on.
   - In a micro-frontend or module-federation host, an error in the host's project can come from a remote app. Use the route, the operation and the files to find the app.
   - Frames that don't map to a file in the repo (injected scripts, browser extensions, CDN code) are usually third-party.

3. **Check the repo's own noise rules.** Find the Sentry setup (`Sentry.init`, `sentry.*.config.*`) and its `ignoreErrors`, `denyUrls` and `beforeSend`. An issue those rules are meant to drop is noise that slipped through.

4. **Decide the owner.** If the repo has a CODEOWNERS file (`.github/CODEOWNERS`, `CODEOWNERS` or `docs/CODEOWNERS`), look up the files from step 2. The last matching pattern wins. The owner is whoever owns the broken **feature**, because they fix it or hand it to backend. Compare that with the engineer's domain:
   - in the domain: theirs, alone or shared, including a backend bug that breaks a feature they own;
   - outside it: another team's;
   - unclear: say why.
   Shared code (packages, an app shell) that breaks a feature in the domain counts as theirs.

5. **Judge severity** from volume, users, trend, the flow it breaks and how recent it is:
   - critical: users of a critical flow (login, signup, checkout, payment, publishing) are blocked right now, at volume.
   - high: a real defect in the code hitting several users, or escalating. Act today.
   - medium: a real defect with limited reach, or a non-critical flow. Plan a fix.
   - low: one-off, single user or device, no clear defect. Monitor.
   - ignore: noise (extensions, third-party scripts, bots, expected errors like validation or permission denials), or already handled.
   Severity describes the issue itself; ownership is reported separately.

6. **Write the report.** Keep it short:

   ```
   ## <SHORT-ID>: <error in a few words>

   **What's happening:** 1-3 plain sentences.

   **Severity:** <level>, with the evidence in one line (volume, users, trend, flow).

   **Owner:** <team or area> (<path> per CODEOWNERS, if any). "Yours, handle it.", "Not yours. Hand it to <team>." or why it's unclear.

   **Fix / next step:**
   - A bug in the code: file, function and line if known, the root cause in one sentence, and the change as a unified diff with the file path.
   - Otherwise: 1-3 next steps (mute and why, monitor, hand over, ask backend).
   ```

   Use backticks for every file path, symbol, query or field name.

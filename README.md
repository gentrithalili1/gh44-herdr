# gh44-herdr

My setup for the [Herdr app](https://herdr.dev): the `gh44-herdr` layout, keys, settings, my own mods and the third-party mods I use.

## Work panel

The layout's **Work panel** (the `hub` mod) lists your Linear tickets and GitHub PRs. Each row has a button that runs the next skill in its own Claude tab, in the ticket's worktree.

![Work panel](docs/work-panel.png)

By default the buttons run the gh44 skills from [gh44-brain](https://github.com/gentrithalili1/gh44-brain): `plan`, `implement`, `address-review`, `code-review` and `resolve-conflicts`. To run your own skills on tickets and PRs instead, change the skill list, keys and per-row defaults in the panel's ⚙ settings. A row with no skill picked shows `open`, which opens the PR or ticket.

- **Main button** picks the skill for the row: `plan` for a new ticket, `implement` for one in progress, `address-review` for your PR, `code-review` for someone else's.
- **▾ on a row** lists every skill plus links to Linear or GitHub.
- **PRs are grouped by whose move it is**, Linear tickets by status.
- **Merged worktrees**: a note at the top offers to clean them up.

## Community mods

Thanks to the Herdr community for these:

| Mod | What it does |
|---|---|
| [herdr-code-review](https://github.com/sangit0/herdr-code-review) (`tabbed-changes`) | Source control panel in the Changes slot: changed files and diffs open in tabs, plus history and review comments |
| [herdr-revive](https://github.com/dmazlum/herdr-revive) | Brings back the agent a terminal lost after a restart, and forks a live one |
| [herdr-auto-title](https://github.com/kryptamine/herdr-auto-title) | Service behind `auto-title` that names tabs from what the agent is doing |

## Install

1. Clone [gh44-theme](https://github.com/gentrithalili1/gh44-theme) next to this repo for the `gh44-dark` and `gh44-light` themes.
2. With the Herdr app open, run `./install.sh`. It installs the mods, keys, settings and layout. Your old files are kept as `<name>.bak-<time>`.
3. In the Work panel, open ⚙ settings and paste a Linear API key (create one in Linear under [Settings › Security & access](https://linear.app/settings/account/security)). GitHub uses your `gh` login.
4. In the same settings, pick the skills each row runs. Installed gh44 skills are picked for you.

## What's here

| Path | What |
|---|---|
| `layouts/gh44-herdr.json` | The layout |
| `keys.json`, `settings.json` | Keys and settings |
| `mods/` | My own mods: `hub` (work panel), `gh44-herdr-tabs` (tab bar), `auto-title` (names tabs) |
| `mods.txt` | Mods without an installer, copied from GitHub |
| `plugins.txt` | Mods with their own installer |
| `install.sh` | Sets up this machine |
| `sync.sh` | Copies the live layout, keys and settings back here |
| `reload.sh` | Reloads the linked mods |
| `tests/` | Work panel settings tests: `node --test tests/*.test.js` |

# gh44-herdr

My setup for the [Herdr app](https://herdr.dev): the `gh44-herdr` layout, keys, settings, my own mods and the third-party mods I use.

## Work panel

The layout's **Work panel** (the `hub` mod) shows your Linear tickets and GitHub PRs, each with a button that starts the next skill in its own Claude tab. The skills are the gh44 ones from [gh44-brain](https://github.com/gentrithalili1/gh44-brain).

```text
┌───────────────┬──────────────────────────────────┬──────────────────────────────┐
│ Spaces        │ THU-123 plan │ #456 review │ +   │ GitHub 5 │ Linear 4          │
│  frontend     ├──────────────────────────────────┤ Show ▾ │ Search…  │ Filters │
│   thu-123-…   │                                  │ ● In Progress                │
│  e2e          │  Claude Code                     │   THU-123 Add export         │
│               │  /gh44-implement THU-123         │   high · Jobs   [implement ▾]│
│ Agents        │                                  │ ● Todo                       │
│  ◌ THU-123 …  │  (the skill runs here, in the    │   THU-130 Fix filter         │
│  ○ #456 rev…  │   ticket's worktree)             │   medium        [plan ▾]     │
│               │                                  │                              │
└───────────────┴──────────────────────────────────┴──────────────────────────────┘
```

| Row | Main button | What happens |
| --- | --- | --- |
| Linear ticket in Backlog / Todo | `plan` | Asks: new worktree or this space, then runs `/gh44-plan <ticket>` in a new tab and moves the ticket to In Progress |
| Linear ticket in progress | `implement` | `/gh44-implement <ticket>` in the ticket's worktree (asks where when it has none), and moves the ticket to In Progress |
| Linear ticket in review, or my PR | `address-review` | `/gh44-address-review <pr>` |
| My PR with conflicts | `resolve-conflicts` | `/gh44-resolve-conflicts <pr>` |
| Someone else's PR | `code-review` | `/gh44-code-review <pr>` in a background tab |
| A row with an agent on it | `open` | Jumps to that agent's tab; the button shows its status |

- **▾ on a row** lists every skill (`clarify`, `plan`, `implement`, `address-review`, …) and links to Linear or GitHub. Keys on a selected row: Linear `c` clarify, `p` plan, `i` implement; GitHub `r` review, `a` address, `c` conflicts; both `o` open.
- **PRs are grouped by whose move it is**: Needs fixing, Ready to merge, To review, Waiting on others, Drafts. Linear tickets are grouped by status, with a sort inside each group.
- **The shown tab selects its row**, so you always see which ticket or PR the agent in front of you is on.
- **Switching repos is instant**: the PR lists of every repo with an open space load in the background.
- **Merged worktrees**: a note at the top offers to clean them up, spaces and branches included.

## Install

With the Herdr app open:

```sh
./install.sh
```

It:

1. Copies the `gh44-dark` and `gh44-light` Herdr themes from your `gh44-theme` repo (`gh44-theme/herdr/`). Clone it next to `gh44-herdr`, or this step is skipped. The layout picks `gh44-dark` for dark mode and `paper` for light.
2. Links the mods in `mods/` into `~/.config/herdr-app/mods`, so edits here are live. Then builds `gh44-files`: a fresh clone of Herdr's `files` panel with the gh44 code colors from `gh44-theme/herdr/gh44-syntax.js`.
3. Copies every mod in `mods.txt` fresh from its GitHub repo (`main` branch unless the line names another).
4. Copies `keys.json`, `settings.json` and `layouts/gh44-herdr.json`, and switches to the layout. A different existing file is kept as `<name>.bak-<time>`.
5. Runs the installer of every mod in `plugins.txt`, then puts `tabbed-changes` back in the Changes slot.
6. Fails if `herdr-app status` reports errors.

Safe to run again. It replaces your keys and settings with mine.

## What's here

| Path | What |
|---|---|
| `layouts/gh44-herdr.json` | The layout, with its theme, panel widths and the plugins' changes |
| `keys.json`, `settings.json` | Keys and settings |
| `mods/` | My own mods: `hub` (GitHub and Linear work panel), `gh44-herdr-tabs` (tab bar), `auto-title` (names tabs; its popup on `cmd-alt-t` installs the herdr-auto-title service, from kryptamine/herdr-auto-title) |
| `plugins.txt` | Mods with their own installer: `<owner/repo> <mod prefix>` |
| `mods.txt` | Mods without an installer, copied from GitHub: `<owner/repo> <folder> <name> [branch]`. Now `tabbed-changes` and `revive` |
| `install.sh` | Sets up this machine from the files here |
| `sync.sh` | Copies the live layout, keys and settings back here |
| `reload.sh` | Reloads the linked mods (hot reload does not follow symlinks) |

## Adding a mod

1. Install it into the `gh44-herdr` layout.
2. Record it:
   - your own mod: build it in `mods/<name>` and run `./install.sh` to link it;
   - a mod with its own installer: add `<owner/repo> <mod prefix>` to `plugins.txt`;
   - a mod without an installer: add `<owner/repo> <folder in the repo> <mod name>` to `mods.txt`.
3. Run `./sync.sh` until it passes, then commit.

`sync.sh` fails on a mod folder that is neither shipped by Herdr, linked from `mods/`, nor listed in `plugins.txt` or `mods.txt`.

## Removing a plugin

Run its installer with `--uninstall` (`curl -fsSL https://raw.githubusercontent.com/<owner/repo>/main/install.sh | sh -s -- --app --uninstall`), delete its line from `plugins.txt`, then run `./sync.sh` and commit.

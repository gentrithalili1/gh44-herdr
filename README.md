<p align="center"><img src="docs/banner.png" alt="gh44-omnia: tickets, code and agents in one window"></p>

# gh44-omnia

**Your tickets, your code and the agents that work on them, in one Herdr window. Pick a ticket, start a skill, and watch the agent do it in the right worktree.**

You jump between Linear, GitHub, a terminal per repo and a Claude tab per task, and you lose track of what runs where. gh44-omnia is a setup for the [Herdr app](https://herdr.dev) that puts it all in one layout. The **Work panel** lists your Linear tickets and GitHub PRs; each row starts its skill as a Claude agent in the ticket's worktree and shows how it goes. The **On-call** tab watches Sentry while you are on call and only tells you about the issues in your domain, with an AI report and a suggested fix. Repo skills, the gh44 themes and the gh44-brain skills are one click away.

## Work panel

One window for the whole loop: the work to do (Linear tickets, GitHub PRs), the code (spaces and worktrees), and the agents that work on it. Each ticket or PR is linked to a skill, and the skill runs as an agent in the right place.

The layout's **Work panel** (the `hub` mod) lists your tickets and PRs. Each row has a button that starts its skill in a new Claude tab, in the ticket's worktree. The agent shows up in the sidebar, and the row shows its status.

Pick the skills in the panel's ⚙ settings: your own, or the gh44 ones from [gh44-brain](https://github.com/gentrithalili1/gh44-brain). A row without an installed skill shows `open`, which opens the PR or ticket.

A repo can bring its own skills. With a terminal in the repo focused, **+ Add skill** also lists the repo's `.claude/skills` and `.claude/commands/*.md`, tagged with the repo's name. Rows offer a repo skill, its key and its case default only while that repo is focused.

## On-call

The **On-call** tab watches Sentry in the background and notifies you only about issues in your domain, each with an AI report and a suggested fix. Set it up in ⚙ settings › On-call. See [mods/hub/oncall](mods/hub/oncall/README.md).

## Community mods

| Mod                                                                                  | What it does                                                                                                     |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| [herdr-code-review](https://github.com/sangit0/herdr-code-review) (`tabbed-changes`) | Source control panel in the Changes slot: changed files and diffs open in tabs, plus history and review comments |
| [herdr-revive](https://github.com/dmazlum/herdr-revive)                              | Brings back the agent a terminal lost after a restart, and forks a live one                                      |
| [herdr-auto-title](https://github.com/kryptamine/herdr-auto-title)                   | Service behind `auto-title` that names tabs from what the agent is doing                                         |

## Install

With the Herdr app open:

```sh
git clone https://github.com/gentrithalili1/gh44-omnia.git
cd gh44-omnia
./install.sh
```

It installs the mods, keys, settings and layout. Your old files are kept as `<name>.bak-<time>`. Then pick the skills each row runs in the Work panel's ⚙ settings.

To remove it:

```sh
./uninstall.sh
```

## Optional

- **Theme:** clone [gh44-theme](https://github.com/gentrithalili1/gh44-theme) next to this repo before installing, for the `gh44-dark` and `gh44-light` themes.
- **Skills:** install [gh44-brain](https://github.com/gentrithalili1/gh44-brain) for the gh44 skills the Work panel runs. It also sets up its own `CLAUDE.md` and rules.

## What's here

| Path                         | What                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `layouts/gh44-omnia.json`    | The layout                                                                            |
| `keys.json`, `settings.json` | Keys and settings                                                                     |
| `mods/`                      | gh44 mods: `hub` (work panel), `gh44-omnia-tabs` (tab bar), `auto-title` (names tabs) |
| `mods.txt`                   | Mods without an installer, copied from GitHub                                         |
| `plugins.txt`                | Mods with their own installer                                                         |
| `install.sh`                 | Sets up this machine                                                                  |
| `uninstall.sh`               | Removes it all and brings back your old keys and settings                             |
| `sync.sh`                    | Copies the live layout, keys and settings back here                                   |
| `reload.sh`                  | Reloads the linked mods                                                               |
| `tests/`                     | Work panel settings tests: `node --test tests/*.test.js`                              |

## Screenshots

<table>
  <tr>
    <th>Work panel</th>
    <th>On-call</th>
    <th>Filters</th>
    <th>Clean up</th>
  </tr>
  <tr>
    <td align="center"><img src="docs/work-panel.png" alt="Work panel with a PR row and its skill menu" width="220"></td>
    <td align="center"><img src="docs/oncall.png" alt="On-call tab: listening to 7 projects, all clear" width="220"></td>
    <td align="center"><img src="docs/filters.png" alt="GitHub tab filters: author, label, team, reviews, assignee, CI and sort" width="220"></td>
    <td align="center"><img src="docs/merged-worktrees.png" alt="Note offering to clean up merged worktrees" width="220"></td>
  </tr>
  <tr>
    <th>General settings</th>
    <th>GitHub settings</th>
    <th>Linear settings</th>
  </tr>
  <tr>
    <td align="center"><img src="docs/settings-general.png" alt="General settings: tabs, gh44 theme and skills" width="220"></td>
    <td align="center"><img src="docs/settings-github.png" alt="GitHub settings: skills and the default for each row" width="220"></td>
    <td align="center"><img src="docs/settings-linear.png" alt="Linear settings: API key, skills, defaults and where runs go" width="220"></td>
  </tr>
</table>

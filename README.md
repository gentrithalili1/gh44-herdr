<p align="center"><img src="docs/banner.png" alt="gh44-omnia: tickets, code and agents in one window"></p>

# gh44-omnia

**Your tickets, your code and the agents that work on them, in one Herdr window. Pick a ticket, start a skill, and watch the agent do it in the right worktree.**

You jump between Linear, GitHub, a terminal per repo and a Claude tab per task, and you lose track of what runs where. gh44-omnia is a setup for the [Herdr app](https://herdr.dev) that puts it all in one layout. The **Omnia panel** lists your Linear tickets and GitHub PRs; each row starts its skill as a Claude agent in the ticket's worktree and shows how it goes. The **On-call** tab watches Sentry while you are on call and only tells you about the issues in your domain, with an AI report and a suggested fix. Repo skills, the gh44 themes and the gh44-brain skills are one click away.

## Omnia panel

One window for the whole loop: the work to do (Linear tickets, GitHub PRs), the code (spaces and worktrees), and the agents that work on it. Each ticket or PR is linked to a skill, and the skill runs as an agent in the right place.

The layout's **Omnia panel** (the `hub` mod) lists your tickets and PRs. Each row has a button that starts its skill in a new Claude tab, in the ticket's worktree. The agent shows up in the sidebar, and the row shows its status.

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

It installs the mods, keys, settings and layout. Your old files are kept as `<name>.bak-<time>`. Then pick the skills each row runs in the Omnia panel's ⚙ settings.

To remove it:

```sh
./uninstall.sh
```

## Optional

- **Theme:** clone [gh44-theme](https://github.com/gentrithalili1/gh44-theme) next to this repo before installing, for the `gh44-dark` and `gh44-light` themes.
- **Skills:** install [gh44-brain](https://github.com/gentrithalili1/gh44-brain) for the gh44 skills the Omnia panel runs. It also sets up its own `CLAUDE.md` and rules.

## What's here

| Path                         | What                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `layouts/gh44-omnia.json`    | The layout                                                                             |
| `keys.json`, `settings.json` | Keys and settings                                                                      |
| `mods/`                      | gh44 mods: `hub` (Omnia panel), `gh44-spaces` and `gh44-agents` (the Omnia sidebar: spaces, agents and leads), `gh44-omnia-tabs` (tab bar), `gh44-toasts` (notifications, top right), `auto-title` (names tabs) |
| `mods.txt`                   | Mods without an installer, copied from GitHub                                          |
| `plugins.txt`                | Mods with their own installer                                                          |
| `install.sh`                 | Sets up this machine                                                                   |
| `uninstall.sh`               | Removes it all and brings back your old keys and settings                              |
| `sync.sh`                    | Copies the live layout, keys and settings back here                                    |
| `reload.sh`                  | Reloads the linked mods                                                                |
| `tests/`                     | Omnia panel settings tests: `node --test tests/*.test.js`                              |

## Screenshots

Made-up data from demo mode (`herdr-app do hub.demo-on`, then `./reload.sh`; `hub.demo-off` to leave).

<table>
  <tr>
    <th>GitHub</th>
    <th>Linear</th>
    <th>On-call</th>
  </tr>
  <tr>
    <td align="center"><img src="docs/omnia-github.png" alt="GitHub tab: PRs grouped by whose move it is, a merged worktree note and an agent working on a PR" width="240"></td>
    <td align="center"><img src="docs/omnia-linear.png" alt="Linear tab: tickets by status, each with its next skill or its running agent" width="240"></td>
    <td align="center"><img src="docs/omnia-oncall.png" alt="On-call tab: Sentry issues the AI reported, held and ignored" width="240"></td>
  </tr>
</table>

<table>
  <tr>
    <th>General settings</th>
    <th>GitHub settings</th>
    <th>Linear settings</th>
    <th>On-call settings</th>
  </tr>
  <tr>
    <td align="center"><img src="docs/settings-general.png" alt="General settings: tabs, rows, gh44 setup and uninstall" width="180"></td>
    <td align="center"><img src="docs/settings-github.png" alt="GitHub settings: skills and what each kind of PR suggests" width="180"></td>
    <td align="center"><img src="docs/settings-linear.png" alt="Linear settings: API key, skills and what each kind of ticket suggests" width="180"></td>
    <td align="center"><img src="docs/settings-oncall.png" alt="On-call settings: Sentry token, org, projects, repo profile and domain" width="180"></td>
  </tr>
</table>

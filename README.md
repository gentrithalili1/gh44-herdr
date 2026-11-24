<p align="center"><img src="docs/gh44-omnia.png" alt="gh44-omnia" width="200"></p>
<h1 align="center">gh44-omnia</h1>
<p align="center"><strong>Tickets, code and the agents that work on them, in one Herdr window.</strong></p>
<p align="center">
<a href="https://herdr.dev"><img src="https://img.shields.io/badge/Herdr-layout-5b5bd6" alt="Herdr layout"></a>
<a href="https://claude.com/claude-code"><img src="https://img.shields.io/badge/Claude_Code-agents-d97757" alt="Claude Code"></a>
<img src="https://img.shields.io/badge/platform-macOS-000000?logo=apple" alt="macOS">
<img src="https://img.shields.io/badge/node-22%2B-3c873a?logo=node.js&logoColor=white" alt="Node 22+">
<a href="https://github.com/gentrithalili1/gh44-omnia/commits/main"><img src="https://img.shields.io/github/last-commit/gentrithalili1/gh44-omnia" alt="Last commit"></a>
<a href="https://github.com/gentrithalili1/gh44-omnia/stargazers"><img src="https://img.shields.io/github/stars/gentrithalili1/gh44-omnia?style=flat" alt="Stars"></a>
</p>

A [Herdr](https://herdr.dev) setup where each Linear ticket and GitHub PR gets a button that runs its skill as a Claude agent, in the right worktree.

## Features

- **Work panel:** your tickets and PRs, each with its skill and the agent's status.
- **On-call:** watches Sentry and notifies you only about issues in your domain, with an AI report and a fix. [More](mods/hub/oncall/README.md)
- **Repo skills:** a repo's own `.claude/skills` show up while you work in it.
- **Community mods:** [code review](https://github.com/sangit0/herdr-code-review), [revive](https://github.com/dmazlum/herdr-revive) and [auto-title](https://github.com/kryptamine/herdr-auto-title) included.

## Install

With the Herdr app open:

```sh
git clone https://github.com/gentrithalili1/gh44-omnia.git
cd gh44-omnia
./install.sh
```

Then pick the skills each row runs in the Work panel's ⚙ settings. Your old files are kept as `<name>.bak-<time>`; `./uninstall.sh` puts them back.

Optional: [gh44-theme](https://github.com/gentrithalili1/gh44-theme) (clone next to this repo first) and [gh44-brain](https://github.com/gentrithalili1/gh44-brain) for the gh44 skills.

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

## What's here

| Path                         | What                                                          |
| ---------------------------- | ------------------------------------------------------------- |
| `layouts/gh44-omnia.json`    | The layout                                                    |
| `keys.json`, `settings.json` | Keys and settings                                             |
| `mods/`                      | `hub` (Work panel), `gh44-omnia-tabs` (tab bar), `auto-title` |
| `install.sh`, `uninstall.sh` | Set up or remove it                                           |
| `sync.sh`, `reload.sh`       | Copy the live setup back here; reload the mods                |
| `tests/`                     | `node --test tests/*.test.js`                                 |

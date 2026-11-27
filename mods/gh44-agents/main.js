// Omnia agents: Herdr's agents list (copied from its `agents` mod, then changed) with leads.
// Four views (By status, By space, By lead, By machine; groupAgents.js) picked from the view menu
// beside "Agents". The space is the container: rows sit under their group on a guide line in the
// space's color, and rows out of their space's group name it. One icon, a small terminal; a lead's
// has a gold crown. Groups fold and stay folded. A lead is a Claude session that follows agents
// in any space or machine (leads.js): ⌘/shift-click agents, then Create lead; drag an agent onto a lead (or
// No lead), or right-click › Move to lead. A lead's + starts a new agent under it. Any agent can be
// renamed (names.js): its pen or right-click › Rename.
// One mod, seven copies: the list, the view menu (props().viewMenu), the agent menu
// (props().agentMenu), the Move to menu (props().moveMenu), the Create lead box
// (props().createLead), the rename box (props().renameAgent) and the new agent box
// (props().newAgent). The popups hand their actions to the list through shared(REQUEST_STORE),
// so the work outlives them.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import {
  agents, terminals, panes, focused, spaces, run, hc, notify, nextCommand, theme, shared, setShared, setAgentOrder,
  openOverlay, closeOverlay, props, window, layout,
} from "herdr";
import { groupAgents, getAgentsLayout, getMoveTargets, getFoldIds, AGENTS_LAYOUTS, AGENTS_LAYOUT_STORE } from "./groupAgents.js";
import {
  getLeadModel, withPendingLeads, getPendingStep, getStartLabels, getStopLabels, getLeadTabName, getLeadPrompt, getNewAgentLabels, getPendingAgents, getPromotePlan,
  FOLLOW_LABEL,
} from "./leads.js";
import { getDisplayName, getRenameLabels, AGENT_NAME_LABEL } from "./names.js";
import { planMove } from "./moveAgent.js";
import { getNextSelection } from "./selection.js";

const PENDING_STORE = "omnia.leads.pending";
const REQUEST_STORE = "omnia.agents.request";
const UNDO_STORE = "omnia.agents.undo";
// Each space's tile color, as the omnia spaces list draws it (it writes them).
const FILLS_STORE = "omnia.space.fills";
// Names given to machines in the omnia spaces list, keyed by Herdr's name ("" for this computer).
const MACHINE_NAMES_STORE = "omnia.machine.names";
// Each space's repo (its git folder), as the omnia spaces list knows it (it writes them): Move to
// lists an agent's checkout and worktree spaces right after its own.
const REPOS_STORE = "omnia.space.repos";
// Each worktree space's main checkout space, as the omnia spaces list knows it (it writes them).
const PARENTS_STORE = "omnia.space.parents";
const MONO_FONT = "Lilex";
const UNDO_COMMAND = "gh44-agents.undo";
// How often a lead being started is looked at.
const PENDING_MS = 1_000;
// How often the list looks for an action a popup handed it.
const REQUEST_MS = 250;
// A press becomes a drag after the pointer moves this far (window px).
const DRAG_PX = 4;
const NO_LEAD = "noLead";
// The left gutter rows get in a group where a lead folds: room for its chevron, icons stay aligned.
const FOLD_GUTTER = 14;
// Tree lines: each child branches off its parent's line with a rounded elbow to its middle (a row's,
// or a group header's under its 6px top margin). Solid colour, so joins never show a seam.
const ROW_MID = 13;
const HEADER_MID = 18;
const ELBOW_W = 7;
const ELBOW_RADIUS = 7;
const LINE_W = 1.5;
// The line's colour: the parent's, mixed into the sidebar's (a solid colour, not opacity).
const LINE_MIX = 0.55;
// By lead: its agents' icons line up under the lead's icon; the guide stays under its chevron.
const LEAD_KIDS_INDENT = 19;
const LEAD_KIDS_GUIDE = 2;
const STATUS_RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const MENU_BOX = { width: 240, height: 360 };
const VIEW_MENU_BOX = { width: 196, height: 138 };
const CREATE_BOX = { width: 360, height: 340 };
const RENAME_BOX = { width: 272, height: 112 };
const NEW_AGENT_BOX = { width: 300, height: 196 };
/** @type {Record<string, string>} */
const FAILURE = { noTab: "the tab did not open", closed: "its tab closed", noAgent: "Claude did not start", noLabel: "its labels could not be set" };

const icon = (name) => `mods/gh44-agents/icons/${name}.svg`;
const chromeIcon = (name) => `mods/workspace-chrome/${name}.svg`;
const stop = (_e, cx) => cx.stop_propagation();

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// Drops what an agent puts before its title: a status glyph or spinner and the separator
// after it ("✦  Working", "⠋ - Thinking"), and Codex's blinking "[ ! ] " / "[ . ] " mark.
// Stops at an opening bracket or quote, so a title that starts with one ("[web] login") keeps it,
// and at an emoji ("🔴 login", "❤️ deploy"), except for known status marks.
const clean = (s) => (s ?? "").replace(/^(?:\[ [!.] \] |[✋⏳]️?(?=\s)|(?!(?:\p{Emoji}️|[#*]⃣))[^\p{L}\p{N}\p{Ps}\p{Pi}\p{Emoji_Presentation}])+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((l?.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== (l?.terminal ?? l?.address) && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
// A kept sub-agent (one with a pane) is in agents() too: it keeps its own status, done included.
const kidStatus = (k, listed) => {
  if (listed.has(k.address)) return listed.get(k.address);
  const s = k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// a mixed into b by w (0..1), for #rrggbb colours; anything else comes back as a.
const mixHex = (a, b, w) => {
  const hex = /^#([0-9a-f]{6})/i;
  const [ma, mb] = [hex.exec(a ?? ""), hex.exec(b ?? "")];
  if (!ma || !mb) return a;
  const ch = (m, i) => parseInt(m[1].slice(i, i + 2), 16);
  return `#${[0, 2, 4].map((i) => Math.round(ch(ma, i) * w + ch(mb, i) * (1 - w)).toString(16).padStart(2, "0")).join("")}`;
};
const spaceFill = (space, t) => (shared(FILLS_STORE) ?? {})[space] ?? t.dim;
// A machine's name as the omnia spaces list shows it (its machineNames.js getMachineLabel; mods
// can't import each other's files).
const machineName = (machine) => {
  const own = (shared(MACHINE_NAMES_STORE) ?? {})[machine ?? ""];
  return typeof own === "string" && own ? own : machine ?? "This computer";
};
const readList = (key) => (Array.isArray(shared(key)) ? shared(key) : []);
const readPending = () => readList(PENDING_STORE).filter((p) => p && typeof p.id === "string");
const writePending = (list) => setShared(PENDING_STORE, list);
// Hands an action to the list copy, which runs it (a popup closes before async work ends).
const request = (action) => setShared(REQUEST_STORE, { ...action, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });

// Sets each terminal's labels; failed: the terminals hc refused.
async function applyLabels(changes) {
  const failed = [];
  for (const c of changes) {
    try {
      const r = await hc(["label", c.terminal, ...c.labels]);
      if (r.code !== 0) failed.push(c.terminal);
    } catch {
      failed.push(c.terminal);
    }
  }
  return failed.length ? { status: "failed", failed } : { status: "done" };
}

// The live list's agents with what a row needs: its words, the lead model and the layout's sections.
function readModel({ isCollapsed }) {
  let list = agents();
  const listed = new Map(list.map((a) => [a.address, a.status]));
  const all = terminals();
  const tree = (addr, lead = []) => {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [{ t: k, lines: [...lead, last ? "└" : "├"] }, ...tree(k.address, [...lead, last ? "" : "│"])];
    });
  };
  // A kept sub-agent (one with a pane) is in agents() too: where a tree shows
  // it, it gets no row of its own, unless it's pinned.
  const nested = new Set(isCollapsed ? [] : list.flatMap((a) => tree(a.address).map((s) => s.t.address)));
  list = list.filter((a) => a.pinned || !nested.has(a.address));
  // A row reads "space · detail": the detail is a tab someone named or the agent's own title,
  // never an automatic tab number unless two rows would otherwise read the same.
  const tabCounts = new Map();
  for (const a of list) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
  const tabLeads = leadPanes(panes());
  const tabs = new Map(spaces().flatMap((s) => s.tabs).map((tab) => [tab.id, tab]));
  const labels = new Map(list.map((a) => {
    const tab = tabs.get(a.tab);
    const many = tabCounts.get(a.tab) > 1;
    return [a.address, tab ? title(many ? { ...tab, named: false } : tab, many ? a : tabLeads.get(a.tab)) : (a.title || a.program?.name || "")];
  }));
  const label = (a) => labels.get(a.address) ?? "";
  const detail = new Map(list.map((a) => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
  const seen = {};
  for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
  for (const a of list) if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
  const labelsOf = new Map(all.map((x) => [x.address, x.labels ?? {}]));
  // Its own title; a name someone gave it (omnia.name) wins.
  const autoWords = (a) => detail.get(a.address) ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
  const words = (a) => getDisplayName({ labels: labelsOf.get(a.address), fallback: autoWords(a) });
  const model = getLeadModel({ agents: list.map((a) => ({ address: a.address, space: a.space, title: words(a) })), terminals: all });
  const pending = readPending();
  const leads = withPendingLeads({ leads: model.leads, pending });
  const pendingAgents = getPendingAgents({ pending });
  return { list, all, listed, tree, label, detail, words, autoWords, labelsOf, leads, pendingAgents, readyLeads: model.leads, leadOf: model.leadOf };
}

export default class Agents extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.createLead) return this.initCreate(p.createLead);
    if (p.renameAgent) return this.initRename(p.renameAgent);
    if (p.newAgent) return this.initNewAgent(p.newAgent);
    if (p.viewMenu) {
      this.handle = cx.focus_handle();
      this.handle.focus();
      return;
    }
    if (p.agentMenu || p.moveMenu) {
      this.isMoveOpen = Boolean(p.moveMenu);
      return;
    }
    try { this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]")); } catch { this.folded = new Set(); }
    // Each agent's last state and when it changed (ms), kept across restarts.
    try { this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}"); } catch { this.changed = {}; }
    if (!this.changed || typeof this.changed !== "object" || Array.isArray(this.changed)) this.changed = {};
    this.selection = { selected: [], anchor: null };
    this.press = null; // { address, x, y } while the left button is down on a row
    this.drag = null; // { addresses, space, over } once that press moves
    this.handled = shared(REQUEST_STORE)?.id ?? null;
    cx.timer.every(30000, (cx) => cx.notify());
    cx.timer.every(PENDING_MS, (cx) => this.advancePending(cx));
    cx.timer.every(REQUEST_MS, (cx) => this.handleRequest(shared(REQUEST_STORE), cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "undo") await this.handleUndo();
        cx.notify();
      }
    });
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Next to the view button: folds every group and lead the view shows, or opens them all when
  // all are folded already.
  foldAllButton(t, groups) {
    // The state reads only what shows (not what sits in a folded group); the click acts on everything.
    const ids = getFoldIds({ groups });
    const shownIds = getFoldIds({ groups, folded: this.folded });
    const isAllFolded = shownIds.length > 0 && shownIds.every((id) => this.folded.has(id));
    return div().id("fold-all").size(22).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim)
      .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(isAllFolded ? "Expand all" : "Collapse all")
      .on_click((_e, cx) => {
        for (const id of ids) isAllFolded ? this.folded.delete(id) : this.folded.add(id);
        localStorage.setItem("folded", JSON.stringify([...this.folded]));
        cx.notify();
      })
      .child(svg(icon(isAllFolded ? "unfold-all" : "fold-all")).size(14));
  }

  toggleFold(id, cx) {
    this.folded.has(id) ? this.folded.delete(id) : this.folded.add(id);
    localStorage.setItem("folded", JSON.stringify([...this.folded]));
    cx.notify();
  }

  // ── Actions the list runs (its own, and the popups' requests) ──

  handleRequest(req, cx) {
    if (!req?.id || req.id === this.handled) return;
    this.handled = req.id;
    switch (req.kind) {
      case "move": cx.spawn(async (cx) => { await this.handleMove({ addresses: req.addresses, to: req.to }); cx.notify(); }); break;
      case "createLead": this.startLead(req); break;
      case "newAgent": this.startNewAgent(req); break;
      case "promote": cx.spawn(async (cx) => { await this.promote(req.address); cx.notify(); }); break;
      case "rename": cx.spawn(async (cx) => { await this.renameAgent(req); cx.notify(); }); break;
      case "stopLead": cx.spawn(async (cx) => { await this.stopLead(req.lead); cx.notify(); }); break;
      default: break;
    }
  }

  async handleMove({ addresses, to }) {
    const { list, readyLeads, leadOf, words } = readModel({ isCollapsed: false });
    const plan = planMove({ agents: list, leads: readyLeads, leadOf, addresses, to });
    if (plan.status === "refused") return;
    const r = await applyLabels(plan.labels);
    if (r.status === "failed") {
      notify({ title: "Could not move every agent", body: `hc label failed for ${r.failed.join(", ")}`, level: "error" });
      return;
    }
    setShared(UNDO_STORE, { id: `${Date.now()}`, labels: plan.undo });
    const one = plan.moved.length === 1 ? list.find((a) => a.address === plan.moved[0]) : null;
    const what = one ? words(one) : `${plan.moved.length} agents`;
    notify({ title: plan.leadName ? `Moved ${what} to ${plan.leadName}` : `${what} has no lead now`, body: "Click to undo", level: "info", action: { name: UNDO_COMMAND } });
    this.selection = { selected: [], anchor: null };
  }

  async handleUndo() {
    const undo = shared(UNDO_STORE);
    if (!undo || !Array.isArray(undo.labels)) return;
    setShared(UNDO_STORE, null);
    const r = await applyLabels(undo.labels);
    if (r.status === "failed") notify({ title: "Could not undo the move", body: `hc label failed for ${r.failed.join(", ")}`, level: "error" });
  }

  // Records a start for advancePending. The space's tabs from before are kept, so only a new tab
  // is taken for it, whatever its name.
  newPending({ space, ...entry }) {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const knownTabs = spaces().find((s) => s.id === space)?.tabs.map((t) => t.id) ?? [];
    writePending([...readPending(), { id, space, status: "starting", startedAt: Date.now(), terminal: null, knownTabs, ...entry }]);
  }

  // Opens the lead's tab in the background; advancePending labels it once it shows.
  startLead({ space, name, followers }) {
    this.newPending({ space, name, followers });
    const machine = spaces().find((s) => s.id === space)?.machine ?? null;
    run("tab.new", { space, name: getLeadTabName(name), argv: ["claude", getLeadPrompt({ name, followers, machine })], focus: false });
    const spaceName = spaces().find((s) => s.id === space)?.name ?? "";
    notify({ title: `Starting ${name}`, body: `/gh44-make-lead in a new tab · ${spaceName}`, level: "info" });
  }

  // One agent made a lead: the session itself gets the lead's labels and the skill's message.
  async promote(address) {
    const model = readModel({ isCollapsed: false });
    const a = model.list.find((x) => x.address === address);
    if (!a) return;
    const name = model.words(a);
    const plan = getPromotePlan({ terminal: address, name });
    const r = await applyLabels(plan.labels);
    if (r.status === "failed") {
      notify({ title: `Could not make ${name} a lead`, body: `hc label failed for ${r.failed.join(", ")}`, level: "error" });
      return;
    }
    const sent = await hc(["send", address, plan.message]).catch(() => null);
    if (!sent || sent.code !== 0) notify({ title: `${name} is a lead, but the skill did not reach it`, body: `Run ${plan.message} in its tab.`, level: "warning" });
    else notify({ title: `${name} is now a lead`, level: "success", action: { name: "pane.focus", args: { terminal: address } } });
  }

  // A new agent under a lead: its own tab, labeled to follow the lead once it shows.
  startNewAgent({ lead, space, machine = null, name, task }) {
    // On a machine: a new space running Claude; it shows up once it reports its status.
    if (machine !== null && machine !== undefined) {
      run("space.new", { name, machine, argv: ["claude"], ...(task ? { task } : {}), focus: false });
      return;
    }
    // No lead: a plain Claude tab; it shows up once it reports its status.
    if (!lead) {
      run("tab.new", { space, name, argv: ["claude"], ...(task ? { task } : {}), focus: false });
      return;
    }
    this.newPending({ space, kind: "agent", lead, task: task || "", name });
    run("tab.new", { space, name, argv: ["claude"], ...(task ? { task } : {}), focus: false });
  }

  // Starts a failed lead or new agent again.
  retryPending(pendingId) {
    const p = readPending().find((x) => x.id === pendingId);
    if (!p) return;
    this.removePending(p.id);
    if (p.kind === "agent") this.startNewAgent({ lead: p.lead, space: p.space, name: p.name, task: p.task });
    else this.startLead({ space: p.space, name: p.name, followers: p.followers ?? [] });
  }

  // The name on its terminal (empty: its own title again), and on its tab so the tab bar matches.
  async renameAgent({ address, name }) {
    const a = agents().find((x) => x.address === address);
    const r = await applyLabels(getRenameLabels({ terminal: address, name }));
    if (r.status === "failed") {
      notify({ title: "Could not rename the agent", body: `hc label failed for ${r.failed.join(", ")}`, level: "error" });
      return;
    }
    // The tab bar follows only when the tab is this agent's alone.
    if (a && panes().filter((x) => x.tab === a.tab && x.terminal).length === 1) run("tab.rename", { id: a.tab, name: name.trim() });
  }

  async stopLead(lead) {
    const r = await applyLabels(getStopLabels({ lead }));
    if (r.status === "failed") notify({ title: `Could not stop ${lead.name} leading`, body: `hc label failed for ${r.failed.join(", ")}`, level: "error" });
    else notify({ title: `${lead.name} stopped leading`, body: "Its session keeps running.", level: "info" });
  }

  removePending(pendingId) {
    const p = readPending().find((x) => x.id === pendingId);
    writePending(readPending().filter((x) => x.id !== pendingId));
    if (p?.terminal) void this.stripPending(p, p.terminal);
  }

  // Takes a pending entry's labels off its terminal: a new agent keeps running as a plain agent;
  // a lead loses its labels and its followers'.
  async stripPending(p, terminal) {
    await applyLabels(p.kind === "agent"
      ? [{ terminal, labels: [`${FOLLOW_LABEL}=`, `${AGENT_NAME_LABEL}=`] }]
      : getStopLabels({ lead: { address: terminal, followers: p.followers ?? [] } }));
  }

  advancePending(cx) {
    const pending = readPending();
    // Failed ones with a terminal too: one that came up after all is ready.
    if (!pending.some((p) => p.status === "starting" || p.terminal) || this.isAdvancing) return;
    this.isAdvancing = true;
    cx.spawn(async (cx) => {
      const { readyLeads, list } = readModel({ isCollapsed: false });
      const leadAddresses = new Set(readyLeads.map((l) => l.address));
      const agentAddresses = new Set(list.map((a) => a.address));
      const now = Date.now();
      // id -> what changes, null: gone. Applied to a fresh read, so leads started, retried or
      // removed while the labels were set stay as they are.
      const patches = new Map();
      // Terminals other entries took: two starts with the same name never take the same tab.
      const claimed = new Set(pending.map((x) => x.terminal).filter(Boolean));
      for (const p of pending) {
        const step = getPendingStep({ pending: p, now, spaces: spaces(), panes: panes(), leadAddresses, agentAddresses, claimed });
        const isAgent = p.kind === "agent";
        switch (step.kind) {
          case "label": {
            const r = await applyLabels(isAgent
              ? getNewAgentLabels({ terminal: step.terminal, lead: p.lead, name: p.name })
              : getStartLabels({ lead: step.terminal, name: p.name, followers: p.followers }));
            claimed.add(step.terminal);
            // Removed while its labels were set: take them off again.
            if (!readPending().some((x) => x.id === p.id)) {
              await this.stripPending(p, step.terminal);
              break;
            }
            if (r.status === "done") patches.set(p.id, { terminal: step.terminal });
            else {
              patches.set(p.id, { status: "failed", reason: "noLabel" });
              notify({ title: `${p.name} did not start`, body: `${FAILURE.noLabel}: hc label failed for ${r.failed.join(", ")}`, level: "error" });
            }
            break;
          }
          case "ready":
            patches.set(p.id, null);
            notify({
              title: `${p.name} is ready`,
              body: isAgent ? `Under ${readyLeads.find((l) => l.address === p.lead)?.name ?? "its lead"}` : `Follows ${p.followers.length} ${p.followers.length === 1 ? "agent" : "agents"}`,
              level: "success", action: { name: "pane.focus", args: { terminal: p.terminal } },
            });
            break;
          case "fail":
            patches.set(p.id, { status: "failed", reason: step.reason });
            notify({ title: `${p.name} did not start`, body: FAILURE[step.reason] ?? "", level: "error" });
            break;
          case "wait":
            break;
          default: {
            /** @type {never} */
            const unknownStep = step;
            return unknownStep;
          }
        }
      }
      writePending(readPending().flatMap((x) => {
        if (!patches.has(x.id)) return [x];
        const change = patches.get(x.id);
        return change === null ? [] : [{ ...x, ...change }];
      }));
      this.isAdvancing = false;
      cx.notify();
    });
  }

  // ── Drag an agent onto a lead ──

  // What dropping these agents on `over` (a lead's address or NO_LEAD) would do.
  dropPlan({ addresses, over }) {
    const { list, readyLeads, leadOf } = this.model;
    return planMove({ agents: list, leads: readyLeads, leadOf, addresses, to: over === NO_LEAD ? null : over });
  }

  handleWindowMove(e, cx) {
    if (!this.press) return;
    if (e.pressed_button !== "left") { this.press = null; this.drag = null; cx.notify(); return; }
    if (this.drag) return;
    if (Math.hypot(e.position.x - this.press.x, e.position.y - this.press.y) < DRAG_PX) return;
    const picked = this.selection.selected.includes(this.press.address) ? this.selection.selected : [this.press.address];
    this.drag = { addresses: picked, over: null };
    cx.notify();
  }

  handleWindowRelease(cx) {
    const drag = this.drag;
    this.press = null;
    this.drag = null;
    if (drag?.over) {
      const plan = this.dropPlan(drag);
      if (plan?.status === "moved") cx.spawn(async (cx) => { await this.handleMove({ addresses: drag.addresses, to: drag.over === NO_LEAD ? null : drag.over }); cx.notify(); });
    }
    if (drag) cx.notify();
  }

  // ── Pieces ──

  // The status mark at a row's end: a ring (idle), a dot (done), a spinner (working), a ! (needs you).
  status(t, a) {
    const mark = (() => {
      switch (a.status) {
        case "working": return svg(chromeIcon("spinner")).size(10).text_color(t.working).spin(900);
        case "blocked": return div().size(14).rounded(4).bg(`${t.blocked}2B`).text_size(10).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
        case "done": return div().size(7).rounded(4).bg(t.done);
        default: return div().size(7).rounded(4).border(1.5).border_color(t.unknown);
      }
    })();
    return h_flex().w(14).flex_none().items_center().justify_center().child(mark);
  }

  iconButton({ t, id, name, tip, onClick }) {
    return div().id(id).size(20).flex_none().flex().items_center().justify_center().rounded(5)
      .text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.raised).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
      .child(svg(icon(name)).size(12));
  }

  // One icon for every agent, a small terminal; a lead is the same terminal under a small purple
  // crown; a picked agent shows a sky check instead.
  agentIcon(t, { isLead = false, isPicked = false, color = null }) {
    const box = h_flex().w(14).h(14).flex_none().relative().items_center().justify_center();
    if (isPicked) return box.child(h_flex().size(11).rounded(3).bg(t.accent).items_center().justify_center().child(svg(icon("tick")).size(9).text_color(t.background)));
    if (!isLead) return box.child(svg(icon("agent")).size(14).text_color(color ?? t.unknown));
    return box
      .child(svg(icon("lead-terminal")).size(14).text_color(color ?? t.unknown))
      .child(div().absolute().left(0).top(0).child(svg(icon("lead-crown")).size(14).text_color(t.ansi3)));
  }

  // A space's tag: its name in a faint chip of its colour, so it reads as a label, never a status dot.
  spaceTag(t, space, name) {
    const fill = spaceFill(space, t);
    const tint = /^#[0-9a-f]{6}$/i.test(fill) ? `${fill}24` : t.hover;
    return h_flex().flex_none().max_w(120).ml(8).h(16).px(6).items_center().rounded(4).bg(tint)
      .text_size(11).text_color(fill)
      .child(div().min_w(0).truncate().child(name));
  }

  // One child of a tree: its elements, and where its elbow meets it.
  node(els, mid = ROW_MID) {
    return { els, mid };
  }

  // Indented under a parent: a line in the parent's colour runs down; each child branches off it
  // with a rounded elbow, and the line ends at the last child. Rows start right of the elbow.
  kids(nodes, { color, indent = 16, guide = 5 }) {
    const line = mixHex(color, theme().chrome, LINE_MIX);
    return v_flex().ml(indent).children(nodes.map((n, i) => v_flex().relative().children(n.els)
      .when(i < nodes.length - 1, (e) => e.child(div().absolute().left(guide).top(4).bottom(0).w(LINE_W).bg(line)))
      .child(div().absolute().left(guide).top(0).w(ELBOW_W + LINE_W).h(n.mid)
        .border_l(LINE_W).border_b(LINE_W).border_color(line).rounded_bl(ELBOW_RADIUS))));
  }

  // While dragging: what this row or header does with the dragged agents (a lead's address or NO_LEAD).
  dropState(to) {
    if (!this.drag || to === null) return this.drag ? "dim" : "none";
    return this.dropPlan({ addresses: this.drag.addresses, over: to })?.status === "moved" ? "target" : "dim";
  }

  // The pointer left a drop target: nothing is under it any more.
  leaveDrop(to) {
    if (this.drag?.over === to) this.drag.over = null;
  }

  // A row's hover: its own hovered state, and the drop target it is.
  handleRowHover({ address, isOn, cx }) {
    if (isOn) this.hovered = address;
    else {
      if (this.hovered === address) this.hovered = null;
      this.leaveDrop(address);
    }
    cx.notify();
  }

  // A drop target: lavender with "Move here" while the pointer is on it; dimmed when it can't take
  // them. ownsHover: the element has its own on_hover, which calls leaveDrop (GPUI keeps one).
  dropTarget(el, to, { ownsHover = false } = {}) {
    if (!this.drag) return el;
    const t = theme();
    const state = this.dropState(to);
    const isOver = state === "target" && this.drag.over === to;
    return el
      .on_mouse_move((_e, cx) => { if (this.drag && this.drag.over !== to) { this.drag.over = to; cx.notify(); } })
      .when(!ownsHover, (e) => e.on_hover((hovered, cx) => { if (!hovered) { this.leaveDrop(to); cx.notify(); } }))
      .when(state === "dim", (e) => e.opacity(0.45))
      .when(state === "target", (e) => e.bg(`${t.ansi5}1F`))
      .when(isOver, (e) => e.border(1).border_color(`${t.ansi5}8C`)
        .child(div().absolute().right(8).px(4).text_size(11).text_color(t.ansi5).bg(t.chrome).child("Move here")));
  }

  // A group header: chevron, a mark (space square, status, crown, machine), name, count. Quiet:
  // agents carry the weight.
  header(t, g, { mark, isMachine = false, dropTo = null, newIn = null, newOn = undefined }) {
    const hasNew = Boolean(newIn) || newOn !== undefined;
    const isOpen = !this.folded.has(g.id);
    const hoverId = `header:${g.id}`;
    const isHovered = hasNew && this.hovered === hoverId && !this.drag;
    const el = h_flex().id(`gh-${g.id}`).relative().h(24).mt(6).mx(6).px(10).gap(7).flex_none().items_center().rounded(5)
      .text_size(11.5).text_color(isMachine ? t.muted : t.dim).when(isMachine, (e) => e.font_semibold())
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.toggleFold(g.id, cx))
      .when(hasNew, (e) => e.on_hover((isOn, cx) => this.handleRowHover({ address: hoverId, isOn, cx })))
      .child(svg(icon(isOpen ? "chevron" : "chevron-right")).size(12).flex_none().text_color(t.unknown))
      .when(Boolean(mark), (e) => e.child(mark))
      .child(div().min_w(0).truncate().child(g.title))
      .child(div().flex_none().font_family(MONO_FONT).text_size(10.5).font_normal().text_color(t.unknown).child(String(g.count)))
      // + starts a new agent: in a space's own folder, or on a machine in a new space; shown on hover.
      .when(isHovered, (e) => e.child(div().flex_1()).child(this.iconButton({ t, id: `new-${g.id}`, name: "plus",
        tip: newIn ? "New agent in this space" : "New Claude session on this machine",
        onClick: () => this.openNewAgent(newIn ? { space: newIn } : { machine: newOn }) })));
    return dropTo ? this.dropTarget(el, dropTo) : (this.drag ? el.opacity(0.45) : el);
  }

  spaceMark(t, space) {
    return div().size(8).rounded(2).flex_none().bg(spaceFill(space, t));
  }

  // A row's end, also the By lead header's: a failed lead's Retry and Remove, a starting lead's
  // spinner, else the time (on hover Stop leading or Pin) and the status.
  rowEnd(t, { lead, a, address, now, isHovered }) {
    if (lead?.state === "failed" || lead?.state === "starting") return this.pendingEnd(t, { pending: lead, address });
    const when = a ? this.since(a) : 0;
    const hoverButton = lead
      ? this.iconButton({ t, id: `lead-stop-${address}`, name: "x", tip: "Stop leading (the session keeps running)", onClick: (cx) => cx.spawn(async (cx) => { await this.stopLead(lead); cx.notify(); }) })
      : this.iconButton({ t, id: `pin-${address}`, name: "pin", tip: a.pinned ? "Unpin" : "Pin to the top", onClick: (cx) => { run("terminal.pin", { terminal: address, pinned: !a.pinned }); this.hovered = null; cx.notify(); } });
    const hoverButtons = [
      ...(lead ? [this.iconButton({ t, id: `lead-new-${address}`, name: "plus", tip: "New agent under this lead", onClick: () => this.openNewAgent({ lead }) })] : []),
      ...(a ? [this.iconButton({ t, id: `rename-${address}`, name: "pen", tip: "Rename", onClick: () => this.openRename(address) })] : []),
      hoverButton,
    ];
    return [
      ...(isHovered ? hoverButtons : [div().flex_none().font_family(MONO_FONT).text_size(11).text_color(t.unknown).child(when ? duration(now - when) : "")]),
      ...(a ? [this.status(t, a)] : []),
    ];
  }

  // A lead or new agent being started: a spinner; failed: Retry and Remove.
  pendingEnd(t, { pending, address }) {
    if (pending.state === "starting") return [h_flex().w(14).flex_none().justify_center().child(svg(chromeIcon("spinner")).size(10).text_color(t.ansi5).spin(900))];
    return [
      this.iconButton({ t, id: `pending-retry-${address}`, name: "retry", tip: "Retry", onClick: (cx) => { this.retryPending(pending.pendingId); cx.notify(); } }),
      this.iconButton({ t, id: `pending-remove-${address}`, name: "x", tip: "Remove", onClick: (cx) => { this.removePending(pending.pendingId); cx.notify(); } }),
    ];
  }

  // What a lead or new agent being started says: "starting", or why it failed.
  pendingNote(p) {
    return p.state === "starting" ? "starting" : (FAILURE[p.reason] ?? "failed");
  }

  pendingNoteEl(t, p) {
    return div().flex_none().ml(6).text_size(11.5).text_color(p.state === "failed" ? t.blocked : t.unknown).child(this.pendingNote(p));
  }

  // A row's box, in its group right of the guide line; hasGutter: room on the left for a lead's
  // fold chevron, given to every row of that group so their icons line up.
  rowBox(id, hasGutter = false) {
    return h_flex().id(id).relative().h(26).flex_none().ml(12).pl(4 + (hasGutter ? FOLD_GUTTER : 0)).pr(10).mr(6).gap(8).items_center().rounded(6);
  }

  // A new agent being started under its lead: its name and "starting", or why it failed.
  pendingRow(t, p, hasGutter = false) {
    return this.rowBox(`row-${p.address}`, hasGutter)
      .when(Boolean(this.drag), (e) => e.opacity(0.45))
      .child(this.agentIcon(t, { color: p.state === "failed" ? t.blocked : null }))
      .child(h_flex().flex_1().min_w(0).items_center()
        .child(div().flex_initial().min_w(0).truncate().text_color(t.foreground).child(p.name))
        .child(this.pendingNoteEl(t, p)))
      .children(this.pendingEnd(t, { pending: p, address: p.address }));
  }

  openRename(address) {
    openOverlay({ mod: "gh44-agents", kind: "popup", ...RENAME_BOX, props: { renameAgent: { address } } });
  }

  // The New agent box: under a lead, or (space only) on its own in that space.
  openNewAgent({ lead = null, space = lead?.space ?? null, machine = null }) {
    openOverlay({ mod: "gh44-agents", kind: "popup", ...NEW_AGENT_BOX, props: { newAgent: { lead: lead?.address ?? null, space, machine, leadName: lead?.name ?? null } } });
  }

  // A row: icon, title (and its space when out of its group), time, status. Grey = the focused
  // tab, sky + check = picked. A lead's row looks like any row but for its crown.
  row(t, r, { model, now, shownSpaces, hasGutter = false }) {
    const isLeadRow = r.kind === "lead";
    const lead = isLeadRow ? r.lead : null;
    const a = isLeadRow ? (model.list.find((x) => x.address === lead.address) ?? null) : r.agent;
    const address = isLeadRow ? lead.address : a.address;
    const space = isLeadRow ? lead.space : a.space;
    const spaceName = spaces().find((x) => x.id === space)?.name ?? a?.space_name ?? "";
    const isPicked = !isLeadRow && this.selection.selected.includes(address);
    const isDragged = Boolean(this.drag?.addresses.includes(address));
    const isHovered = this.hovered === address && !this.drag;
    const isFailed = lead?.state === "failed";
    const isStarting = lead?.state === "starting";
    const name = isLeadRow ? lead.name : model.words(a);
    const end = this.rowEnd(t, { lead, a, address, now, isHovered });
    // A lead with agents under it folds them; folded, it says how many it hides and their most urgent status.
    const foldKey = `fold:${address}`;
    const isFoldable = isLeadRow && r.children.length > 0;
    const isFolded = isFoldable && this.folded.has(foldKey);
    const hidden = isLeadRow ? r.children : [];
    const top = hidden.filter((c) => c.kind === "agent").map((c) => c.agent).reduce((m, f) => ((STATUS_RANK[f.status] ?? 0) > (STATUS_RANK[m] ?? 0) ? f.status : m), null);
    const el = this.rowBox(`row-${address}`, hasGutter)
      .when(Boolean(a?.focused), (e) => e.bg(t.selected))
      .when(isPicked, (e) => e.bg(`${t.accent}1F`))
      .when(isDragged, (e) => e.opacity(0.4))
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_hover((isOn, cx) => this.handleRowHover({ address, isOn, cx }))
      .when(!isLeadRow, (e) => e.on_mouse_down("left", (ev) => { this.press = { address, x: ev.position.x, y: ev.position.y }; }))
      .when(Boolean(a), (e) => e
        .on_click((ev, cx) => this.handleAgentClick({ a, isLead: isLeadRow, foldKey: isFoldable ? foldKey : null, e: ev, shownSpaces, cx }))
        .on_mouse_down("right", () => openOverlay({ mod: "gh44-agents", kind: "popup", ...MENU_BOX, props: { agentMenu: { address } } })))
      .when(isFoldable, (e) => e.child(div().id(`fold-${address}`).absolute().left(3).top(5).size(16).flex().items_center().justify_center().rounded(4)
        .text_color(t.unknown).hover((s) => s.text_color(t.foreground)).tooltip(isFolded ? "Show its agents" : "Fold its agents")
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); this.toggleFold(foldKey, cx); })
        .child(svg(icon(isFolded ? "chevron-right" : "chevron")).size(12))))
      .child(this.agentIcon(t, { isLead: isLeadRow, isPicked, color: isFailed ? t.blocked : null }))
      .child(h_flex().flex_1().min_w(0).items_center()
        .child(div().id(`title-${address}`).flex_initial().min_w(0).truncate().text_color(t.foreground)
          .child(name))
        .when(isFolded, (e) => e.child(div().flex_none().ml(6).font_family(MONO_FONT).text_size(10.5).text_color(t.unknown).child(String(hidden.length))))
        .when(isStarting || isFailed, (e) => e.child(this.pendingNoteEl(t, lead)))
        .when(r.isCross, (e) => e.child(this.spaceTag(t, space, spaceName)))
        .when(!isLeadRow && Boolean(r.lead), (e) => e.child(h_flex().flex_shrink(100).min_w(10).ml(6).gap(4).items_center().text_size(11.5).text_color(t.unknown)
          .child(svg(icon("crown")).size(10).flex_none().text_color(t.ansi3))
          .child(div().min_w(0).truncate().child(r.lead?.name ?? "")))))
      .when(isFolded && Boolean(top) && top !== "idle", (e) => e.child(this.status(t, { status: top })))
      .children(end);
    if (isLeadRow && lead.state === "ready") return this.dropTarget(el, address, { ownsHover: true });
    return this.drag && !isDragged ? el.opacity(0.45) : el;
  }

  // A row with its sub-agents under it; under a lead (By space, By machine), its agents too.
  rowTree(t, r, ctx) {
    if (r.kind === "pending") return [this.pendingRow(t, r.pending, ctx.hasGutter)];
    const built = [this.row(t, r, ctx), ...this.subRows(t, r.kind === "lead" ? r.lead.address : r.agent.address, ctx)];
    if (r.kind === "lead" && r.children.length && !this.folded.has(`fold:${r.lead.address}`)) {
      const inner = { ...ctx, hasGutter: false };
      built.push(this.kids(r.children.map((c) => this.node(this.rowTree(t, c, inner))), { color: spaceFill(r.lead.space, t), indent: 14 + (ctx.hasGutter ? FOLD_GUTTER : 0) }));
    }
    return built;
  }

  // A group's rows; when a lead in it folds, every row gets the chevron's gutter.
  groupRows(t, rows, ctx) {
    const hasGutter = rows.some((r) => r.kind === "lead" && r.children.length > 0);
    return rows.map((r) => this.node(this.rowTree(t, r, { ...ctx, hasGutter })));
  }

  // The sub-agents an agent or a lead started (readModel leaves them out of the list for this).
  subRows(t, address, ctx) {
    return ctx.model.tree(address).map((s) => this.subRow(t, s, ctx.shown, ctx.model));
  }

  // By lead: the lead is the group header. A click opens its terminal and folds it; its chevron only folds.
  leadHeader(t, g, ctx) {
    const lead = g.lead;
    const a = ctx.model.list.find((x) => x.address === lead.address) ?? null;
    const isOpen = !this.folded.has(g.id);
    const spaceName = spaces().find((x) => x.id === lead.space)?.name ?? "";
    const isFailed = lead.state === "failed";
    const isHovered = this.hovered === lead.address && !this.drag;
    const el = h_flex().id(`lh-${lead.address}`).relative().h(26).mt(6).mx(6).px(10).gap(7).flex_none().items_center().rounded(5)
      .text_size(12.5).text_color(a?.focused ? t.foreground : t.muted).when(Boolean(a?.focused), (e) => e.bg(t.selected))
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .when(Boolean(a), (e) => e.on_click((_e, cx) => { run("pane.focus", { pane: a.pane }); this.toggleFold(g.id, cx); })
        .on_mouse_down("right", () => openOverlay({ mod: "gh44-agents", kind: "popup", ...MENU_BOX, props: { agentMenu: { address: lead.address } } })))
      .on_hover((isOn, cx) => this.handleRowHover({ address: lead.address, isOn, cx }))
      .child(div().id(`lh-fold-${lead.address}`).flex_none().rounded(4).text_color(t.unknown).hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); this.toggleFold(g.id, cx); })
        .child(svg(icon(isOpen ? "chevron" : "chevron-right")).size(12)))
      .child(this.agentIcon(t, { isLead: true, color: isFailed ? t.blocked : null }))
      .child(div().id(`lh-name-${lead.address}`).flex_none().max_w(140).truncate()
        .child(lead.name))
      .child(div().flex_none().font_family(MONO_FONT).text_size(10.5).text_color(t.unknown).child(String(g.count)))
      .child(this.spaceTag(t, lead.space, lead.state === "ready" ? spaceName : this.pendingNote(lead)))
      .child(div().flex_1())
      .children(this.rowEnd(t, { lead, a, address: lead.address, now: ctx.now, isHovered }));
    return lead.state === "ready" ? this.dropTarget(el, lead.address, { ownsHover: true }) : el;
  }

  // A group and what is under it, as the view draws it.
  groupTree(t, g, ctx) {
    const isOpen = !this.folded.has(g.id);
    const color = g.space ? spaceFill(g.space, t) : t.unknown;
    const rows = () => this.groupRows(t, g.rows, ctx);
    switch (g.kind) {
      case "lead": {
        const head = this.leadHeader(t, g, ctx);
        if (!isOpen) return [head];
        return [head, ...this.subRows(t, g.lead.address, ctx), g.rows.length
          ? this.kids(rows(), { color, indent: LEAD_KIDS_INDENT, guide: LEAD_KIDS_GUIDE })
          : div().pl(34).pr(16).pt(4).pb(6).text_size(11.5).text_color(t.unknown).child("No agents yet. Drag one here.")];
      }
      case "machine": {
        const mark = svg(icon(g.machine ? "server" : "laptop")).size(12).flex_none();
        return [this.header(t, g, { mark, isMachine: true, newOn: g.machine ?? "" }), ...(isOpen ? [this.kids(g.groups.map((inner) => this.node(this.groupTree(t, inner, ctx), HEADER_MID)), { color: t.unknown, indent: 10 })] : [])];
      }
      case "space": {
        // A worktree nests under its main space, on that space's guide, with a branch in its own colour.
        const mark = g.isWorktree ? svg(chromeIcon("branch")).size(12).flex_none().text_color(color) : this.spaceMark(t, g.space);
        const inner = () => [...rows(), ...g.groups.map((w) => this.node(this.groupTree(t, w, ctx), HEADER_MID))];
        return [this.header(t, g, { mark, newIn: g.space }), ...(isOpen ? [this.kids(inner(), { color })] : [])];
      }
      case "leads":
        return [this.header(t, g, { mark: svg(icon("crown")).size(12).flex_none().text_color(t.ansi3) }), ...(isOpen ? [this.kids(rows(), { color })] : [])];
      case "status":
        return [this.header(t, g, { mark: this.status(t, { status: g.status }) }), ...(isOpen ? [this.kids(rows(), { color })] : [])];
      case "noLead":
        return [this.header(t, g, { mark: svg(icon("agent")).size(12).flex_none().text_color(t.unknown), dropTo: NO_LEAD }), ...(isOpen ? [this.kids(rows(), { color })] : [])];
      case "pinned":
        return [this.header(t, g, { mark: null }), ...(isOpen ? [this.kids(rows(), { color })] : [])];
      default: {
        /** @type {never} */
        const unknownKind = g.kind;
        return unknownKind;
      }
    }
  }

  // Click: show it (a lead with agents also folds). ⌘-click / shift-click: pick it, in any space. A lead is never picked.
  handleAgentClick({ a, isLead, foldKey = null, e, shownSpaces, cx }) {
    const mode = e.modifiers?.platform ? "toggle" : e.modifiers?.shift ? "range" : null;
    if (mode && isLead) return;
    if (!mode) {
      this.selection = { selected: [], anchor: a.address };
      run("pane.focus", { pane: a.pane });
      if (foldKey) this.toggleFold(foldKey, cx);
    } else {
      this.selection = getNextSelection({ ...this.selection, shown: shownSpaces, address: a.address, mode });
    }
    cx.notify();
  }

  subRow(t, s, shown, model) {
    const k = s.t;
    const st = kidStatus(k, model.listed);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .ml(12)
      .pl(22)
      .pr(10)
      .mr(6)
      .rounded(6)
      .h(24)
      .flex_none()
      .items_center()
      .text_size(12)
      .when(on, (el) => el.bg(t.selected))
      .hover((x) => x.bg(t.hover))
      .on_click(() => (model.listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : run("terminal.peek", { terminal: k.address })))
      .children(s.lines.map((l) => div().self_start().mt(-4).w(9).h(16).mr(4).flex_none()
        .when(Boolean(l), (el) => el.border_l(1).border_color(t.border))
        .when(l === "└" || l === "├", (el) => el.border_b(1).rounded_bl(6))))
      .child(div().mr(8).child(this.agentIcon(t, {})))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(getDisplayName({ labels: k.labels, fallback: k.name || k.template || k.program?.name || k.address })))
      .child(this.status(t, { status: st }));
  }

  // n selected in <space> (or in n spaces): Create lead, Move to, ✕.
  selectionBar(t, model) {
    // A lead never follows another lead.
    const picked = this.selection.selected.filter((a) => !model.leads.some((l) => l.address === a));
    const first = model.list.find((a) => a.address === picked[0]);
    // A new lead starts in the space of the first agent picked.
    const space = first?.space ?? null;
    const pickedSpaces = new Set(picked.map((address) => model.list.find((a) => a.address === address)?.space).filter(Boolean));
    const button = ({ id, label, isLead = false, iconName = null, onClick }) => h_flex().id(id).h(22).px(9).gap(5).items_center().rounded(6).text_size(12).font_medium()
      .bg(isLead ? `${t.ansi5}1F` : t.raised).text_color(isLead ? t.ansi5 : t.foreground)
      .cursor_pointer().hover((s) => s.bg(isLead ? `${t.ansi5}33` : t.input))
      .on_click((e, cx) => onClick(e, cx))
      .when(Boolean(iconName), (el) => el.child(svg(icon(iconName)).size(12)))
      .child(label);
    return h_flex().mx(8).mb(8).pl(10).pr(6).py(6).flex_none().gap(6).items_center().rounded(9).bg(t.popover).border(1).border_color(t.input).text_size(12)
      .child(div().flex_none().font_semibold().text_color(t.foreground).child(String(picked.length)))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(pickedSpaces.size > 1
        ? `selected in ${pickedSpaces.size} spaces`
        : `selected in ${first ? (spaces().find((s) => s.id === space)?.name ?? first.space_name) : ""}`))
      // One picked: that session becomes the lead. Several: a new lead session follows them.
      .child(picked.length === 1
        ? button({ id: "sel-lead", label: "Make lead", isLead: true, iconName: "crown", onClick: (_e, cx) => { this.selection = { selected: [], anchor: null }; cx.spawn(async (cx) => { await this.promote(picked[0]); cx.notify(); }); } })
        : button({ id: "sel-lead", label: `Create lead (${picked.length})`, isLead: true, iconName: "crown", onClick: () => openOverlay({ mod: "gh44-agents", kind: "dialog", ...CREATE_BOX, props: { createLead: { space, followers: picked } } }) }))
      .child(button({ id: "sel-move", label: "Move to", onClick: () => openOverlay({ mod: "gh44-agents", kind: "popup", ...MENU_BOX, props: { moveMenu: { addresses: picked } } }) }))
      .child(div().id("sel-clear").size(22).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Clear selection")
        .on_click((_e, cx) => { this.selection = { selected: [], anchor: null }; cx.notify(); }).child(svg(icon("x")).size(12)));
  }

  // ── Popups ──

  // The view menu, as the Omnia panel's menus: a titled list, a check on the current view.
  // ⌃1 to ⌃4 pick a view while it is open.
  renderViewMenu(t) {
    const current = getAgentsLayout(shared(AGENTS_LAYOUT_STORE));
    const pick = (id) => { setShared(AGENTS_LAYOUT_STORE, id); closeOverlay(props().overlay); };
    return v_flex().id("view-menu").track_focus(this.handle).w_full().p(4).bg(t.popover).text_size(12.5)
      .on_key_down((e, cx) => {
        const n = Number(e.key);
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (n >= 1 && n <= AGENTS_LAYOUTS.length) pick(AGENTS_LAYOUTS[n - 1].id);
        cx.stop_propagation();
      })
      .child(div().px(8).pt(5).pb(3).text_size(11).font_medium().text_color(t.unknown).child("Group agents"))
      .children(AGENTS_LAYOUTS.map((l, i) => h_flex().id(`view-${l.id}`).h(26).px(8).gap(8).items_center().rounded(5).text_color(t.foreground)
        .cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click(() => pick(l.id))
        .child(h_flex().w(14).flex_none().justify_center().when(l.id === current, (el) => el.child(svg(icon("tick")).size(13).text_color(t.accent))))
        .child(div().flex_1().child(l.label))
        .child(div().flex_none().font_family(MONO_FONT).text_size(11).text_color(t.unknown).child(`⌃${i + 1}`))));
  }

  // Right-click on an agent: Move to lead ▸ (every lead: its own space first, then its repo's
  // spaces, then the rest; and No lead), Make lead, Pin, and for a lead Stop leading. Move to from
  // the selection bar opens the lead list itself.
  renderMenu(t) {
    const p = props();
    const addresses = p.moveMenu ? p.moveMenu.addresses : [p.agentMenu.address];
    const model = readModel({ isCollapsed: false });
    const first = model.list.find((a) => a.address === addresses[0]);
    const close = () => closeOverlay(p.overlay);
    if (!first) return div().p(10).bg(t.popover).text_size(12).text_color(t.dim).child("That agent is gone.");
    const lead = model.readyLeads.find((l) => l.address === first.address) ?? null;
    const targets = getMoveTargets({
      space: first.space, leads: model.readyLeads.filter((l) => !addresses.includes(l.address)),
      spaces: spaces().map((s) => ({ id: s.id, name: s.name, machine: s.machine ?? null })), repoOf: shared(REPOS_STORE) ?? {},
    });
    const current = addresses.length === 1 ? (model.leadOf.get(first.address) ?? null) : undefined;
    const item = ({ id, label, mark = null, isChecked = false, isMuted = false, trailing = null, onPick }) => h_flex().id(`menu-${id}`).h(28).px(8).gap(8).rounded(5).items_center()
      .text_color(isMuted ? t.dim : t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => onPick(cx))
      .child(h_flex().w(14).flex_none().justify_center().when(Boolean(mark), (el) => el.child(mark)))
      .child(div().flex_1().truncate().child(label))
      .when(isChecked, (el) => el.child(svg(icon("tick")).size(13).flex_none().text_color(t.accent)))
      .when(Boolean(trailing), (el) => el.child(div().flex_none().text_color(t.dim).child(trailing)));
    const crown = () => svg(icon("crown")).size(13).text_color(t.ansi3);
    const glyph = (name) => svg(icon(name)).size(13).text_color(t.dim);
    const move = (to) => { request({ kind: "move", addresses, to }); close(); };
    if (this.isMoveOpen) {
      return v_flex().id("agent-move-menu").size_full().p(4).bg(t.popover).text_size(12.5)
        .child(h_flex().id("menu-back").h(24).px(8).gap(6).items_center().text_size(11).font_medium().text_color(t.unknown)
          .when(Boolean(p.agentMenu), (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { this.isMoveOpen = false; cx.notify(); }).child("‹"))
          .child(`Move ${addresses.length === 1 ? "to lead" : `${addresses.length} agents to`}`))
        .child(v_flex().id("move-targets").flex_1().min_h(0).overflow_y_scrollbar()
          .children(targets.flatMap((section) => [
            div().px(8).pt(6).pb(2).text_size(10.5).text_color(t.unknown).truncate().child(section.name),
            ...section.leads.map((l) => item({ id: `lead-${l.address}`, label: l.name, mark: crown(), isChecked: current === l.address, onPick: () => move(l.address) })),
          ])))
        .child(div().my(4).h(1).bg(t.border))
        .child(item({ id: "no-lead", label: "No lead", mark: glyph("agent"), isMuted: true, isChecked: current === null, onPick: () => move(null) }));
    }
    return v_flex().id("agent-menu").w_full().p(4).bg(t.popover).text_size(12.5)
      .when(!lead, (el) => el.child(item({
        id: "move", label: "Move to lead", mark: crown(), trailing: "▸",
        onPick: (cx) => { this.isMoveOpen = true; cx.notify(); },
      })))
      .when(!lead, (el) => el.child(item({
        id: "make-lead", label: "Make lead", mark: crown(),
        onPick: () => { request({ kind: "promote", address: first.address }); close(); },
      })))
      .when(Boolean(lead), (el) => el.child(item({ id: "new-agent", label: "New agent under this lead", mark: glyph("plus"), onPick: () => { close(); this.openNewAgent({ lead }); } })))
      .when(Boolean(lead), (el) => el.child(item({ id: "stop", label: "Stop leading", mark: glyph("x"), onPick: () => { request({ kind: "stopLead", lead }); close(); } })))
      .when(addresses.length === 1, (el) => el.child(item({ id: "rename", label: "Rename", mark: glyph("pen"), onPick: () => { close(); this.openRename(first.address); } })))
      .child(div().my(4).h(1).bg(t.border))
      .child(item({ id: "pin", label: first.pinned ? "Unpin" : "Pin to the top", mark: glyph("pin"), onPick: () => { run("terminal.pin", { terminal: first.address, pinned: !first.pinned }); close(); } }));
  }

  // The rename box: the machine name box's look, one name field.
  initRename({ address }) {
    const model = readModel({ isCollapsed: false });
    const a = model.list.find((x) => x.address === address);
    this.nameInput = InputState.new({ placeholder: a ? model.autoWords(a) : "Name" });
    this.nameInput.set_value(model.labelsOf.get(address)?.[AGENT_NAME_LABEL] ?? "");
    this.nameInput.on("change", (_e, cx) => cx.notify());
    this.nameInput.on("submit", () => this.handleRename());
    this.nameInput.focus();
  }

  // Empty name: its own title again.
  handleRename() {
    request({ kind: "rename", address: props().renameAgent.address, name: this.nameInput.value() });
    closeOverlay(props().overlay);
  }

  // A small box's footer: a hint, Cancel and the main button (off until it can run).
  boxFooter(t, { hint, label, isReady = true, onSave }) {
    return h_flex().mt(2).gap(6).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.dim).child(hint))
      .child(div().id("box-cancel").h(24).px(9).flex().items_center().rounded(6).text_size(12).text_color(t.dim)
        .cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(() => closeOverlay(props().overlay)).child("Cancel"))
      .child(div().id("box-save").h(24).px(10).flex().items_center().rounded(6).text_size(12).font_medium()
        .bg(t.solid).text_color(t.solid_foreground).opacity(isReady ? 1 : 0.5)
        .when(isReady, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(() => onSave()))
        .child(label));
  }

  field(t, { label, hint, input, isFocused = true }) {
    return v_flex().gap(4)
      .child(h_flex().justify_between().text_size(10.5).text_color(t.dim).child(label).child(hint))
      .child(h_flex().h(26).px(8).items_center().rounded(6).border(1).border_color(isFocused ? t.accent : t.border).bg(t.background).on_mouse_down("left", stop)
        .child(Input.new(input).flex_1().text_size(12.5).text_color(t.foreground)));
  }

  renderRename(t) {
    const { address } = props().renameAgent;
    return v_flex().id("rename-agent").size_full().p(10).gap(9).bg(t.popover).text_size(12.5)
      .child(this.field(t, { label: "Agent name", hint: address, input: this.nameInput }))
      .child(this.boxFooter(t, { hint: "↵ save · empty: its own title", label: "Save", onSave: () => this.handleRename() }));
  }

  // The new agent box: its name (needed) and a first task (optional).
  initNewAgent() {
    this.nameInput = InputState.new({ placeholder: "Checkout bug" });
    this.taskInput = InputState.new({ placeholder: "Optional: what it does first" });
    this.nameInput.on("change", (_e, cx) => cx.notify());
    this.nameInput.on("submit", () => this.handleNewAgent());
    this.taskInput.on("submit", () => this.handleNewAgent());
    this.nameInput.on("focus", (_e, cx) => { this.isTaskFocused = false; cx.notify(); });
    this.taskInput.on("focus", (_e, cx) => { this.isTaskFocused = true; cx.notify(); });
    this.nameInput.focus();
  }

  handleNewAgent() {
    const name = this.nameInput.value().trim();
    if (!name) return;
    const { lead, space, machine } = props().newAgent;
    request({ kind: "newAgent", lead, space, machine, name, task: this.taskInput.value().trim() });
    closeOverlay(props().overlay);
  }

  renderNewAgent(t) {
    const { space, machine, leadName } = props().newAgent;
    const isMachine = machine !== null && machine !== undefined;
    const spaceName = spaces().find((s) => s.id === space)?.name ?? "";
    return v_flex().id("new-agent").size_full().p(10).gap(9).bg(t.popover).text_size(12.5)
      .child(h_flex().gap(6).items_center().text_size(11.5).text_color(t.dim)
        .child(this.agentIcon(t, { isLead: Boolean(leadName) }))
        .child(div().min_w(0).truncate().child(leadName ? `New agent under ${leadName}` : isMachine ? `New Claude session on ${machineName(machine || null)}` : `New agent in ${spaceName}`)))
      .child(this.field(t, { label: "Name", hint: "needed", input: this.nameInput, isFocused: !this.isTaskFocused }))
      .child(this.field(t, { label: "First task", hint: "optional", input: this.taskInput, isFocused: Boolean(this.isTaskFocused) }))
      .child(this.boxFooter(t, { hint: isMachine ? "A new space with Claude on that machine" : `New Claude tab in ${spaceName}`, label: "Start", isReady: Boolean(this.nameInput.value().trim()), onSave: () => this.handleNewAgent() }));
  }

  initCreate({ space }) {
    // Empty name: the space's name and "lead".
    this.defaultName = `${spaces().find((s) => s.id === space)?.name ?? ""} lead`.trim();
    this.nameInput = InputState.new({ placeholder: this.defaultName });
    this.nameInput.on("change", (_e, cx) => cx.notify());
    this.nameInput.on("submit", () => this.handleCreate());
    this.nameInput.focus();
  }

  handleCreate() {
    const p = props();
    const name = this.nameInput.value().trim() || this.defaultName;
    if (!name) return;
    request({ kind: "createLead", space: p.createLead.space, name, followers: p.createLead.followers });
    closeOverlay(p.overlay);
  }

  // The Create lead box: name, the agents it follows, the command it runs.
  renderCreate(t) {
    const p = props();
    const { space, followers } = p.createLead;
    const s = spaces().find((x) => x.id === space);
    const model = readModel({ isCollapsed: false });
    const name = this.nameInput.value().trim() || this.defaultName;
    const follows = followers.map((f) => model.list.find((a) => a.address === f)).filter(Boolean);
    const label = (text, hint) => h_flex().justify_between().text_size(11).text_color(t.dim).child(text).child(hint);
    return v_flex().id("create-lead").size_full().bg(t.popover).text_size(12.5)
      .child(h_flex().px(12).py(10).gap(8).items_center().border_b(1).border_color(t.border)
        .child(svg(icon("crown")).size(14).text_color(t.ansi3))
        .child(div().font_semibold().text_color(t.foreground).child("Create lead"))
        .child(div().flex_1().truncate().text_size(11.5).text_color(t.dim).child(`in ${s?.name ?? "?"} · ${s?.machine ?? "this computer"}`)))
      .child(v_flex().flex_1().min_h(0).px(12).py(10).gap(10)
        .child(v_flex().gap(4)
          .child(label("Name", "shown in the sidebar"))
          .child(h_flex().h(28).px(8).items_center().rounded(6).border(1).border_color(t.ansi5).bg(t.background).on_mouse_down("left", stop)
            .child(Input.new(this.nameInput).flex_1().text_size(12.5).text_color(t.foreground))))
        .child(v_flex().gap(4).flex_1().min_h(0)
          .child(label("Follows", `${follows.length} ${follows.length === 1 ? "agent" : "agents"}`))
          .child(v_flex().id("create-follows").flex_1().min_h(0).overflow_y_scrollbar().gap(1)
            .children(follows.map((a) => h_flex().h(22).gap(8).items_center()
              .child(this.agentIcon(t, {}))
              .child(div().flex_1().truncate().text_color(t.muted).child(model.words(a)))))))
        .child(h_flex().px(8).py(6).gap(8).items_center().rounded(6).bg(t.chrome).border(1).border_color(t.border)
          .font_family(MONO_FONT).text_size(11.5).text_color(t.muted)
          .child(div().flex_1().truncate().child(getLeadPrompt({ name, followers, machine: s?.machine ?? null })))))
      .child(h_flex().px(12).py(10).gap(6).items_center().border_t(1).border_color(t.border)
        .child(div().flex_1().text_size(11).text_color(t.dim).child("New Claude tab"))
        .child(div().id("create-cancel").h(26).px(10).flex().items_center().rounded(6).text_size(12).text_color(t.dim)
          .cursor_pointer().hover((x) => x.text_color(t.foreground)).on_click(() => closeOverlay(p.overlay)).child("Cancel"))
        .child(h_flex().id("create-start").h(26).px(10).gap(5).items_center().rounded(6).text_size(12).font_semibold()
          .bg(t.ansi5).text_color(t.background).cursor_pointer().hover((x) => x.opacity(0.88))
          .on_click(() => this.handleCreate())
          .child(svg(icon("crown")).size(12)).child("Create lead ↵")));
  }

  // ── The list ──

  // The view button's box, from its mouse down: the view menu opens under it.
  openViewMenu() {
    const box = this.viewAnchor;
    const at = box ? { x: Math.max(0, box.left + box.width - VIEW_MENU_BOX.width), y: box.top + box.height + 4 } : "pointer";
    openOverlay({ mod: "gh44-agents", kind: "popup", ...VIEW_MENU_BOX, at, props: { viewMenu: true } });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    if (p.createLead) return this.renderCreate(t);
    if (p.renameAgent) return this.renderRename(t);
    if (p.newAgent) return this.renderNewAgent(t);
    if (p.viewMenu) return this.renderViewMenu(t);
    if (p.agentMenu || p.moveMenu) return this.renderMenu(t);
    const collapsed = narrow();
    const layoutId = getAgentsLayout(shared(AGENTS_LAYOUT_STORE));
    const model = readModel({ isCollapsed: collapsed });
    this.model = model;
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(model.list, now);
    const listed = new Set(model.list.map((a) => a.address));
    if (this.selection.selected.some((a) => !listed.has(a))) this.selection = { ...this.selection, selected: this.selection.selected.filter((a) => listed.has(a)) };
    // By status walks the stock priority order: most recently changed first.
    const byRecent = layoutId === "status" ? [...model.list].sort((x, y) => this.since(y) - this.since(x) || y.seq - x.seq) : model.list;
    const machines = [null, ...new Set(spaces().map((s) => s.machine).filter(Boolean))].map((m) => ({ id: m, name: machineName(m) }));
    const { groups, order } = groupAgents({
      agents: byRecent, layout: layoutId, leads: model.leads, pendingAgents: model.pendingAgents, machines,
      spaces: spaces().map((s) => ({ id: s.id, name: s.name, machine: s.machine ?? null, parent: (shared(PARENTS_STORE) ?? {})[s.id] ?? null })),
    });
    setAgentOrder(order);
    const byAddress = new Map(model.list.map((a) => [a.address, a]));
    // What a shift-click range walks: the shown agents, leads left out (a lead follows nobody).
    const leadAddresses = new Set(model.leads.map((l) => l.address));
    const shownSpaces = order.filter((address) => !leadAddresses.has(address)).map((address) => ({ address, space: byAddress.get(address)?.space ?? "" }));
    const ctx = { model, now, shown, shownSpaces };

    const compactRow = (a, i) => h_flex()
      .id(`ag-${a.address}`).h(26).mx(6).px(2).rounded(6).flex_none().items_center().gap(4)
      .when(a.focused, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(a.focused ? t.foreground : t.muted).child(String(i + 1)))
      .child(this.status(t, a));
    const rows = collapsed
      ? order.map((address, i) => compactRow(byAddress.get(address), i))
      : groups.flatMap((g) => this.groupTree(t, g, ctx));
    const viewLabel = AGENTS_LAYOUTS.find((l) => l.id === layoutId)?.label ?? "";

    return v_flex()
      .id("agents-root")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .on_window_mouse_move((e, cx) => this.handleWindowMove(e, cx))
      .on_window_mouse_up("left", (_e, cx) => this.handleWindowRelease(cx))
      .when(!collapsed, (el) => el.child(h_flex().pl(14).pr(10).pt(8).pb(4).flex_none().gap(8).items_center()
        .child(div().flex_none().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.unknown).child(`· ${viewLabel}`))
        .child(this.foldAllButton(t, groups))
        .child(div().id("view-button").size(22).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Group agents")
          .on_mouse_down("left", (e, cx) => {
            this.viewAnchor = e.local_position && e.bounds ? { left: e.position.x - e.local_position.x, top: e.position.y - e.local_position.y, width: e.bounds.width, height: e.bounds.height } : null;
            cx.stop_propagation();
          })
          .on_click(() => this.openViewMenu())
          .child(svg(icon("view")).size(14)))))
      .when(model.list.length === 0 && !collapsed, (el) =>
        el.child(div().px(16).pt(6).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")))
      .child(v_flex().id("ag-list").flex_1().min_h(0).pt(2).pb(10).overflow_y_scrollbar().mode("always").children(rows))
      .when(!collapsed && this.selection.selected.length > 0, (el) => el.child(this.selectionBar(t, model)))
      .when(collapsed, (el) => el.child(h_flex().h(28).items_center().justify_center()
        .child(div().id("collapse").text_size(13).text_color(t.dim).hover((s) => s.text_color(t.foreground)).on_click(toggleSidebar).child("»"))));
  }
}

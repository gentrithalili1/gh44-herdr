// Omnia spaces: Herdr's spaces list (copied from its `spaces` mod, then changed) in the gh44 look.
// A header per machine (click folds it; its pen names it); a space row is its
// color tile, its name, a small crown when it has leads, how far behind its branch is, a ! when
// an agent needs you and how many agents it has. Worktrees sit under their checkout. Click to
// switch; click the shown space's name, its pen or right-click › Rename for the name and color
// box; drag to reorder within a machine.
// One mod, four copies: the list, the name and color box (props().edit), the machine name box
// (props().machineEdit) and the space menu (props().spaceMenu).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle, InputState, Input } from "gpui-base";
import { spaces, machines, panes, agents, terminals, run, openOverlay, closeOverlay, props, exec, hc, theme, settings, shared, setShared, watchFolder, window, layout } from "herdr";
import { getSpaceMove, getDropEdge, getWorktreeParents } from "./spaceOrder.js";
import { getSpaceSummaries } from "./spaceSummary.js";
import { HUES, getNewSpaceColor, getHueFill } from "./spaceColors.js";
import { MACHINE_NAMES_STORE, getMachineLabel, setMachineName } from "./machineNames.js";

const COLORS_STORE = "space.colors";
// Each space's tile color as drawn here, for the gh44-agents mod.
const FILLS_STORE = "omnia.space.fills";
// Each space's repo (its git folder) once git answered, for the gh44-agents mod's Move to: a
// checkout and its worktrees share one.
const REPOS_STORE = "omnia.space.repos";
// Each worktree space's main checkout space, for the gh44-agents mod to nest it under (spaceOrder.js getWorktreeParents).
const PARENTS_STORE = "omnia.space.parents";
const MONO_FONT = "Lilex";
const icon = (name) => `mods/gh44-spaces/icons/${name}.svg`;
const chromeIcon = (name) => `mods/workspace-chrome/${name}.svg`;
const EDIT_BOX = { width: 272, height: 188 };
const MACHINE_EDIT_BOX = { width: 272, height: 112 };
const MENU_BOX = { width: 208, height: 200 };
// Its tile color, from shared("space.colors"); a space not listed yet gets the first hue.
// a mixed into b by w (0..1), for #rrggbb colours; anything else comes back as a.
const mixHex = (a, b, w) => {
  const hex = /^#([0-9a-f]{6})/i;
  const [ma, mb] = [hex.exec(a ?? ""), hex.exec(b ?? "")];
  if (!ma || !mb) return a;
  const ch = (m, i) => parseInt(m[1].slice(i, i + 2), 16);
  return `#${[0, 2, 4].map((i) => Math.round(ch(ma, i) * w + ch(mb, i) * (1 - w)).toString(16).padStart(2, "0")).join("")}`;
};
// A worktree row's tree line: down from its main space's tile, a rounded elbow into its branch icon,
// in the main space's colour mixed solid into the sidebar (as the agents list draws its lines).
const TREE_LINE_X = 35;
const TREE_LINE_W = 1.5;
const TREE_ELBOW_W = 8;
const TREE_RADIUS = 7;
const TREE_MID = 12;
const TREE_REACH = 5; // up into the gap under the main space's tile
const TREE_MIX = 0.55;
const fillOf = (w, t) => getHueFill({ color: (shared(COLORS_STORE) ?? {})[w.id] ?? HUES[0].id, t, isDark: settings().dark !== false }) ?? t.dim;
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

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const RAIL_CELL = 32;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// A repo's name from its git folder: the folder holding .git, a bare repo's own
// name, or the folder holding a hidden bare repo (<project>/.bare).
const repoName = (common) => {
  if (common.endsWith("/.git")) return base(common.slice(0, -5));
  const own = base(common);
  return own === ".bare" ? base(common.slice(0, -own.length - 1)) : own.replace(/\.git$/, "");
};
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
// Places looked at together (two git runs each). All at once, a few hundred spaces
// run out of the app's open files (256 when started from the Dock on macOS) or
// past a machine core's 16 running execs, and those spaces wait for FALLBACK.
const AT_ONCE = 6;

// Both runs, finished: a place isn't done while one of its runs still holds a slot.
async function both(a, b) {
  const done = await Promise.allSettled([a, b]);
  const failed = done.find((d) => d.status === "rejected");
  if (failed) throw failed.reason;
  return done.map((d) => d.value);
}

// Keep the whole leading emoji in the avatar (same rule in spaces and picker).
// Newer pictographs such as 🖥 may be drawn as emoji without VS16. A trailing
// selector, modifier or joiner can signal that we matched only part of a glyph.
const EMOJI = /^(?:[#*0-9]\uFE0F?\u20E3|\p{Regional_Indicator}{2}|(?:\p{Emoji_Presentation}|(?=[\u{1F000}-\u{1FFFF}])\p{Extended_Pictographic}|\p{Extended_Pictographic}(?=\uFE0F)|\p{Emoji_Modifier_Base}(?=\p{Emoji_Modifier}))\uFE0F?[\p{Emoji_Modifier}\u{E0020}-\u{E007F}]*(?:\u200D\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?)*)(?![\p{Grapheme_Extend}\p{Emoji_Modifier}\u200D])/u;
function spaceAvatar(name) {
  return EMOJI.exec(name)?.[0] ?? ([...name][0]?.toUpperCase() ?? "?");
}

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.edit) return this.initEdit(p.edit);
    if (p.machineEdit) return this.initMachineEdit(p.machineEdit.machine);
    if (p.spaceMenu) return;
    this.hovered = null;
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Map(); // local repos' pending folder watches
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.scroll = ScrollHandle.new(); // the list's position: the active space is brought into view through it
    this.activeAt = -1; // the active space's place among the list's children (headers and rows), -1 when not drawn
    this.machines = [];
    try {
      this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
      if (!this.reconnecting || typeof this.reconnecting !== "object" || Array.isArray(this.reconnecting)) this.reconnecting = {};
      for (const state of Object.values(this.reconnecting)) state.busy = false;
    } catch { this.reconnecting = {}; }
    try { this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]")); } catch { this.folded = new Set(); }
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // Refresh only when the refs could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    for (const k of Object.keys(this.git)) if (!keys.has(k)) {
      delete this.git[k];
      delete this.checked[k];
      this.unsure.delete(k);
    }
    const repos = new Set(Object.values(this.git).filter(Boolean).map((g) => g.repo));
    for (const [repo, pending] of this.watching) if (!repos.has(JSON.stringify([null, repo]))) {
      this.watching.delete(repo);
      pending.cancel();
    }
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, keys.length) }, async () => {
          while (next < keys.length) await this.check(keys[next++], cx);
        }));
      }
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // Ref-only reads avoid scanning the worktree or waking its index watch.
      // Two reads: a folder name may itself contain a newline.
      const [r, common] = await both(
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      );
      if (r.code !== 0 || common.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) {
          this.unsure.add(key);
          this.git[key] ??= null;
        } else this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      const [branch, counts] = await both(
        exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on }),
      );
      const name = repoName(repo);
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      const info = { name, branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "(detached)", ahead, behind, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    const pending = watchFolder(repo);
    this.watching.set(repo, pending);
    cx.spawn(async (cx) => {
      let current = pending;
      try {
        for (;;) {
          await current;
          if (this.watching.get(repo) !== current) return;
          const mine = JSON.stringify([null, repo]);
          const keys = Object.keys(this.git).filter((k) => this.git[k]?.repo === mine);
          if (!keys.length) break;
          this.refreshGit(keys, cx);
          current = watchFolder(repo);
          this.watching.set(repo, current);
        }
      } catch {}
      if (this.watching.get(repo) === current) this.watching.delete(repo);
    });
  }

  // A popup is as tall as its items; height is only the most.
  menu(w) {
    const g = this.git[where(w, panes())] ?? null;
    openOverlay({ mod: "gh44-spaces", kind: "popup", ...MENU_BOX, props: { spaceMenu: { id: w.id, isRepo: Boolean(g), isWorktree: Boolean(g?.linked) } } });
  }

  openEdit(w) {
    openOverlay({ mod: "gh44-spaces", kind: "popup", ...EDIT_BOX, props: { edit: w.id } });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // The rows, under a section per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.ordered();
    const summaries = getSpaceSummaries({ agents: agents(), terminals: terminals() });
    const order = spaces().map((s) => ({ id: s.id, machine: s.machine ?? null }));
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row({ ...r, summary: summaries.get(r.w.id) ?? null, order }, t));
    // Where the active space's row lands among the children this returns: the list scrolls by its direct
    // children, and machine headers, login notes and loading rows count too.
    this.activeAt = -1;
    let before = 0;
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 16).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length && collapsed) {
      if (loading(null) && !rows.length) return [loadingRow(null)];
      this.activeAt = rows.findIndex(r => r.w.active);
      return rows.map(draw);
    }
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const folded = this.folded.has(m);
      const machineIcon = svg(icon(m ? "server" : "laptop")).size(13).flex_none().text_color(t.dim);
      const label = getMachineLabel({ names: shared(MACHINE_NAMES_STORE), machine: m });
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const isHeadHovered = this.hoveredMachine === (m ?? "");
      // A machine's header: fold chevron, its icon, its name (the address beside a given name),
      // connected dot; on hover a pen that names it and a + for a new space there. Click folds.
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).mt(2).flex_none().px(collapsed ? 0 : 8).pl(collapsed ? 0 : 10).gap(7).items_center().rounded(6)
        .text_size(12).text_color(t.muted)
        .when(collapsed, el => el.w(RAIL_CELL).justify_center().hover(s => s.bg(t.hover)).tooltip(login ? `${m} needs a login: run ${login}. Click for Copy.` : m ? `${label.name} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : label.name))
        .when(!collapsed, el => el.hover(s => s.bg(t.hover)))
        .cursor_pointer()
        .on_hover((hovered, cx) => {
          if (hovered) this.hoveredMachine = m ?? "";
          else if (this.hoveredMachine === (m ?? "")) this.hoveredMachine = null;
          cx.notify();
        })
        .on_click((_e, cx) => {
          if (collapsed && login) { run("app.settings", { section: "machines" }); return; }
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(machine?.keeps_running_after_logout === false, el => el.child(div().id(`machine-logout-${m}`)
          .flex_none().text_color(t.blocked).tooltip("Agents stop when you disconnect. Click for the fix.")
          .on_click((_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "machine-add", kind: "dialog", width: 560 }); }).child("⚠")))
        .when(collapsed, el => el.child(div().relative().flex_none().child(machineIcon).when(Boolean(m), el => el.child(badge))))
        .when(!collapsed, el => el
          .child(svg(icon(folded ? "chevron-right" : "chevron")).size(12).flex_none().text_color(t.unknown))
          .child(machineIcon)
          .child(div().flex_initial().min_w(0).truncate().font_semibold().child(label.name))
          .when(Boolean(label.host), el => el.child(div().flex_none().max_w(110).truncate().font_family(MONO_FONT).text_size(11).text_color(t.unknown).child(label.host ?? "")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.unknown))
          .when(!connected && !rebuilt && !login, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(120).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .child(div().flex_1())
          .when(isHeadHovered, el => el.child(div().id(`machine-rename-${m ?? "local"}`).size(22).flex_none().flex().items_center().justify_center().rounded(5)
            .text_color(t.dim).tooltip("Rename machine").hover(s => s.bg(t.raised).text_color(t.foreground))
            .on_mouse_down("left", stop)
            .on_click((_e, cx) => { cx.stop_propagation(); this.openMachineEdit(m); })
            .child(svg(icon("pen")).size(12))))
          .when(isHeadHovered, el => el.child(div().id(`machine-space-new-${m ?? "local"}`).size(22).flex_none().flex().items_center().justify_center().rounded(5)
            .text_color(t.dim).tooltip(`New space on ${label.name}`).hover(s => s.bg(t.raised).text_color(t.foreground))
            .on_mouse_down("left", stop)
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); })
            .child(svg(chromeIcon("plus")).size(13)))));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 28).gap(7).items_center().rounded(6)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .when(collapsed, el => el.w(RAIL_CELL).rounded(6).justify_center().tooltip(`New space on ${m ?? "this computer"}`)
          .child(h_flex().size(18).rounded(5).border_1().border_color(t.dim).items_center().justify_center()
            .child(svg(chromeIcon("plus")).size(10))))
        .when(!collapsed, el => el.child(svg(chromeIcon("plus")).size(12)).child("New space there"));
      if (!collapsed && rebuilt) { before += 1; return [head]; }
      const cell = collapsed ? railCell : (el) => el;
      const guidance = !collapsed && login ? [v_flex().px(16).pb(6).gap(3).flex_none()
        .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
          .child(div().id(`machine-login-copy-${m}`).flex_none().px(5).py(2).rounded(4)
            .text_size(11).text_color(t.foreground).bg(t.raised).cursor_pointer().hover(s => s.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); })
            .child(this.copiedLogin === login ? "Copied" : "Copy")))] : [];
      const items = [cell(head), ...guidance, ...(folded ? [] : mine.length ? mine.map(draw) : [loading(m) ? loadingRow(m) : cell(empty)])];
      const first = folded ? -1 : mine.findIndex(r => r.w.active);
      if (first >= 0) this.activeAt = before + 1 + guidance.length + first;
      before += items.length;
      return items;
    });
  }

  // A row's end: a small crown when the space has leads, how far behind its branch is, a ! when an
  // agent needs you, and how many agents it has.
  meta({ g, tree, summary }, t) {
    const behind = g?.behind > 0 ? g.behind : 0;
    return h_flex().flex_none().gap(7).items_center()
      .when(!tree && (summary?.leadCount ?? 0) > 0, (el) => el.child(svg(icon("crown")).size(12).flex_none().text_color(t.ansi3)
        .tooltip(summary.leadCount === 1 ? "1 lead" : `${summary.leadCount} leads`)))
      .when(behind > 0, (el) => el.child(div().flex_none().font_family(MONO_FONT).text_size(11).text_color(t.blocked).tooltip(`${behind} behind its upstream`).child(`\u2193${behind}`)))
      .when(Boolean(summary?.isBlocked), (el) => el.child(this.bang(t)))
      .when((summary?.total ?? 0) > 0, (el) => el.child(div().flex_none().font_family(MONO_FONT).text_size(11).text_color(t.dim).child(String(summary.total))));
  }

  bang(t) {
    return div().size(14).flex_none().flex().items_center().justify_center().rounded(4).bg(`${t.blocked}2B`)
      .text_size(10).font_bold().text_color(t.blocked).child("!");
  }

  // On hover, in place of the meta: Rename and the space's menu.
  actions(w, t) {
    const button = ({ id, name, tip, onClick }) => div().id(`${id}-${w.id}`).size(20).flex_none().flex().items_center().justify_center().rounded(5)
      .text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.raised).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(); })
      .child(svg(icon(name)).size(12));
    return h_flex().flex_none().gap(1).items_center()
      .child(button({ id: "space-rename", name: "pen", tip: "Rename and color", onClick: () => this.openEdit(w) }))
      .child(button({ id: "space-more", name: "dots", tip: "More", onClick: () => this.menu(w) }));
  }

  row({ w, g, tree, summary, order }, t) {
    const isOn = w.active;
    const isDragging = this.pressed !== null;
    const isHovered = this.hovered === w.id && !isDragging;
    const edge = isDragging && this.over === w.id ? getDropEdge({ spaces: order, from: this.pressed, to: w.id }) : null;
    const dropLine = div().absolute().left(tree ? 42 : 26).right(8).h(2).rounded(1).bg(t.accent)
      .when(edge === "top", (line) => line.top(-1))
      .when(edge === "bottom", (line) => line.bottom(-1))
      .child(div().absolute().left(-4).top(-3).size(8).rounded(4).border(2).border_color(t.accent).bg(t.chrome));
    const tile = h_flex().size(16).flex_none().rounded(4).bg(fillOf(w, t)).items_center().justify_center()
      .text_size(9.5).font_bold().text_color(t.background).child(spaceAvatar(w.name));
    return h_flex()
      .relative()
      .id(`space-${w.id}`)
      .h(tree ? 24 : 26)
      .flex_none()
      .pl(tree ? 46 : 28)
      .pr(10)
      .gap(tree ? 7 : 9)
      .items_center()
      .rounded(6)
      .when(isOn, (el) => el.bg(t.selected))
      .when(!isOn, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(edge !== null, (el) => el.child(dropLine))
      .on_hover((hovered, cx) => {
        if (hovered) this.hovered = w.id;
        else if (this.hovered === w.id) this.hovered = null;
        // Off the row: a release now drops nowhere.
        if (!hovered && this.over === w.id) this.over = null;
        cx.notify();
      })
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = w.id;
      })
      .on_mouse_move((_e, cx) => {
        if (this.pressed === null) return;
        const over = this.pressed === w.id || getDropEdge({ spaces: order, from: this.pressed, to: w.id }) ? w.id : null;
        if (this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_down("right", () => this.menu(w))
      .when(isHovered && !tree, (el) => el.child(div().absolute().left(12).top(7).text_color(t.unknown).child(svg(icon("grip")).size(12))))
      .when(Boolean(tree), (el) => {
        const main = spaces().find((s) => s.id === (shared(PARENTS_STORE) ?? {})[w.id]);
        const line = mixHex(main ? fillOf(main, t) : t.unknown, t.chrome, TREE_MIX);
        return el
          .when(tree === "├─", (e) => e.child(div().absolute().left(TREE_LINE_X).top(-TREE_REACH).bottom(0).w(TREE_LINE_W).bg(line)))
          .child(div().absolute().left(TREE_LINE_X).top(-TREE_REACH).w(TREE_ELBOW_W + TREE_LINE_W).h(TREE_MID + TREE_REACH)
            .border_l(TREE_LINE_W).border_b(TREE_LINE_W).border_color(line).rounded_bl(TREE_RADIUS));
      })
      .child(tree ? svg(chromeIcon("branch")).size(12).flex_none().text_color(fillOf(w, t)) : tile)
      .child(div().id(`space-name-${w.id}`).flex_1().min_w(0).truncate()
        .when(tree, (el) => el.text_size(11.5).text_color(isOn ? t.foreground : t.dim))
        .when(!tree, (el) => el.text_color(t.foreground).font_medium())
        .when(isOn, (el) => el.tooltip("Click to rename"))
        .on_mouse_down("left", () => { this.nameDown = w.id; })
        .child(w.name))
      .child(isHovered ? this.actions(w, t) : this.meta({ g, tree, summary }, t));
  }

  // The left button's release anywhere in the window (so a drag let go outside the list ends too).
  // Over another row of its machine: the pressed space moves there. Over its own row: a click,
  // which selects it, or on the shown space's name opens the name and color box.
  handleRelease(cx) {
    const from = this.pressed;
    const over = this.over;
    const isName = this.nameDown !== null && this.nameDown === over;
    this.pressed = null;
    this.over = null;
    this.nameDown = null;
    if (from === null) return;
    const order = spaces().map((s) => ({ id: s.id, machine: s.machine ?? null }));
    const w = spaces().find((s) => s.id === over);
    if (!w) {
      cx.notify();
      return;
    }
    if (from !== w.id) {
      const move = getSpaceMove({ spaces: order, from, to: w.id });
      if (move.status === "move") run("space.move", { id: move.id, index: move.index });
    } else {
      if (isName && w.active) this.openEdit(w);
      else run("space.select", { id: w.id });
    }
    cx.notify();
  }

  compact({ w, i }, t) {
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .relative()
      .w(RAIL_CELL)
      .h(26)
      .rounded(6)
      .justify_center()
      .items_center()
      .when(w.active, (el) => el.bg(t.selected))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().absolute().right(5).text_color(tone(t, w.status)).child(glyph(w.status))));
  }

  // The name and color box.
  initEdit(id) {
    const w = spaces().find((s) => s.id === id);
    this.color = (shared(COLORS_STORE) ?? {})[id] ?? HUES[0].id;
    this.nameInput = InputState.new({ placeholder: w && !w.named ? w.name : "Name" });
    this.nameInput.set_value(w?.named ? w.name : "");
    this.nameInput.on("change", (_e, cx) => cx.notify());
    this.nameInput.on("submit", () => this.handleSave());
    this.nameInput.focus();
  }

  openMachineEdit(machine) {
    openOverlay({ mod: "gh44-spaces", kind: "popup", ...MACHINE_EDIT_BOX, props: { machineEdit: { machine } } });
  }

  // The machine name box: the space box's look with only its name field.
  initMachineEdit(machine) {
    const label = getMachineLabel({ names: shared(MACHINE_NAMES_STORE), machine });
    this.nameInput = InputState.new({ placeholder: machine ?? "This computer" });
    this.nameInput.set_value(label.host ? label.name : "");
    this.nameInput.on("change", (_e, cx) => cx.notify());
    this.nameInput.on("submit", () => this.handleMachineSave());
    this.nameInput.focus();
  }

  // Empty name: the machine's own name again.
  handleMachineSave() {
    const { machine } = props().machineEdit;
    setShared(MACHINE_NAMES_STORE, setMachineName({ names: shared(MACHINE_NAMES_STORE), machine, name: this.nameInput.value() }));
    closeOverlay(props().overlay);
  }

  renderMachineEdit(t) {
    const { machine } = props().machineEdit;
    return v_flex().id("machine-edit").size_full().p(10).gap(9).bg(t.popover).text_size(12.5)
      .child(v_flex().gap(4)
        .child(h_flex().justify_between().text_size(10.5).text_color(t.dim).child("Machine name").child(machine ?? "this computer"))
        .child(h_flex().h(26).px(8).items_center().rounded(6).border(1).border_color(t.accent).bg(t.background).on_mouse_down("left", stop)
          .child(Input.new(this.nameInput).flex_1().text_size(12.5).font_semibold().text_color(t.foreground))))
      .child(h_flex().mt(2).gap(6).items_center()
        .child(div().flex_1().text_size(10.5).text_color(t.dim).child("↵ save · empty: its own name"))
        .child(div().id("machine-edit-cancel").h(24).px(9).flex().items_center().rounded(6).text_size(12).text_color(t.dim)
          .cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(() => closeOverlay(props().overlay)).child("Cancel"))
        .child(div().id("machine-edit-save").h(24).px(10).flex().items_center().rounded(6).text_size(12).font_medium()
          .bg(t.solid).text_color(t.solid_foreground).cursor_pointer().hover((s) => s.opacity(0.88))
          .on_click(() => this.handleMachineSave()).child("Save")));
  }

  // Empty name: Herdr's automatic name again.
  handleSave() {
    const w = spaces().find((s) => s.id === props().edit);
    if (w) {
      const name = this.nameInput.value().trim();
      if (name !== (w.named ? w.name : "")) run("space.rename", { id: w.id, name });
      const colors = shared(COLORS_STORE) ?? {};
      if (colors[w.id] !== this.color) setShared(COLORS_STORE, { ...colors, [w.id]: this.color });
    }
    closeOverlay(props().overlay);
  }

  renderEdit(t) {
    const w = spaces().find((s) => s.id === props().edit);
    const typed = this.nameInput.value().trim();
    const initial = spaceAvatar(typed || w?.name || "?");
    const label = (text, hint) => h_flex().justify_between().text_size(10.5).text_color(t.dim).child(text).child(hint);
    return v_flex().id("space-edit").size_full().p(10).gap(9).bg(t.popover).text_size(12.5)
      .child(v_flex().gap(4)
        .child(label("Name", w?.named ? "empty: auto name" : "auto name now"))
        .child(h_flex().h(26).px(8).items_center().rounded(6).border(1).border_color(t.ansi5).bg(t.background).on_mouse_down("left", stop)
          .child(Input.new(this.nameInput).flex_1().text_size(12.5).font_medium().text_color(t.foreground))))
      .child(v_flex().gap(4)
        .child(label("Color", HUES.find((h) => h.id === this.color)?.label ?? ""))
        .child(h_flex().gap(6).children(HUES.map((h) => {
          const isPicked = h.id === this.color;
          return div().id(`hue-${h.label}`).size(22).flex_none().rounded(6).p(isPicked ? 2 : 0).border(isPicked ? 1.5 : 0).border_color(t.foreground)
            .cursor_pointer().tooltip(h.label)
            .on_click((_e, cx) => { this.color = h.id; cx.notify(); })
            .child(h_flex().size_full().rounded(4).items_center().justify_center()
              .bg(getHueFill({ color: h.id, t, isDark: settings().dark !== false }) ?? t.dim)
              .text_size(10).font_bold().text_color(t.background).child(initial));
        }))))
      .child(h_flex().mt(2).gap(6).items_center()
        .child(div().flex_1().text_size(10.5).text_color(t.dim).child("↵ save · esc cancel"))
        .child(div().id("space-edit-cancel").h(24).px(9).flex().items_center().rounded(6).text_size(12).text_color(t.dim)
          .cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(() => closeOverlay(props().overlay)).child("Cancel"))
        .child(div().id("space-edit-save").h(24).px(10).flex().items_center().rounded(6).text_size(12).font_medium()
          .bg(t.solid).text_color(t.solid_foreground).cursor_pointer().hover((s) => s.opacity(0.88))
          .on_click(() => this.handleSave()).child("Save")));
  }

  // The space's menu: the name and color box, a new tab, its worktrees, close.
  renderMenu(t) {
    const { id, isRepo, isWorktree } = props().spaceMenu;
    const w = spaces().find((s) => s.id === id);
    const worktree = (action) => openOverlay({ mod: "worktree", kind: "dialog", ...(action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: { space: id, action } });
    const items = [
      { id: "rename", label: "Rename and color", iconPath: icon("pen"), onPick: () => w && this.openEdit(w) },
      { id: "tab", label: "New tab", iconPath: chromeIcon("plus"), onPick: () => run("tab.new", { space: id }) },
      ...(isRepo ? [
        { id: "worktree-new", label: "New worktree", iconPath: chromeIcon("git-branch"), onPick: () => worktree("new") },
        { id: "worktree-open", label: "Open worktree", iconPath: chromeIcon("git-branch"), onPick: () => worktree("open") },
      ] : []),
      ...(isWorktree ? [{ id: "worktree-remove", label: "Remove worktree", iconPath: chromeIcon("git-branch"), onPick: () => worktree("remove") }] : []),
      { id: "close", label: "Close", iconPath: chromeIcon("x"), onPick: () => run("space.close", { id }), isApart: true },
    ];
    return v_flex().id("space-menu").w_full().p(5).bg(t.popover).text_size(12.8)
      .children(items.map((it) => v_flex()
        .when(Boolean(it.isApart), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex().id(`space-menu-${it.id}`).h(30).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
          .cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click(() => { closeOverlay(props().overlay); it.onPick(); })
          .child(svg(it.iconPath).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().child(it.label)))));
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    if (p.edit) return this.renderEdit(t);
    if (p.machineEdit) return this.renderMachineEdit(t);
    if (p.spaceMenu) return this.renderMenu(t);
    const collapsed = narrow();
    const sp = spaces();
    const ids = new Set(sp.map(s => s.id));
    const saved = shared(COLORS_STORE) ?? {};
    const kept = Object.fromEntries(Object.entries(saved).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(saved).length;
    for (const s of sp) {
      if (kept[s.id] || s.name === "~") continue;
      kept[s.id] = getNewSpaceColor({ used: Object.values(kept) });
      changed = true;
    }
    if (changed) setShared(COLORS_STORE, kept);
    // The agents list tints its icons in these: mods can't import each other's files.
    const fills = Object.fromEntries(sp.map((s) => [s.id, fillOf(s, t)]));
    if (JSON.stringify(fills) !== JSON.stringify(shared(FILLS_STORE) ?? {})) setShared(FILLS_STORE, fills);
    const ps = panes();
    const repos = Object.fromEntries(sp.map((s) => [s.id, this.git[where(s, ps)]?.repo]).filter(([, repo]) => repo));
    if (JSON.stringify(repos) !== JSON.stringify(shared(REPOS_STORE) ?? {})) setShared(REPOS_STORE, repos);
    const parents = getWorktreeParents({ spaces: sp.map((s) => { const g = this.git[where(s, ps)]; return { id: s.id, repo: g?.repo ?? null, linked: Boolean(g?.linked) }; }) });
    if (JSON.stringify(parents) !== JSON.stringify(shared(PARENTS_STORE) ?? {})) setShared(PARENTS_STORE, parents);
    const list = this.grouped(t, collapsed);
    // Bring the active space into view when it, or its place in the list, changes; a row already in view stays put.
    const active = sp.find(s => s.active)?.id;
    if (active !== this.revealed || this.activeAt !== this.revealedAt) {
      this.revealed = active;
      this.revealedAt = this.activeAt;
      if (this.activeAt >= 0) this.scroll.scroll_to_item(this.activeAt);
    }
    return v_flex().id("spaces-root").size_full().min_h(0).bg(t.chrome).text_size(13)
      .on_window_mouse_up("left", (_e, cx) => this.handleRelease(cx))
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child("Spaces"))
        .child(div().id("space-new").size(24).flex_none().flex().items_center().justify_center().rounded(5).tooltip("New space").hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new")).child(svg(chromeIcon("plus")).size(13))))
      .child(v_flex().flex_1().min_h(0).px(collapsed ? 0 : 6).pb(14).overflow_y_scrollbar().mode("always").track_scroll(this.scroll)
        // A block above (another mod's) growing, or the window resizing, shrinks this list and can push the active space out.
        .on_size_change((_size, cx) => { if (this.activeAt >= 0) { this.scroll.scroll_to_item(this.activeAt); cx.notify(); } })
        .children(list));
  }
}

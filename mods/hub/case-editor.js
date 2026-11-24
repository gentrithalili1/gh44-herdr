// The settings' "By case" group: one expandable header per kind of row (a case) with its
// default, and under it the case's actions in order. Drag to reorder: the first checked one is
// the default the row's button runs; an unchecked one is left out of the case's menu. "Open in
// GitHub/Linear" first: the button opens the PR or ticket.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";
import { icon } from "./ui.js";
import { getDefaultSkill, setCaseHidden, moveCaseEntry, shortSkill, shortRepo, OPEN_ENTRY } from "./settings.js";

/** @typedef {import("./settings.js").Skills} Skills */
/** @typedef {import("./settings.js").Situation} Situation */

// The drop line sits in the 4px gap between entry rows: 3px out, 2px tall.
const DROP_LINE_OFFSET = -3;
const UNCHECKED_OPACITY = 0.45;
const OPEN_LABEL = { github: "Open in GitHub", linear: "Open in Linear", oncall: "Open the report" };

export class CaseEditor {
  /** @param {{ saveSkills: (params: { tab: "github" | "linear" | "oncall", skills: Skills }) => void }} host */
  constructor({ saveSkills }) {
    this.saveSkills = saveSkills;
    // "<tab>:<situation>" of the expanded case.
    /** @type {string | null} */
    this.openCaseId = null;
    // An entry being dragged by its grip, and where it lands: an index of the case's order.
    /** @type {{ caseId: string, entry: string, to: number | null } | null} */
    this.drag = null;
  }

  collapse() {
    this.openCaseId = null;
    this.drag = null;
  }

  /** @param {import("gpui-kit").Context} cx */
  cancelDrag(cx) {
    if (!this.drag) return;
    this.drag = null;
    cx.notify();
  }

  // Every case of a tab: its header, and the entry rows of the expanded one.
  /** @param {{ tab: "github" | "linear" | "oncall", situations: { id: Situation, label: string }[], skills: Skills }} params */
  rows({ tab, situations, skills }) {
    return situations.flatMap((situation) => this.caseRows({ tab, situation, skills }));
  }

  /** @param {{ tab: "github" | "linear" | "oncall", situation: { id: Situation, label: string }, skills: Skills }} params */
  caseRows({ tab, situation, skills }) {
    const t = theme();
    const caseId = `${tab}:${situation.id}`;
    const isOpen = this.openCaseId === caseId;
    const current = getDefaultSkill({ skills, tab, situation: situation.id });
    const header = h_flex().id(`case-${caseId}`).h(28).px(6).gap(8).items_center().rounded(6).cursor_pointer()
      .text_size(12.5).bg(isOpen ? t.hover : t.background).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.openCaseId = isOpen ? null : caseId; this.drag = null; cx.notify(); })
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(situation.label))
      .child(div().text_color(current ? t.foreground : t.dim).child(current ? shortSkill(current) : "open"))
      .child(svg(icon(isOpen ? "chevron-up" : "chevron")).size(12).text_color(t.muted));
    const c = skills[tab].cases[situation.id];
    if (!isOpen || !c) return [header];
    const hint = div().pl(24).pr(6).text_size(11).text_color(t.dim).child("Drag to order. The first checked one runs on the button.");
    const firstShown = c.order.find((name) => !c.hidden.includes(name));
    const entryRows = c.order.map((entry, index) => this.entryRow({
      tab, situation: situation.id, skills, caseId, entry, index, count: c.order.length,
      isShown: !c.hidden.includes(entry), isDefault: entry === firstShown,
    }));
    return [header, hint, v_flex().gap(4).children(entryRows)];
  }

  // ⠿ grip · checkbox · name · "default" on the first checked one. Unchecked: faded.
  /**
   * @param {{ tab: "github" | "linear" | "oncall", situation: Situation, skills: Skills, caseId: string, entry: string, index: number,
   *   count: number, isShown: boolean, isDefault: boolean }} params
   */
  entryRow({ tab, situation, skills, caseId, entry, index, count, isShown, isDefault }) {
    const t = theme();
    const drag = this.drag?.caseId === caseId ? this.drag : null;
    const isOpenEntry = entry === OPEN_ENTRY;
    const skill = skills[tab].list.find((e) => e.name === entry);
    const label = isOpenEntry ? OPEN_LABEL[tab] : skill?.repo ? `${entry} · ${shortRepo(skill.repo)}` : entry;
    const isLineAbove = drag?.to === index;
    const isLineBelow = drag?.to === count && index === count - 1;
    return h_flex().id(`case-entry-${caseId}-${entry}`).relative().h(26).pl(6).pr(6).gap(6).items_center().rounded(6)
      .when(!drag, (el) => el.hover((s) => s.bg(t.surface)))
      .when(drag?.entry === entry, (el) => el.bg(t.surface))
      .when(isLineAbove || isLineBelow, (el) => el.child(div().absolute().left(0).right(0).h(2).rounded(1).bg(t.accent)
        .when(isLineAbove, (line) => line.top(DROP_LINE_OFFSET))
        .when(isLineBelow, (line) => line.bottom(DROP_LINE_OFFSET))))
      .when(Boolean(drag), (el) => el
        .on_mouse_move((e, cx) => this.handleDragOver({ index, isLowerHalf: e.local_position.y > e.bounds.height / 2, cx }))
        .on_mouse_up("left", (_e, cx) => this.handleDrop({ tab, situation, skills, cx })))
      .child(div().id(`case-grip-${caseId}-${entry}`).w(14).h_full().flex_none().flex().items_center().justify_center()
        .text_color(t.dim).cursor_grab().hover((s) => s.text_color(t.foreground)).tooltip("Drag to reorder")
        .on_mouse_down("left", (_e, cx) => {
          this.drag = { caseId, entry, to: null };
          cx.stop_propagation();
          cx.notify();
        })
        .child(svg(icon("grip")).size(12)))
      .child(isOpenEntry ? this.openMark(tab) : this.shownBox({ tab, situation, skills, caseId, entry, isShown }))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(isOpenEntry ? t.muted : t.foreground)
        .when(!isShown, (el) => el.opacity(UNCHECKED_OPACITY))
        .child(label))
      .when(isDefault, (el) => el.child(div().flex_none().h(18).px(6).flex().items_center().rounded(4).bg(t.raised)
        .text_size(10.5).text_color(t.muted).child("default")));
  }

  // The checkbox: checked shows the skill in this case's menu.
  /** @param {{ tab: "github" | "linear" | "oncall", situation: Situation, skills: Skills, caseId: string, entry: string, isShown: boolean }} params */
  shownBox({ tab, situation, skills, caseId, entry, isShown }) {
    const t = theme();
    return div().id(`case-shown-${caseId}-${entry}`).size(20).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
      .hover((s) => s.bg(t.hover)).tooltip(isShown ? "In this case's menu: click to hide" : "Hidden in this case: click to show")
      .on_click((_e, cx) => {
        this.saveSkills({ tab, skills: setCaseHidden({ skills, tab, situation, skill: entry, isHidden: isShown }) });
        cx.notify();
      })
      .child(svg(icon(isShown ? "checkbox-checked" : "checkbox")).size(13).text_color(isShown ? t.accent : t.dim));
  }

  // In place of the checkbox for the Open entry: it is not in the menu, only a choice for the button.
  /** @param {"github" | "linear" | "oncall"} tab */
  openMark(tab) {
    const t = theme();
    return div().size(20).flex_none().flex().items_center().justify_center().child(svg(icon(tab)).size(12).text_color(t.muted));
  }

  // Over the top half of a row, the entry lands above it; over the bottom half, below it.
  /** @param {{ index: number, isLowerHalf: boolean, cx: import("gpui-kit").Context }} params */
  handleDragOver({ index, isLowerHalf, cx }) {
    const drag = this.drag;
    const to = index + (isLowerHalf ? 1 : 0);
    if (!drag || drag.to === to) return;
    this.drag = { ...drag, to };
    cx.notify();
  }

  /** @param {{ tab: "github" | "linear" | "oncall", situation: Situation, skills: Skills, cx: import("gpui-kit").Context }} params */
  handleDrop({ tab, situation, skills, cx }) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (drag.to !== null) this.saveSkills({ tab, skills: moveCaseEntry({ skills, tab, situation, entry: drag.entry, to: drag.to }) });
    cx.notify();
  }
}

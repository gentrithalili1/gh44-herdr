// The settings' "By case" group: one expandable header per kind of row (a case) with its
// default, and under it each action with a default radio and a shown checkbox.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme } from "herdr";
import { icon, radioMark } from "./ui.js";
import { getDefaultSkill, setDefaultSkill, setCaseHidden, getCaseActions, shortSkill } from "./settings.js";

/** @typedef {import("./settings.js").Skills} Skills */
/** @typedef {import("./settings.js").Situation} Situation */
/** @typedef {(e: unknown, cx: import("gpui-kit").Context) => void} ClickHandler */

export class CaseEditor {
  /** @param {{ saveSkills: (params: { tab: "github" | "linear", skills: Skills }) => void }} host */
  constructor({ saveSkills }) {
    this.saveSkills = saveSkills;
    // "<tab>:<situation>" of the expanded case.
    /** @type {string | null} */
    this.openCaseId = null;
  }

  collapse() {
    this.openCaseId = null;
  }

  // Every case of a tab: its header, and the action rows of the expanded one.
  /** @param {{ tab: "github" | "linear", situations: { id: Situation, label: string }[], skills: Skills }} params */
  rows({ tab, situations, skills }) {
    return situations.flatMap((situation) => this.caseRows({ tab, situation, skills }));
  }

  /** @param {{ tab: "github" | "linear", situation: { id: Situation, label: string }, skills: Skills }} params */
  caseRows({ tab, situation, skills }) {
    const t = theme();
    const caseId = `${tab}:${situation.id}`;
    const isOpen = this.openCaseId === caseId;
    const current = getDefaultSkill({ skills, tab, situation: situation.id });
    const header = h_flex().id(`case-${caseId}`).h(28).px(6).gap(8).items_center().rounded(6).cursor_pointer()
      .text_size(12.5).bg(isOpen ? t.hover : t.background).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.openCaseId = isOpen ? null : caseId; cx.notify(); })
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(situation.label))
      .child(div().text_color(current ? t.foreground : t.dim).child(current ? shortSkill(current) : "open"))
      .child(svg(icon(isOpen ? "chevron-up" : "chevron")).size(12).text_color(t.muted));
    if (!isOpen) return [header];
    const shown = getCaseActions({ skills, tab, situation: situation.id });
    /** @param {string | null} skill @returns {ClickHandler} */
    const handlePickDefault = (skill) => (_e, cx) => {
      this.saveSkills({ tab, skills: setDefaultSkill({ skills, tab, situation: situation.id, skill }) });
      cx.notify();
    };
    /** @param {{ skill: string, isShown: boolean }} params @returns {ClickHandler} */
    const handleToggleShown = ({ skill, isShown }) => (_e, cx) => {
      this.saveSkills({ tab, skills: setCaseHidden({ skills, tab, situation: situation.id, skill, isHidden: isShown }) });
      cx.notify();
    };
    const columns = h_flex().h(20).pl(18).pr(6).items_center().text_size(11).text_color(t.dim)
      .child(div().flex_1().child("Default"))
      .child(div().child("Shown"));
    const actionRows = skills[tab].list.map((entry) => {
      const isShown = shown.includes(entry.name);
      return h_flex().h(26).pl(18).pr(6).gap(8).items_center().rounded(6).hover((s) => s.bg(t.surface))
        .child(this.defaultChoice({ id: `${caseId}-${entry.name}`, label: entry.name, isOn: entry.name === current, onClick: handlePickDefault(entry.name) }))
        .child(div().id(`case-shown-${caseId}-${entry.name}`).size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
          .hover((s) => s.bg(t.hover)).tooltip(isShown ? "Shown in this case's menu: click to hide" : "Hidden in this case: click to show")
          .on_click(handleToggleShown({ skill: entry.name, isShown }))
          .child(svg(icon(isShown ? "checkbox-checked" : "checkbox")).size(13).text_color(isShown ? t.accent : t.dim)));
    });
    const noDefault = h_flex().h(26).pl(18).pr(6).items_center().rounded(6).hover((s) => s.bg(t.surface))
      .child(this.defaultChoice({ id: `${caseId}-none`, label: "No default: the button opens it", isOn: current === null, onClick: handlePickDefault(null) }));
    return [header, columns, ...actionRows, noDefault];
  }

  // The radio and name that make an action the case's default.
  /** @param {{ id: string, label: string, isOn: boolean, onClick: ClickHandler }} params */
  defaultChoice({ id, label, isOn, onClick }) {
    const t = theme();
    return h_flex().id(`case-default-${id}`).flex_1().min_w(0).h_full().gap(8).items_center().cursor_pointer()
      .text_size(12).text_color(t.foreground).on_click(onClick)
      .child(radioMark({ t, isOn }))
      .child(div().min_w(0).truncate().child(label));
  }
}

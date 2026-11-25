// A row's details: the hub mod opened as a dialog (props().dialog === ROW_DETAILS_DIALOG) when a
// row is clicked, or on Space. Its case's suggestions with a reason each, its links and own actions
// (an On-call row's report, Continue, re-run), the row's status, its agent and worktree
// (row-action.js getRowDetails), and Edit this case, which opens the case editor.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, props, openOverlay, closeOverlay } from "herdr";
import { icon, palette, MONO_FONT } from "./ui.js";
import { dialogHeader, dialogSection, dialogFooter, toneText } from "./controls.js";
import { getLinkEntry } from "./settings.js";

export const ROW_DETAILS_DIALOG = "row-details";
const DIALOG_WIDTH = 460;
const DIALOG_MAX_HEIGHT = 620;
const HEADER_HEIGHT = 84;
const SECTION_CHROME_HEIGHT = 38;
const ACTION_ROW_HEIGHT = 32;
const FACT_ROW_HEIGHT = 22;
const FOOTER_HEIGHT = 44;
const FACT_LABEL_WIDTH = 96;

// rowActions: an On-call row's own actions, run by the panel on the row. links: pages to open, or
// (url null) a link entry the panel runs on the row, like a suggested one.
/**
 * @typedef {Omit<import("./row-action.js").RowDetails, "links"> & {
 *   tab: import("./settings.js").Tab, rowId: string, rowActions?: { id: import("./row-action.js").OncallMenuId, label: string, icon: string }[], situation: import("./settings.js").Situation, holder: { tone: string, icon: string, tip: string }, refs: string[], title: string,
 *   caseLabel: string, links: { label: string, icon: string, url: string | null, entry?: string | null }[], agentTab: { space: string, tab: string } | null,
 * }} RowDetailsProps
 */

// Tall enough for every row it shows; past DIALOG_MAX_HEIGHT the sections scroll.
/** @param {RowDetailsProps} details */
const getDialogHeight = (details) => {
  const actions = details.suggested.length + details.links.length + (details.rowActions ?? []).length + Number(details.agentTab !== null);
  const sections = [details.status.length, ...(details.agent ? [details.agent.length] : [])];
  const height = HEADER_HEIGHT + SECTION_CHROME_HEIGHT + actions * ACTION_ROW_HEIGHT
    + sections.reduce((sum, rows) => sum + SECTION_CHROME_HEIGHT + rows * FACT_ROW_HEIGHT, 0) + FOOTER_HEIGHT;
  return Math.min(DIALOG_MAX_HEIGHT, height);
};

/** @param {RowDetailsProps} details */
export const openRowDetails = (details) => openOverlay({
  mod: "hub", kind: "dialog", width: DIALOG_WIDTH, height: getDialogHeight(details), props: { dialog: ROW_DETAILS_DIALOG, details },
});

export class RowDetailsDialog {
  /**
   * @param {{
   *   cx: import("gpui-kit").Context,
   *   details: RowDetailsProps,
   *   onRunMain: () => void,
   *   onStartSkill: (skill: string) => void,
   *   onGoToAgent: () => void,
   *   onEditCase: () => void,
   *   onRowAction: (action: import("./row-action.js").OncallMenuId) => void,
   * }} params
   */
  constructor({ cx, details, onRunMain, onStartSkill, onGoToAgent, onEditCase, onRowAction }) {
    this.details = details;
    this.onRunMain = onRunMain;
    this.onStartSkill = onStartSkill;
    this.onGoToAgent = onGoToAgent;
    this.onEditCase = onEditCase;
    this.onRowAction = onRowAction;
    // Closed by one of its actions; else (Esc) the panel's list takes the keyboard back.
    this.hasActed = false;
    // The dialog takes the keyboard: Enter runs what the row's button runs.
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  /** @param {import("gpui-kit").KeyEvent} e @param {import("gpui-kit").Context} cx */
  handleKey(e, cx) {
    if (e.key !== "enter") return;
    cx.stop_propagation();
    this.handleAction(() => this.onRunMain());
  }

  // Closes the dialog, then runs what was picked.
  /** @param {() => void} action */
  handleAction(action) {
    this.hasActed = true;
    closeOverlay(props().overlay);
    action();
  }

  header() {
    const t = theme();
    const { holder, refs, title, caseLabel } = this.details;
    const [ref, ...rest] = refs;
    return dialogHeader({
      tone: holder.tone, iconName: holder.icon, tip: holder.tip, title,
      kicker: h_flex().min_w(0).gap(5).items_center().text_size(12).text_color(t.dim)
        .child(div().flex_none().font_family(MONO_FONT).text_color(t.muted).child(ref))
        .children(rest.map((part) => div().min_w(0).truncate().child(`· ${part}`))),
      subtitle: h_flex().gap(4).text_size(12).text_color(t.dim)
        .child("Case:")
        .child(div().font_semibold().text_color(toneText({ tone: holder.tone })).child(caseLabel)),
    });
  }

  // [▶ skill · reason      key]: the first is the case's main one (a link entry shows as its link).
  // Then the links, the row's own actions and the agent tab.
  actionRows() {
    const t = theme();
    /** @param {{ id: string, iconName: string, iconColor: string, isMain?: boolean, onClick: (cx: import("gpui-kit").Context) => void }} params */
    const row = ({ id, iconName, iconColor, isMain = false, onClick }) => h_flex().id(`details-action-${id}`).h(ACTION_ROW_HEIGHT).flex_none().px(8).gap(8)
      .items_center().rounded(5).cursor_pointer().text_size(12.5).text_color(t.foreground)
      .when(isMain, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.handleAction(() => onClick(cx)))
      .child(svg(icon(iconName)).size(11).flex_none().text_color(iconColor));
    const skills = this.details.suggested.map((s) => {
      const link = getLinkEntry(s.skill);
      return row({ id: s.skill, iconName: link?.icon ?? "play", iconColor: link ? t.muted : t.accent, isMain: s.isMain, onClick: () => this.onStartSkill(s.skill) })
        .child(h_flex().flex_1().min_w(0).gap(4).items_center()
          .child(div().flex_none().child(link?.label ?? s.skill))
          .when(s.reason !== null, (el) => el.child(div().min_w(0).truncate().text_size(12).text_color(t.dim).child(`· ${s.reason}`))))
        .when(s.key !== null, (el) => el.child(div().flex_none().font_family(MONO_FONT).text_size(11).text_color(t.dim).child(s.key ?? "")));
    });
    /** @param {{ link: { url: string | null, entry?: string | null }, cx: import("gpui-kit").Context }} params */
    const handleLink = ({ link, cx }) => {
      if (link.url) cx.open_url(link.url);
      else if (link.entry) this.onStartSkill(link.entry);
    };
    const links = this.details.links.map((link) => row({ id: link.label, iconName: link.icon, iconColor: t.muted, onClick: (cx) => handleLink({ link, cx }) })
      .child(div().flex_1().child(link.label)));
    const rowActions = (this.details.rowActions ?? []).map((action) => row({ id: action.id, iconName: action.icon, iconColor: t.muted, onClick: () => this.onRowAction(action.id) })
      .child(div().flex_1().child(action.label)));
    const agent = this.details.agentTab !== null
      ? [row({ id: "agent", iconName: "resume", iconColor: t.muted, onClick: () => this.onGoToAgent() }).child(div().flex_1().child("Go to agent tab"))]
      : [];
    return [...skills, ...links, ...rowActions, ...agent];
  }

  // Label and value; a value with a url opens it.
  /** @param {import("./row-action.js").DetailRow} fact */
  factRow(fact) {
    const t = theme();
    const color = fact.tone ? palette(t)[fact.tone] ?? t[fact.tone] : t.foreground;
    const value = div().id(`details-fact-${fact.label}`).flex_1().min_w(0).truncate().text_color(color)
      .when(fact.isMono, (el) => el.font_family(MONO_FONT))
      .when(fact.url !== null, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Open")
        .on_click((_e, cx) => cx.open_url(fact.url ?? "")))
      .child(fact.value);
    return h_flex().h(FACT_ROW_HEIGHT).flex_none().items_center().text_size(12.5)
      .child(div().w(FACT_LABEL_WIDTH).flex_none().text_color(t.dim).child(fact.label))
      .child(value);
  }

  footer() {
    const t = theme();
    return dialogFooter({
      left: h_flex().id("details-edit-case").gap(5).items_center().text_size(12).text_color(t.accent).cursor_pointer().hover((s) => s.opacity(0.85))
        .on_click(() => this.handleAction(() => this.onEditCase()))
        .child(svg(icon("settings")).size(12))
        .child("Edit this case"),
      buttons: [div().text_size(12).text_color(t.dim).child("↵ runs the row's button · Esc to close")],
    });
  }

  render() {
    const t = theme();
    const { status, agent } = this.details;
    return v_flex().id("row-details").track_focus(this.handle).on_key_down((e, cx) => this.handleKey(e, cx)).size_full().min_h(0).rounded(8).overflow_hidden().bg(t.popover).text_color(t.foreground)
      .child(this.header())
      .child(v_flex().id("row-details-body").flex_1().min_h(0).overflow_y_scrollbar()
        .child(dialogSection({ id: "details-suggested", title: "Suggested", children: this.actionRows() }))
        .child(dialogSection({ id: "details-status", title: "Status", children: status.map((fact) => this.factRow(fact)) }))
        .when(agent !== null, (el) => el.child(dialogSection({ id: "details-agent", title: "Agent", children: (agent ?? []).map((fact) => this.factRow(fact)) }))))
      .child(this.footer());
  }
}

// The case editor: the hub mod opened as a dialog (props().dialog === CASE_EDITOR_DIALOG) for one
// kind of row (a case). Its actions in order (drag to reorder; the first shown one is the main
// action; a switch hides one in this case), an action to add, its rules that pick another main
// action for some rows (Narrow it), where its runs go and what it suggests after an agent is
// done, and a preview of a real row of the case.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, props, shared, openOverlay, closeOverlay, run } from "herdr";
import { icon, palette, splitButtonLook, MONO_FONT, SPLIT_BUTTON_HEIGHT } from "./ui.js";
import {
  controlRow, switchMark, actionChip, selectButton, button, listTag, fieldBox, holderStrip, dialogHeader, dialogSection, dialogFooter, toneText,
} from "./controls.js";
import {
  setCaseHidden, moveCaseEntry, setCaseRun, getCaseRun, resetCase, addCaseSkill, getDefaultSkill, getCaseActions, getSkillCandidates,
  isValidSkillName, shortSkill, shortRepo, getLinkEntry, isLinkEntry, addCaseRule, removeCaseRule, setCaseRuleAction,
  OPEN_ENTRY, AFTER_DONE_NOTHING, GITHUB_SITUATIONS, LINEAR_SITUATIONS, ONCALL_SITUATIONS, LINK_ENTRIES, RULE_KINDS,
} from "./settings.js";
import { getRowAction, getOncallRowAction, getCaseRunPlace, getPullRequestActions, getTicketActions } from "./row-action.js";
import { PRIORITY_OPTIONS } from "./filters.js";

/** @typedef {import("./settings.js").Skills} Skills */
/** @typedef {import("./settings.js").Situation} Situation */
/** @typedef {import("./settings.js").Tab} Tab */
/** @typedef {import("./settings.js").CaseWhere} CaseWhere */
// The row a preview is of, for its actions as the case is set now (rules and link entries).
/**
 * @typedef {{ kind: "pullRequest", pr: Parameters<typeof getPullRequestActions>[0]["pr"], login: string | null,
 *   links: import("./row-action.js").RowLinkEntry[] } | { kind: "issue", issue: Parameters<typeof getTicketActions>[0]["issue"] }} PreviewSource
 */
// A row of the case for the preview: its strip and what decides its button. oncall: an On-call
// row's report and tracker; null on the other tabs. source: a PR or ticket row's data.
/**
 * @typedef {{ title: string, meta: string, holder: { tone: string, icon: string }, targetLabel: string, isMergeReady: boolean,
 *   hasWorktreeTarget: boolean, hasWorktree: boolean, oncall: { hasReport: boolean, trackerName: string } | null, source?: PreviewSource }} CasePreview
 */
// matches: the rows of the case in the panel's lists now; null when the tab's list is not loaded.
/** @typedef {{ tab: Tab, situation: Situation, matches: { count: number, refs: string[] } | null, preview: CasePreview | null }} CaseEditorProps */

export const CASE_EDITOR_DIALOG = "case-editor";
const DIALOG_WIDTH = 480;
const DIALOG_MAX_HEIGHT = 640;
const HEADER_HEIGHT = 84;
const SECTION_CHROME_HEIGHT = 38;
const ENTRY_ROW_HEIGHT = 30;
const CONTROL_ROW_HEIGHT = 38;
const PREVIEW_HEIGHT = 56;
const FOOTER_HEIGHT = 44;
// The drop line sits in the gap between entry rows: 3px out, 2px tall.
const DROP_LINE_OFFSET = -3;
const HIDDEN_OPACITY = 0.5;
const MATCH_REFS_SHOWN = 3;
const SKILL_SUGGESTIONS = 6;
const TICK_MS = 300;
const WHERE_SELECT = "hub.caseWhereSelect";
const AFTER_DONE_SELECT = "hub.caseAfterDoneSelect";
// A rule's action select is this plus "|<rule id>"; the new rule's kind, priority and action have their own.
const RULE_THEN_SELECT = "hub.caseRuleThenSelect";
const RULE_DRAFT_KIND_SELECT = "hub.caseRuleKindSelect";
const RULE_DRAFT_PRIORITY_SELECT = "hub.caseRulePrioritySelect";
const RULE_DRAFT_THEN_SELECT = "hub.caseRuleDraftThenSelect";
// The after done select's value for "its main action" (null in the settings).
const AFTER_DONE_MAIN = "(main)";

/** @type {Record<Tab, string>} */
const TAB_LABEL = { github: "GitHub", linear: "Linear", oncall: "On-call" };
// What a case's button does with no skill first.
/** @type {Record<Tab, string>} */
const OPENS = { github: "opens the PR", linear: "opens the ticket", oncall: "opens the report" };
/** @type {Record<Tab, { label: string, icon: string }>} */
const OPEN_LINK = { github: { label: "Open in GitHub", icon: "github" }, linear: { label: "Open in Linear", icon: "linear" }, oncall: { label: "Open the report", icon: "oncall" } };
/** @type {Record<Tab, { id: Situation, label: string }[]>} */
const SITUATIONS = { github: GITHUB_SITUATIONS, linear: LINEAR_SITUATIONS, oncall: ONCALL_SITUATIONS };
// Where a case can run, per tab: a PR has no branch to make a worktree from; an issue runs in a
// tab of this space, in front or in the background.
/** @type {Record<Tab, { value: CaseWhere, label: string }[]>} */
const WHERE_OPTIONS = {
  github: [{ value: "default", label: "Default: a background tab" }, { value: "here", label: "This space" }, { value: "background", label: "Background tab" }],
  linear: [
    { value: "default", label: "Default: Where runs go" }, { value: "worktree", label: "New worktree" },
    { value: "here", label: "This space" }, { value: "background", label: "Background tab" },
  ],
  oncall: [{ value: "default", label: "Default: this space" }, { value: "background", label: "Background tab" }],
};
/** @type {Record<Tab, string>} */
const WHERE_HELP = {
  github: "Overrides Where runs go for this case.",
  linear: "Overrides Where runs go for this case.",
  oncall: "Ask and Continue always open in front.",
};

// A case's holder: its tone and glyph, like the rows it matches.
/** @type {Record<Situation, { tone: string, icon: string }>} */
const CASE_LOOK = {
  myConflicts: { tone: "danger", icon: "x" },
  myChecksFailing: { tone: "danger", icon: "ci-failing" },
  myChangesRequested: { tone: "danger", icon: "x" },
  myApproved: { tone: "success", icon: "check" },
  myDraft: { tone: "neutral", icon: "state-backlog" },
  myPullRequest: { tone: "quiet", icon: "state-progress" },
  othersPullRequest: { tone: "warning", icon: "state-review" },
  backlog: { tone: "neutral", icon: "state-backlog" },
  todo: { tone: "quiet", icon: "state-todo" },
  inProgress: { tone: "warning", icon: "state-progress" },
  inProgressWithPullRequest: { tone: "warning", icon: "state-progress" },
  reviewMine: { tone: "danger", icon: "state-review" },
  reviewOthers: { tone: "warning", icon: "state-review" },
  critical: { tone: "danger", icon: "alert" },
  high: { tone: "warning", icon: "alert" },
  needsYou: { tone: "quiet", icon: "oncall" },
  notForYou: { tone: "neutral", icon: "check" },
  filtered: { tone: "neutral", icon: "filter" },
  failed: { tone: "neutral", icon: "x" },
};

/** @param {Situation} situation */
export const getCaseLook = (situation) => CASE_LOOK[situation];

// An entry's name in a list: a link entry's label, a skill's name.
/** @param {string} name */
const entryLabel = (name) => getLinkEntry(name)?.label ?? name;
// An entry on a chip or in a select: "↗ checks", a skill without the gh44 prefix.
/** @param {string} name */
const entryShort = (name) => {
  const link = getLinkEntry(name);
  return link ? `↗ ${link.short}` : shortSkill(name);
};

/** @type {Record<import("./settings.js").RuleKind, string>} */
const RULE_KIND_LABEL = { check: "A failing check's name has", label: "Label is", author: "Author is", size: "Lines changed over", priority: "Priority is" };
// The value field's example, per kind.
/** @type {Record<import("./settings.js").RuleKind, string>} */
const RULE_EXAMPLE = { check: "e.g. lint", label: "e.g. bug", author: "a GitHub login", size: "e.g. 500", priority: "" };

// What a rule's row says: "If a check with lint fails", "If labeled bug".
/** @param {import("./settings.js").CaseRule["when"]} when */
const formatRule = (when) => {
  switch (when.kind) {
    case "check": return `If a check with “${when.value}” fails`;
    case "label": return `If labeled “${when.value}”`;
    case "author": return `If opened by ${when.value}`;
    case "size": return `If over ${when.value} lines changed`;
    case "priority": return `If priority ${PRIORITY_OPTIONS.find((p) => p.value === Number(when.value))?.label ?? when.value}`;
    default: {
      /** @type {never} */
      const unknownKind = when.kind;
      return unknownKind;
    }
  }
};

// A preview row's actions as the case is set now. null: an On-call row, whose case has no rules.
/** @param {{ source: PreviewSource | undefined, skills: Skills }} params */
const getPreviewActions = ({ source, skills }) => {
  if (!source) return null;
  switch (source.kind) {
    case "pullRequest": return getPullRequestActions({ skills, pr: source.pr, login: source.login, links: source.links });
    case "issue": return getTicketActions({ skills, issue: source.issue });
    default: {
      /** @type {never} */
      const unknownSource = source;
      return unknownSource;
    }
  }
};

/** @param {{ tab: Tab, situation: Situation }} params */
export const getCaseLabel = ({ tab, situation }) => SITUATIONS[tab].find((s) => s.id === situation)?.label ?? situation;

// A case strip's count: "0", "1 row", "3 rows".
/** @param {CaseEditorProps["matches"]} matches */
const formatMatchCount = (matches) => {
  if (!matches) return "";
  if (matches.count === 0) return "0";
  return `${matches.count} row${matches.count === 1 ? "" : "s"}`;
};

// "Matches 2 rows now: #15, #16"; nothing when the tab's list is not loaded.
/** @param {CaseEditorProps["matches"]} matches */
const formatMatches = (matches) => {
  if (!matches) return null;
  if (matches.count === 0) return "No rows match right now";
  const refs = matches.refs.slice(0, MATCH_REFS_SHOWN).join(", ");
  const more = matches.count > MATCH_REFS_SHOWN ? ` +${matches.count - MATCH_REFS_SHOWN}` : "";
  return `Matches ${matches.count} row${matches.count === 1 ? "" : "s"} now: ${refs}${more}`;
};

// Tall enough for the case's rows; past DIALOG_MAX_HEIGHT the body scrolls.
/** @param {{ props: CaseEditorProps, skills: Skills }} params */
const getDialogHeight = ({ props: p, skills }) => {
  const entries = skills[p.tab].cases[p.situation]?.order.length ?? 0;
  const rules = skills[p.tab].cases[p.situation]?.rules.length ?? 0;
  const narrowHeight = RULE_KINDS[p.tab].length > 0 ? SECTION_CHROME_HEIGHT + (rules + 1) * CONTROL_ROW_HEIGHT : 0;
  const height = HEADER_HEIGHT + SECTION_CHROME_HEIGHT + (entries + 1) * ENTRY_ROW_HEIGHT + narrowHeight
    + SECTION_CHROME_HEIGHT + 2 * CONTROL_ROW_HEIGHT + SECTION_CHROME_HEIGHT + PREVIEW_HEIGHT + FOOTER_HEIGHT;
  return Math.min(DIALOG_MAX_HEIGHT, height);
};

/** @param {{ editor: CaseEditorProps, skills: Skills }} params */
export const openCaseEditor = ({ editor, skills }) => openOverlay({
  mod: "hub", kind: "dialog", width: DIALOG_WIDTH, height: getDialogHeight({ props: editor, skills }), props: { dialog: CASE_EDITOR_DIALOG, editor },
});

export class CaseEditorDialog {
  /**
   * @param {{
   *   cx: import("gpui-kit").Context,
   *   editor: CaseEditorProps,
   *   getSettings: () => import("./settings.js").Settings,
   *   getRowSkills: () => Skills,
   *   getSession: () => { installedSkills: string[] | null, repo: import("./settings.js").RepoSkills },
   *   saveSkills: (params: { tab: Tab, skills: Skills }) => void,
   *   getRole: (skill: string) => import("./settings.js").SkillRole,
   *   openSelect: (params: { store: string, title: string, value: string | string[], options: { value: string, label: string }[], anchor?: import("./ui.js").Anchor | null }) => void,
   * }} params
   */
  constructor({ cx, editor, getSettings, getRowSkills, getSession, saveSkills, getRole, openSelect }) {
    this.editor = editor;
    this.getSettings = getSettings;
    this.getRowSkills = getRowSkills;
    this.getSession = getSession;
    this.saveSkills = saveSkills;
    this.getRole = getRole;
    this.openSelect = openSelect;
    // An entry being dragged by its grip, and where it lands: an index of the case's order.
    /** @type {{ entry: string, to: number | null } | null} */
    this.drag = null;
    this.isAdding = false;
    this.isAddRefused = false;
    this.addInput = InputState.new({ placeholder: "Skill name, as in /name" });
    this.addInput.on("change", (_e, cx) => { this.isAddRefused = false; cx.notify(); });
    this.addInput.on("submit", (_e, cx) => this.handleAdd({ skill: this.addInput.value(), repo: null, cx }));
    // A new rule being written: its kind, a priority's pick, its action; the value is typed.
    this.isAddingRule = false;
    this.isRuleRefused = false;
    this.ruleDraft = this.getEmptyDraft();
    this.ruleInput = InputState.new({ placeholder: "Value" });
    this.ruleInput.on("change", (_e, cx) => { this.isRuleRefused = false; cx.notify(); });
    this.ruleInput.on("submit", (_e, cx) => this.handleAddRule(cx));
    // The selects opened from here: a pick is read back on the next tick, then the store is dropped,
    // so a later reset or a new rule is never undone by an old pick.
    /** @type {Set<string>} */
    this.openSelects = new Set();
    cx.timer.every(TICK_MS, () => this.applyPicks());
  }

  get skills() {
    return this.getSettings().skills;
  }

  // The tab's entries a rule can pick: its skills and link entries.
  getRuleActions() {
    return this.skills[this.editor.tab].list.map((e) => ({ value: e.name, label: entryLabel(e.name) }));
  }

  /** @returns {{ kind: import("./settings.js").RuleKind, priority: string, then: string }} */
  getEmptyDraft() {
    const { tab } = this.editor;
    return { kind: RULE_KINDS[tab][0] ?? "label", priority: String(PRIORITY_OPTIONS[0].value), then: this.skills[tab].list[0]?.name ?? "" };
  }

  /** @param {Skills} skills */
  save(skills) {
    this.saveSkills({ tab: this.editor.tab, skills });
  }

  // A select's pick that differs from what it was opened on (openSelect stores that); null: none yet.
  /** @param {{ store: string, current: string }} params */
  getPick({ store, current }) {
    const saved = shared(store);
    const value = this.openSelects.has(store) && saved && typeof saved === "object" && "value" in saved && typeof saved.value === "string" ? saved.value : null;
    return value !== null && value !== current ? value : null;
  }

  applyPicks() {
    const { tab, situation } = this.editor;
    const current = getCaseRun({ skills: this.skills, tab, situation });
    const wherePick = WHERE_OPTIONS[tab].find((o) => o.value === this.getPick({ store: WHERE_SELECT, current: current.where }))?.value ?? null;
    if (wherePick !== null) {
      this.openSelects.delete(WHERE_SELECT);
      this.save(setCaseRun({ skills: this.skills, tab, situation, run: { ...current, where: wherePick } }));
    }
    const afterDonePick = this.getPick({ store: AFTER_DONE_SELECT, current: current.afterDone ?? AFTER_DONE_MAIN });
    if (afterDonePick !== null) {
      this.openSelects.delete(AFTER_DONE_SELECT);
      const afterDone = afterDonePick === AFTER_DONE_MAIN ? null : afterDonePick;
      this.save(setCaseRun({ skills: this.skills, tab, situation, run: { ...getCaseRun({ skills: this.skills, tab, situation }), afterDone } }));
    }
    for (const rule of this.skills[tab].cases[situation]?.rules ?? []) {
      const store = `${RULE_THEN_SELECT}|${rule.id}`;
      const then = this.getPick({ store, current: rule.then });
      if (then === null) continue;
      this.openSelects.delete(store);
      this.save(setCaseRuleAction({ skills: this.skills, tab, situation, id: rule.id, then }));
    }
    this.applyDraftPicks();
  }

  // The new rule's selects: each pick goes into the draft, then its store is dropped.
  applyDraftPicks() {
    const kindPick = this.getPick({ store: RULE_DRAFT_KIND_SELECT, current: this.ruleDraft.kind });
    const kind = RULE_KINDS[this.editor.tab].find((k) => k === kindPick) ?? this.ruleDraft.kind;
    const priority = this.getPick({ store: RULE_DRAFT_PRIORITY_SELECT, current: this.ruleDraft.priority }) ?? this.ruleDraft.priority;
    const then = this.getPick({ store: RULE_DRAFT_THEN_SELECT, current: this.ruleDraft.then }) ?? this.ruleDraft.then;
    if (kind === this.ruleDraft.kind && priority === this.ruleDraft.priority && then === this.ruleDraft.then) return;
    for (const store of [RULE_DRAFT_KIND_SELECT, RULE_DRAFT_PRIORITY_SELECT, RULE_DRAFT_THEN_SELECT]) this.openSelects.delete(store);
    this.ruleDraft = { kind, priority, then };
    this.isRuleRefused = false;
  }

  /** @param {import("gpui-kit").Context} cx */
  handleAddRule(cx) {
    const { tab, situation } = this.editor;
    const { kind, priority, then } = this.ruleDraft;
    const value = kind === "priority" ? priority : this.ruleInput.value();
    const next = addCaseRule({ skills: this.skills, tab, situation, when: { kind, value }, then });
    if (next === this.skills) {
      this.isRuleRefused = true;
      cx.notify();
      return;
    }
    this.save(next);
    this.closeRuleForm();
    cx.notify();
  }

  closeRuleForm() {
    this.isAddingRule = false;
    this.isRuleRefused = false;
    this.ruleInput.set_value("");
    for (const store of [RULE_DRAFT_KIND_SELECT, RULE_DRAFT_PRIORITY_SELECT, RULE_DRAFT_THEN_SELECT]) this.openSelects.delete(store);
    this.ruleDraft = this.getEmptyDraft();
  }

  /** @param {{ store: string, title: string, value: string, options: { value: string, label: string }[], anchor: import("./ui.js").Anchor | null }} params */
  handleOpenSelect({ store, title, value, options, anchor }) {
    this.openSelects.add(store);
    this.openSelect({ store, title, value, options, anchor });
  }

  // Back to the built-in case; no select still open from before carries its pick over.
  handleReset() {
    const { tab, situation } = this.editor;
    this.openSelects.clear();
    this.save(resetCase({ skills: this.skills, tab, situation }));
  }

  // Closed by Done or Esc: the panel's list takes the keyboard back.
  async close() {
    run("hub.focus");
  }

  /** @param {{ skill: string, repo: string | null, cx: import("gpui-kit").Context }} params */
  handleAdd({ skill, repo, cx }) {
    const name = skill.trim();
    if (!name) return;
    if (!isValidSkillName(name) && !isLinkEntry(name)) {
      this.isAddRefused = true;
      cx.notify();
      return;
    }
    const { tab, situation } = this.editor;
    this.save(addCaseSkill({ skills: this.skills, tab, situation, skill: name, repo }));
    this.addInput.set_value("");
    this.isAdding = false;
    cx.notify();
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

  /** @param {import("gpui-kit").Context} cx */
  handleDrop(cx) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    const { tab, situation } = this.editor;
    if (drag.to !== null) this.save(moveCaseEntry({ skills: this.skills, tab, situation, entry: drag.entry, to: drag.to }));
    cx.notify();
  }

  /** @param {import("gpui-kit").Context} cx */
  cancelDrag(cx) {
    if (!this.drag) return;
    this.drag = null;
    cx.notify();
  }

  header() {
    const { tab, situation, matches } = this.editor;
    const look = getCaseLook(situation);
    const t = theme();
    return dialogHeader({
      tone: look.tone, iconName: look.icon,
      kicker: h_flex().gap(4).text_size(12).text_color(t.dim).child("Case ·").child(div().text_color(toneText({ tone: look.tone })).child(TAB_LABEL[tab])),
      title: getCaseLabel({ tab, situation }),
      subtitle: formatMatches(matches),
    });
  }

  // ⠿ grip · name ("· main action" on the first shown one) · key · switch. Hidden: faded.
  /** @param {{ entry: string, index: number, count: number, isShown: boolean, isMain: boolean }} params */
  entryRow({ entry, index, count, isShown, isMain }) {
    const t = theme();
    const { tab, situation } = this.editor;
    const drag = this.drag;
    const isOpenEntry = entry === OPEN_ENTRY;
    const isLink = isOpenEntry || isLinkEntry(entry);
    const skill = this.skills[tab].list.find((e) => e.name === entry);
    const isLineAbove = drag?.to === index;
    const isLineBelow = drag?.to === count && index === count - 1;
    const label = isOpenEntry ? OPEN_LINK[tab].label : entryLabel(entry);
    return h_flex().id(`case-entry-${entry}`).relative().h(ENTRY_ROW_HEIGHT - 2).flex_none().px(6).gap(8).items_center().rounded(5)
      .when(isMain, (el) => el.bg(t.raised))
      .when(!drag, (el) => el.hover((s) => s.bg(t.hover)))
      .when(drag?.entry === entry, (el) => el.bg(t.hover))
      .when(isLineAbove || isLineBelow, (el) => el.child(div().absolute().left(0).right(0).h(2).rounded(1).bg(t.accent)
        .when(isLineAbove, (line) => line.top(DROP_LINE_OFFSET))
        .when(isLineBelow, (line) => line.bottom(DROP_LINE_OFFSET))))
      .when(Boolean(drag), (el) => el
        .on_mouse_move((e, cx) => this.handleDragOver({ index, isLowerHalf: e.local_position.y > e.bounds.height / 2, cx }))
        .on_mouse_up("left", (_e, cx) => this.handleDrop(cx)))
      .child(div().id(`case-grip-${entry}`).w(14).h_full().flex_none().flex().items_center().justify_center()
        .text_color(t.dim).cursor_grab().hover((s) => s.text_color(t.foreground)).tooltip("Drag to reorder")
        .on_mouse_down("left", (_e, cx) => {
          this.drag = { entry, to: null };
          cx.stop_propagation();
          cx.notify();
        })
        .child(svg(icon("grip")).size(12)))
      .child(svg(icon(isOpenEntry ? OPEN_LINK[tab].icon : getLinkEntry(entry)?.icon ?? "play")).size(11).flex_none().text_color(isLink ? t.muted : t.accent))
      .child(h_flex().flex_1().min_w(0).gap(5).items_center().text_size(12.5).when(!isShown, (el) => el.opacity(HIDDEN_OPACITY))
        .child(div().min_w(0).truncate().text_color(isOpenEntry ? t.muted : t.foreground).child(label))
        .when(Boolean(skill?.repo), (el) => el.child(listTag({ kind: "repo", text: shortRepo(skill?.repo ?? "") })))
        .when(isMain, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child("· main action")))
        .when(!isShown, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child("· hidden here"))))
      .when(Boolean(skill?.key), (el) => el.child(div().flex_none().font_family(MONO_FONT).text_size(11).text_color(t.dim).child(skill?.key ?? "")))
      .child(isOpenEntry
        ? div().w(28).flex_none()
        : div().id(`case-shown-${entry}`).flex_none().cursor_pointer().tooltip(isShown ? "Shown in this case: click to hide" : "Hidden in this case: click to show")
          .on_click((_e, cx) => {
            this.save(setCaseHidden({ skills: this.skills, tab, situation, skill: entry, isHidden: isShown }));
            cx.notify();
          })
          .child(switchMark({ isOn: isShown })));
  }

  // "+ Add an action to this case", or the field with the skills it can add: the tab's hidden ones,
  // the focused repo's and the installed ones.
  addRows() {
    const t = theme();
    const { tab, situation } = this.editor;
    if (!this.isAdding) {
      return [h_flex().id("case-add").h(ENTRY_ROW_HEIGHT - 2).flex_none().px(6).items_center().rounded(5).cursor_pointer().text_size(12.5)
        .text_color(t.accent).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.isAdding = true; this.addInput.set_value(""); this.addInput.focus(); cx.notify(); })
        .child("+ Add an action to this case")];
    }
    const typed = this.addInput.value().trim();
    const hidden = getCaseActions({ skills: this.skills, tab, situation });
    const tabHidden = this.skills[tab].list.filter((e) => !hidden.includes(e.name)).map((e) => ({ name: e.name, repo: e.repo ?? null, source: "tab" }));
    const { installedSkills, repo } = this.getSession();
    const names = this.skills[tab].list.map((e) => e.name);
    const others = getSkillCandidates({ names, installedSkills, repo, typed })
      .map((c) => ({ ...c, source: c.repo ? "repo" : "installed" }));
    const links = tab === "github"
      ? LINK_ENTRIES.filter((e) => isLinkEntry(e.name) && !names.includes(e.name)).map((e) => ({ name: e.name, repo: /** @type {string | null} */ (null), source: "link" }))
      : [];
    const isTyped = (/** @type {{ name: string }} */ c) => entryLabel(c.name).toLowerCase().includes(typed.toLowerCase());
    const suggestions = [...tabHidden.filter(isTyped), ...others, ...links.filter(isTyped)].slice(0, SKILL_SUGGESTIONS);
    return [
      fieldBox({
        id: "case-add", isFocused: true, iconName: "search", input: Input.new(this.addInput).flex_1().text_size(12).text_color(t.foreground),
        trailing: div().id("case-add-cancel").px(8).text_size(11.5).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.isAdding = false; cx.notify(); })
          .child("Cancel"),
      }),
      ...suggestions.map((c) => h_flex().id(`case-add-${c.name}`).h(26).flex_none().px(8).gap(6).items_center().rounded(5).cursor_pointer()
        .text_size(12).text_color(t.foreground).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.handleAdd({ skill: c.name, repo: c.repo, cx }))
        .child(svg(icon(getLinkEntry(c.name)?.icon ?? "play")).size(10).flex_none().text_color(isLinkEntry(c.name) ? t.muted : t.accent))
        .child(div().flex_1().min_w(0).truncate().child(entryLabel(c.name)))
        .child(this.candidateTag(c))),
      ...(suggestions.length === 0 ? [div().px(8).text_size(11.5).text_color(t.dim).child(typed ? "↵ adds it by this name" : "No more skills to add. Type a name.")] : []),
      ...(this.isAddRefused ? [div().px(8).text_size(11.5).text_color(palette(t).danger).child("A skill name is one word: letters, digits, _ : . or -")] : []),
    ];
  }

  // A candidate's tag: its repo, built in (the tab has it), installed, or a link.
  /** @param {{ name: string, repo: string | null, source: string }} candidate */
  candidateTag(candidate) {
    if (candidate.source === "repo") return listTag({ kind: "repo", text: shortRepo(candidate.repo ?? "") });
    if (candidate.source === "link" || isLinkEntry(candidate.name)) return listTag({ kind: "link" });
    return listTag({ kind: candidate.source === "tab" ? "builtIn" : "installed" });
  }

  suggestSection() {
    const { tab, situation } = this.editor;
    const c = this.skills[tab].cases[situation];
    if (!c) return dialogSection({ id: "suggest", title: "Suggest, in this order", children: [] });
    const firstShown = c.order.find((name) => !c.hidden.includes(name));
    const rows = c.order.map((entry, index) => this.entryRow({ entry, index, count: c.order.length, isShown: !c.hidden.includes(entry), isMain: entry === firstShown }));
    return dialogSection({ id: "suggest", title: "Suggest, in this order", children: [v_flex().gap(2).children(rows), ...this.addRows()] });
  }

  // Where its runs go and what it suggests once an agent is done.
  runSection() {
    const { tab, situation } = this.editor;
    const options = WHERE_OPTIONS[tab];
    const current = getCaseRun({ skills: this.skills, tab, situation });
    const actions = getCaseActions({ skills: this.skills, tab, situation });
    const afterDoneOptions = [
      { value: AFTER_DONE_MAIN, label: "Its main action" },
      ...actions.map((name) => ({ value: name, label: entryShort(name) })),
      { value: AFTER_DONE_NOTHING, label: "Nothing" },
    ];
    const afterDoneValue = current.afterDone ?? AFTER_DONE_MAIN;
    const handleOpen = this.handleOpenSelect.bind(this);
    return dialogSection({
      id: "run", title: "Run",
      children: [
        controlRow({
          id: "case-where", label: "Where", help: WHERE_HELP[tab],
          control: selectButton({
            id: "case-where", text: options.find((o) => o.value === current.where)?.label ?? "",
            onOpen: ({ anchor }) => handleOpen({ store: WHERE_SELECT, title: "Where", value: current.where, options, anchor }),
          }),
        }),
        controlRow({
          id: "case-after-done", label: "After done, suggest next",
          control: selectButton({
            id: "case-after-done", text: afterDoneOptions.find((o) => o.value === afterDoneValue)?.label ?? "",
            onOpen: ({ anchor }) => handleOpen({ store: AFTER_DONE_SELECT, title: "After done", value: afterDoneValue, options: afterDoneOptions, anchor }),
          }),
        }),
      ],
    });
  }

  // A rule: "If a check with lint fails", then its action (a select), and × to remove it.
  /** @param {import("./settings.js").CaseRule} rule */
  ruleRow(rule) {
    const t = theme();
    const { tab, situation } = this.editor;
    const store = `${RULE_THEN_SELECT}|${rule.id}`;
    return holderStrip({
      id: `case-rule-${rule.id}`, tone: "neutral", iconName: "filter",
      body: div().truncate().text_size(12.5).text_color(t.foreground).child(formatRule(rule.when)),
      trailing: h_flex().gap(4).items_center()
        .child(div().text_size(11.5).text_color(t.dim).child("then"))
        .child(selectButton({
          id: `case-rule-then-${rule.id}`, text: entryShort(rule.then),
          onOpen: ({ anchor }) => this.handleOpenSelect({ store, title: "Then", value: rule.then, options: this.getRuleActions(), anchor }),
        }))
        .child(div().id(`case-rule-remove-${rule.id}`).size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
          .text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip("Remove this rule")
          .on_click((_e, cx) => {
            this.openSelects.delete(store);
            this.save(removeCaseRule({ skills: this.skills, tab, situation, id: rule.id }));
            cx.notify();
          })
          .child(svg(icon("x")).size(12))),
    });
  }

  // "+ Add a rule", or its form: the kind, its value (a priority: a select), the action, Add and Cancel.
  ruleForm() {
    const t = theme();
    const { tab } = this.editor;
    if (!this.isAddingRule) {
      return [h_flex().id("case-rule-add").h(ENTRY_ROW_HEIGHT - 2).flex_none().px(6).items_center().rounded(5).cursor_pointer().text_size(12.5)
        .text_color(t.accent).hover((st) => st.bg(t.hover))
        .on_click((_e, cx) => { this.isAddingRule = true; this.ruleInput.focus(); cx.notify(); })
        .child(tab === "github" ? "+ Add a rule (failing check name, label, author, size)" : "+ Add a rule (label, priority)")];
    }
    const { kind, priority, then } = this.ruleDraft;
    const kindOptions = RULE_KINDS[tab].map((k) => ({ value: k, label: RULE_KIND_LABEL[k] }));
    const priorityOptions = PRIORITY_OPTIONS.map((p) => ({ value: String(p.value), label: p.label }));
    const value = kind === "priority"
      ? selectButton({
        id: "case-rule-priority", text: priorityOptions.find((o) => o.value === priority)?.label ?? "",
        onOpen: ({ anchor }) => this.handleOpenSelect({ store: RULE_DRAFT_PRIORITY_SELECT, title: "Priority", value: priority, options: priorityOptions, anchor }),
      })
      : div().flex_1().min_w(0).child(fieldBox({ id: "case-rule-value", isFocused: true, input: Input.new(this.ruleInput).flex_1().text_size(12).text_color(t.foreground) }));
    return [
      h_flex().h(CONTROL_ROW_HEIGHT).flex_none().gap(6).items_center()
        .child(selectButton({
          id: "case-rule-kind", text: RULE_KIND_LABEL[kind],
          onOpen: ({ anchor }) => this.handleOpenSelect({ store: RULE_DRAFT_KIND_SELECT, title: "If", value: kind, options: kindOptions, anchor }),
        }))
        .child(value),
      h_flex().h(CONTROL_ROW_HEIGHT).flex_none().gap(6).items_center()
        .child(div().text_size(12).text_color(t.dim).child("then"))
        .child(selectButton({
          id: "case-rule-then", text: then ? entryShort(then) : "Pick an action",
          onOpen: ({ anchor }) => this.handleOpenSelect({ store: RULE_DRAFT_THEN_SELECT, title: "Then", value: then, options: this.getRuleActions(), anchor }),
        }))
        .child(div().flex_1())
        .child(button({ id: "case-rule-cancel", label: "Cancel", variant: "ghost", onClick: () => this.closeRuleForm() }))
        .child(button({ id: "case-rule-save", label: "Add", variant: "primary", onClick: (cx) => this.handleAddRule(cx) })),
      div().px(2).text_size(11.5).text_color(this.isRuleRefused ? palette(t).danger : t.dim)
        .child(this.isRuleRefused ? "A rule needs a value (a size: a number above 0) and an action." : RULE_EXAMPLE[kind]),
    ];
  }

  // The case's rules, first that fits a row picks its main action, then the add form.
  narrowSection() {
    const { tab, situation } = this.editor;
    const rules = this.skills[tab].cases[situation]?.rules ?? [];
    return dialogSection({
      id: "narrow", title: "Narrow it",
      children: [v_flex().gap(3).children(rules.map((rule) => this.ruleRow(rule))), ...this.ruleForm()],
    });
  }

  // A GitHub or Linear row's button, from where the case runs its skill (a link entry: its link).
  /** @param {{ preview: CasePreview, skill: string | null, caseWhere: CaseWhere }} params */
  previewAction({ preview, skill, caseWhere }) {
    const { tab } = this.editor;
    const { place, isBackground } = skill && !isLinkEntry(skill)
      ? getCaseRunPlace({
        caseWhere, where: this.getSettings().whereToRun, role: this.getRole(skill), hasWorktreeTarget: preview.hasWorktreeTarget,
        hasWorktree: preview.hasWorktree, isBackgroundDefault: tab === "github",
      })
      : { place: /** @type {const} */ ("here"), isBackground: false };
    return getRowAction({
      isPreparing: false, agent: null, spaceName: null, isMergeReady: preview.isMergeReady, skill, link: OPEN_LINK[tab], place, isBackground,
      target: { label: preview.targetLabel }, links: preview.source?.kind === "pullRequest" ? preview.source.links : [],
    });
  }

  // A real row of the case with the button it gets from the case as set now.
  previewSection() {
    const t = theme();
    const { tab, situation, preview } = this.editor;
    if (!preview) return dialogSection({ id: "preview", title: "Preview", children: [div().text_size(12).text_color(t.dim).child("No rows match right now")] });
    const skills = this.getRowSkills();
    const skill = getPreviewActions({ source: preview.source, skills })?.main ?? (preview.source ? null : getDefaultSkill({ skills, tab, situation }));
    const caseRun = getCaseRun({ skills, tab, situation });
    const action = preview.oncall
      ? getOncallRowAction({ situation, isTriaging: false, agent: null, skill, ...preview.oncall })
      : this.previewAction({ preview, skill, caseWhere: caseRun.where });
    const look = splitButtonLook({ t, style: action.style });
    const resultButton = h_flex().h(SPLIT_BUTTON_HEIGHT).flex_none().items_center().rounded(6).overflow_hidden()
      .bg(look.bg).border(1).border_color(look.border).text_size(12).font_medium().text_color(look.text).tooltip(action.tip)
      .child(h_flex().h_full().px(8).gap(5).items_center().child(svg(icon(action.icon)).size(11).flex_none()).child(action.label))
      .child(div().w(1).h_full().bg(look.divider))
      .child(div().h_full().px(5).flex().items_center().child(svg(icon("chevron")).size(12)));
    return dialogSection({
      id: "preview", title: "Preview",
      children: [holderStrip({
        id: "case-preview", tone: preview.holder.tone, iconName: preview.holder.icon,
        body: v_flex().gap(2)
          .child(div().truncate().text_size(13).font_medium().text_color(t.foreground).child(preview.title))
          .child(div().truncate().text_size(11.5).text_color(t.dim).child(preview.meta)),
        trailing: resultButton,
      })],
    });
  }

  footer() {
    const { tab, situation } = this.editor;
    return dialogFooter({
      left: button({ id: "case-reset", label: "Reset to default", variant: "ghost", onClick: () => this.handleReset() }),
      buttons: [button({ id: "case-done", label: "Done", variant: "primary", onClick: () => closeOverlay(props().overlay) })],
    });
  }

  render() {
    const t = theme();
    // A dragged entry drops on release over an entry row (it handles it first); anywhere else cancels.
    return v_flex().id("case-editor").size_full().min_h(0).rounded(8).overflow_hidden().bg(t.popover).text_color(t.foreground)
      .on_mouse_up("left", (_e, cx) => this.cancelDrag(cx))
      .child(this.header())
      .child(v_flex().id("case-editor-body").flex_1().min_h(0).overflow_y_scrollbar()
        .child(this.suggestSection())
        .when(RULE_KINDS[this.editor.tab].length > 0, (el) => el.child(this.narrowSection()))
        .child(this.runSection())
        .child(this.previewSection()))
      .child(this.footer());
  }
}

// The settings' case strips: holder in the case's tone, its name, chips of its actions (the main
// one filled, wrapping onto more lines on a long case) and how many rows match now. Clicking one opens the case editor.
/**
 * @param {{ tab: Tab, skills: Skills, getMatches: (params: { tab: Tab, situation: Situation }) => CaseEditorProps["matches"],
 *   onOpen: (params: { tab: Tab, situation: Situation }) => void }} params
 */
export const caseStrips = ({ tab, skills, getMatches, onOpen }) => SITUATIONS[tab].map((sit) => {
  const t = theme();
  const look = getCaseLook(sit.id);
  const actions = getCaseActions({ skills, tab, situation: sit.id });
  const main = getDefaultSkill({ skills, tab, situation: sit.id });
  const chips = main ? actions : [];
  const matches = getMatches({ tab, situation: sit.id });
  return holderStrip({
    id: `case-${tab}-${sit.id}`, tone: look.tone, iconName: look.icon, onClick: () => onOpen({ tab, situation: sit.id }),
    body: v_flex().gap(4)
      .child(div().truncate().text_size(12.5).text_color(t.foreground).child(sit.label))
      .child(h_flex().flex_wrap().gap(4).items_center()
        .children(chips.map((name) => actionChip({ id: `case-chip-${tab}-${sit.id}-${name}`, label: entryShort(name), isMain: name === main })))
        .when(!main, (el) => el.child(actionChip({ id: `case-chip-${tab}-${sit.id}-open`, label: OPENS[tab], isMain: false })))),
    trailing: h_flex().gap(4).items_center().text_size(11.5).text_color(t.dim)
      .when(matches !== null, (el) => el.child(div().font_family(MONO_FONT).child(formatMatchCount(matches))))
      .child(svg(icon("chevron-right")).size(11)),
  });
});

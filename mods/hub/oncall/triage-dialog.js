// The On-call triage dialog: the hub mod opened as a dialog (props().dialog === ONCALL_TRIAGE_DIALOG)
// from the tab's Triage button. Paste any link (a Sentry issue, a Slack thread, a doc), add a note,
// pick a skill, and it starts in a new Claude tab in the On-call code folder.
import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { theme, props, openOverlay, closeOverlay, shared, setShared, run, spaces, appHome } from "herdr";
import { stop } from "../ui.js";
import { button, dialogHeader, dialogSection, dialogFooter, fieldBox, selectButton } from "../controls.js";
import { loadInstalledSkills, loadRepoSkills } from "../actions.js";
import { BUILT_IN_TRIAGE_SKILL } from "./config.js";
import { buildTriagePrompt, getTriageTabName } from "./decisions.js";
import { loadOncallConfig } from "./client.js";

export const ONCALL_TRIAGE_DIALOG = "oncall-triage";
// The skill select's pick, read back on every render.
const SKILL_SELECT = "hub.oncall.manualTriageSkill";
const DIALOG_SIZE = { width: 520, height: 318 };
const FIELD_LABEL_WIDTH = 64;
const NOTE_HEIGHT = 96;

export const openOncallTriageDialog = () => openOverlay({ mod: "hub", kind: "dialog", ...DIALOG_SIZE, props: { dialog: ONCALL_TRIAGE_DIALOG } });

// The bundled skill is not in ~/.claude/skills, so Claude reads it as a file.
const getBuiltInSkillPath = () => `${appHome()}/mods/hub/oncall/skills/${BUILT_IN_TRIAGE_SKILL}/SKILL.md`;

/** @typedef {(params: { store: string, title: string, value: string, options: { value: string, label: string }[], anchor?: import("../ui.js").Anchor | null }) => void} OpenSelect */

export class OncallTriageDialog {
  /** @param {{ cx: import("gpui-kit").Context, openSelect: OpenSelect }} params */
  constructor({ cx, openSelect }) {
    this.openSelect = openSelect;
    /** @type {"loading" | "ready"} */
    this.status = "loading";
    /** @type {string | null} */
    this.claudePath = null;
    /** @type {string | null} */
    this.codeFolder = null;
    this.defaultSkill = BUILT_IN_TRIAGE_SKILL;
    /** @type {string[]} */
    this.skills = [BUILT_IN_TRIAGE_SKILL];
    this.isNoteFocused = false;
    this.link = InputState.new({ placeholder: "A Sentry issue, a Slack thread, any link" });
    this.link.on("change", (_e, cx) => cx.notify());
    this.link.on("submit", (_e, cx) => this.handleSubmit(cx));
    this.note = TextareaState.new({ placeholder: "Anything to add: what you saw, where, what to look at first" });
    this.note.on("change", (_e, cx) => cx.notify());
    this.note.on("focus", (_e, cx) => { this.isNoteFocused = true; cx.notify(); });
    this.note.on("blur", (_e, cx) => { this.isNoteFocused = false; cx.notify(); });
    this.link.focus();
    cx.spawn(async (cx) => {
      const [config, installed] = await Promise.all([loadOncallConfig(), loadInstalledSkills()]);
      const repo = await loadRepoSkills({ folder: config.codeFolder });
      this.claudePath = config.claudePath ?? null;
      this.codeFolder = config.codeFolder ?? null;
      this.defaultSkill = config.triageSkill;
      this.skills = [...new Set([BUILT_IN_TRIAGE_SKILL, config.triageSkill, ...(repo ?? []), ...(installed ?? [])])];
      setShared(SKILL_SELECT, { value: config.triageSkill });
      this.status = "ready";
      cx.notify();
    });
  }

  // The select's pick, else the configured triage skill.
  get skill() {
    const saved = shared(SKILL_SELECT);
    const value = saved && typeof saved === "object" && "value" in saved ? saved.value : null;
    return typeof value === "string" && this.skills.includes(value) ? value : this.defaultSkill;
  }

  get canSubmit() {
    return this.status === "ready" && (this.link.value().trim() !== "" || this.note.value().trim() !== "");
  }

  // A new Claude tab in front, in the code folder (else where Herdr starts tabs), running the skill.
  /** @param {import("gpui-kit").Context} _cx */
  handleSubmit(_cx) {
    if (!this.canSubmit) return;
    const skill = this.skill;
    const link = this.link.value();
    const prompt = buildTriagePrompt({ skill, link, note: this.note.value(), builtInPath: skill === BUILT_IN_TRIAGE_SKILL ? getBuiltInSkillPath() : null });
    const space = spaces().find((sp) => sp.active)?.id;
    run("tab.new", {
      name: getTriageTabName(link), argv: [this.claudePath ?? "claude", prompt], focus: true,
      ...(space ? { space } : {}), ...(this.codeFolder ? { folder: this.codeFolder } : {}),
    });
    closeOverlay(props().overlay);
  }

  /** @param {import("../ui.js").Anchor | null} anchor */
  handleOpenSkills(anchor) {
    const options = this.skills.map((skill) => ({ value: skill, label: skill === BUILT_IN_TRIAGE_SKILL ? `${skill} · default` : skill }));
    this.openSelect({ store: SKILL_SELECT, title: "Skill", value: this.skill, options, anchor });
  }

  render() {
    const t = theme();
    /** @param {{ label: string, control: import("gpui-kit").Element, isTop?: boolean }} params */
    const field = ({ label, control, isTop = false }) => h_flex().gap(8).when(isTop, (el) => el.items_start()).when(!isTop, (el) => el.items_center())
      .child(div().w(FIELD_LABEL_WIDTH).flex_none().when(isTop, (el) => el.pt(7)).text_size(12).text_color(t.dim).child(label))
      .child(div().flex_1().min_w(0).child(control));
    const note = div().id("oncall-triage-note").h(NOTE_HEIGHT).rounded(6).border(1).border_color(this.isNoteFocused ? t.accent : t.input).px(8).py(6).bg(t.background)
      .overflow_y_scrollbar().on_mouse_down("left", stop)
      .child(Textarea.new(this.note).w_full().h_full().text_size(12).text_color(t.foreground));
    return v_flex().id("oncall-triage-dialog").size_full().min_h(0).rounded(8).overflow_hidden().bg(t.popover).text_color(t.foreground)
      .child(dialogHeader({ tone: "neutral", iconName: "oncall", title: "Triage", subtitle: "Paste a link and add a note. The skill starts in a new Claude tab." }))
      .child(v_flex().flex_1().min_h(0)
        .child(dialogSection({
          id: "oncall-triage-fields",
          children: [
            v_flex().gap(8)
              .child(field({ label: "Link", control: fieldBox({ id: "oncall-triage-link", isFocused: !this.isNoteFocused, iconName: "link", input: Input.new(this.link).flex_1().text_size(12).text_color(t.foreground) }) }))
              .child(field({ label: "Note", control: note, isTop: true }))
              .child(field({ label: "Skill", control: h_flex().child(selectButton({ id: "oncall-triage-skill", text: this.skill, onOpen: ({ anchor }) => this.handleOpenSkills(anchor) })) })),
          ],
        })))
      .child(dialogFooter({
        left: div().truncate().text_size(11.5).text_color(t.dim).child(this.status === "loading" ? "Loading skills…" : "↵ in the link starts it · Esc to close"),
        buttons: [
          button({ id: "oncall-triage-cancel", label: "Cancel", onClick: () => closeOverlay(props().overlay) }),
          button({ id: "oncall-triage-submit", label: "Start", variant: this.canSubmit ? "primary" : "normal", onClick: this.canSubmit ? (cx) => this.handleSubmit(cx) : null }),
        ],
      }));
  }
}

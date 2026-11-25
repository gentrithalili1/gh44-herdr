// "Save current filters": the hub mod opened as a popup (props().saveFilters) with a name box.
// Enter or Save keeps the tab's filters under that name, one click away in the scope picker.
// With editId it renames that saved set instead.
import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, shared, setShared, props, closeOverlay } from "herdr";
import { stop, palette } from "./ui.js";
import { SAVED_FILTERS_STORE, saveFilterSet, renameFilterSet, MAX_SET_NAME } from "./saved-filters.js";

export const SAVE_POPUP_SIZE = { width: 300, height: 96 };

/** @typedef {{ tab: import("./settings.js").Tab, filters: Record<string, unknown>, name: string, editId?: string }} SaveFiltersProps */

export class FilterSavePopup {
  /** @param {{ request: SaveFiltersProps }} params */
  constructor({ request }) {
    this.request = request;
    this.input = InputState.new({ placeholder: "Name these filters" });
    this.input.set_value(request.name.slice(0, MAX_SET_NAME));
    this.input.on("change", (_e, cx) => cx.notify());
    this.input.on("submit", (_e, cx) => { this.handleSave(); cx.notify(); });
    /** @type {string | null} */
    this.error = null;
    this.input.focus();
  }

  handleSave() {
    const name = this.input.value().trim();
    if (!name) return;
    const { tab, filters, editId } = this.request;
    const saved = shared(SAVED_FILTERS_STORE);
    if (editId) {
      const r = renameFilterSet({ saved, tab, id: editId, name });
      if (r.status === "error") {
        this.error = r.reason === "taken" ? "Another saved set has that name" : "That set is gone";
        return;
      }
      setShared(SAVED_FILTERS_STORE, r.saved);
    } else {
      setShared(SAVED_FILTERS_STORE, saveFilterSet({ saved, tab, name, filters, id: `set-${Date.now().toString(36)}` }));
    }
    closeOverlay(props().overlay);
  }

  render() {
    const t = theme();
    const hasName = Boolean(this.input.value().trim());
    return v_flex().id("filter-save").size_full().p(10).gap(8).bg(t.popover).text_size(12.5)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(11.5).font_semibold().text_color(t.muted).child(this.request.editId ? "Rename saved filters" : "Save current filters"))
        .when(Boolean(this.error), (el) => el.child(div().text_size(11).text_color(palette(t).danger).child(this.error ?? ""))))
      .child(h_flex().gap(6).items_center()
        .child(h_flex().flex_1().h(28).px(8).items_center().rounded(6).border(1).border_color(t.accent).bg(t.background).on_mouse_down("left", stop)
          .child(Input.new(this.input).flex_1().text_size(12).text_color(t.foreground)))
        .child(div().id("filter-save-button").h(28).px(12).flex().items_center().rounded(6).text_size(12)
          .bg(t.solid).text_color(t.solid_foreground).opacity(hasName ? 1 : 0.5)
          .when(hasName, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => { this.handleSave(); cx.notify(); }))
          .child("Save")));
  }
}

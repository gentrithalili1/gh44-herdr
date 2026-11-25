// Saved filter sets and the inline chips of the filters in use. Pure, so tests/ can load it.
// A set keeps a tab's scope and filters under a name; the search text is not part of it.

/** @typedef {import("./settings.js").Tab} Tab */
/** @typedef {Record<string, unknown>} Filters */
/** @typedef {{ id: string, name: string, filters: Filters }} FilterSet */
/** @typedef {{ title: string, field: string, isMulti: boolean, options: { value: unknown, label: string }[] }} FilterDef */
/** @typedef {{ field: string, title: string, text: string }} FilterChip */

export const SAVED_FILTERS_STORE = "hub.savedFilters";
export const MAX_SETS_PER_TAB = 20;
export const MAX_SET_NAME = 40;
// A chip names this many values; more read as "any of N".
const CHIP_VALUES_NAMED = 2;

/** @param {unknown} value @returns {Record<string, any>} */
const toRecord = (value) => (value && typeof value === "object" && !Array.isArray(value) ? /** @type {Record<string, any>} */ (value) : {});

// One tab's sets, read safely from what the store holds.
/** @param {{ saved: unknown, tab: Tab }} params @returns {FilterSet[]} */
export function getFilterSets({ saved, tab }) {
  const list = toRecord(saved)[tab];
  if (!Array.isArray(list)) return [];
  return list.map(toRecord).filter((s) => typeof s.id === "string" && typeof s.name === "string" && s.name.trim())
    .map((s) => ({ id: s.id, name: s.name, filters: toRecord(s.filters) }));
}

// Saves the filters under a name: a set with the same name (any case) is replaced in place.
/** @param {{ saved: unknown, tab: Tab, name: string, filters: Filters, id: string }} params @returns {Record<string, unknown>} */
export function saveFilterSet({ saved, tab, name, filters, id }) {
  const title = name.trim().slice(0, MAX_SET_NAME);
  const all = toRecord(saved);
  if (!title) return all;
  const sets = getFilterSets({ saved, tab });
  const same = sets.findIndex((s) => s.name.toLowerCase() === title.toLowerCase());
  const next = same === -1
    ? [...sets, { id, name: title, filters }].slice(-MAX_SETS_PER_TAB)
    : sets.map((s, i) => (i === same ? { ...s, name: title, filters } : s));
  return { ...all, [tab]: next };
}

/** @param {{ saved: unknown, tab: Tab, id: string }} params @returns {Record<string, unknown>} */
export function removeFilterSet({ saved, tab, id }) {
  return { ...toRecord(saved), [tab]: getFilterSets({ saved, tab }).filter((s) => s.id !== id) };
}

// The set whose filters are the ones in use, field by field over the defaults; null when none is.
/** @param {{ sets: FilterSet[], filters: Filters, defaults: Filters }} params @returns {FilterSet | null} */
export function findActiveSet({ sets, filters, defaults }) {
  /** @param {Filters} f */
  const key = (f) => JSON.stringify(Object.keys(defaults).sort().map((k) => [k, k in f ? f[k] : defaults[k]]));
  const current = key(filters);
  return sets.find((s) => key(s.filters) === current) ?? null;
}

// One chip per filter in use: "Team is FE", "Label is any of 3". Fields at their default have none.
/** @param {{ defs: FilterDef[], filters: Filters, defaults: Filters }} params @returns {FilterChip[]} */
export function getFilterChips({ defs, filters, defaults }) {
  return defs.flatMap((def) => {
    const value = filters[def.field];
    /** @param {unknown} v */
    const labelOf = (v) => def.options.find((o) => o.value === v)?.label ?? String(v);
    if (def.isMulti) {
      const values = Array.isArray(value) ? value : [];
      if (values.length === 0) return [];
      const text = values.length <= CHIP_VALUES_NAMED ? values.map(labelOf).join(", ") : `any of ${values.length}`;
      return [{ field: def.field, title: def.title, text }];
    }
    if (value === defaults[def.field]) return [];
    return [{ field: def.field, title: def.title, text: labelOf(value) }];
  });
}

// A name to start from in the save box: the scope and the chips, cut to fit.
/** @param {{ scopeLabel: string, chips: FilterChip[] }} params */
export const suggestSetName = ({ scopeLabel, chips }) => [scopeLabel, ...chips.map((c) => c.text)].filter(Boolean).join(" · ").slice(0, MAX_SET_NAME);

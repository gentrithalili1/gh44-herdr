// Picking several agents: ⌘-click (toggle) adds or takes one out, shift-click (range) takes the
// shown agents from the last click to this one. A selection can span spaces, as a lead's agents do.
// Pure, so tests/ can load it without Herdr.

/** @typedef {{ selected: string[], anchor: string | null }} Selection */

/**
 * shown: the agents in list order.
 * @param {Selection & { shown: { address: string }[], address: string, mode: "toggle" | "range" }} params
 * @returns {Selection}
 */
export const getNextSelection = ({ selected, anchor, shown, address, mode }) => {
  switch (mode) {
    case "toggle":
      return selected.includes(address)
        ? { selected: selected.filter((a) => a !== address), anchor: address }
        : { selected: [...selected, address], anchor: address };
    case "range": {
      const order = shown.map((s) => s.address);
      if (!anchor || !order.includes(anchor) || !order.includes(address)) return { selected: [address], anchor: address };
      const [from, to] = [order.indexOf(anchor), order.indexOf(address)].sort((x, y) => x - y);
      return { selected: order.slice(from, to + 1), anchor };
    }
    default: {
      /** @type {never} */
      const unknownMode = mode;
      return unknownMode;
    }
  }
};

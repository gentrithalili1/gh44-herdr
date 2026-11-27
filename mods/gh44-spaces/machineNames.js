// Names people give machines in the Spaces list (shared("omnia.machine.names"), keyed by the
// machine's name in Herdr, "" for this computer). A named machine keeps its address beside the name.
// Pure, so tests/ can load it without Herdr.

export const MACHINE_NAMES_STORE = "omnia.machine.names";
const LOCAL_KEY = "";
const LOCAL_NAME = "This computer";
const LOCAL_HOST = "this computer";

/** @param {unknown} names @returns {Record<string, string>} */
const readNames = (names) => (names && typeof names === "object" && !Array.isArray(names) ? /** @type {Record<string, string>} */ (names) : {});
/** @param {string | null} machine */
const keyOf = (machine) => machine ?? LOCAL_KEY;

// host: the address shown beside a name someone gave it; null when the name is the address.
/** @param {{ names: unknown, machine: string | null }} params @returns {{ name: string, host: string | null }} */
export const getMachineLabel = ({ names, machine }) => {
  const own = readNames(names)[keyOf(machine)];
  if (typeof own === "string" && own) return { name: own, host: machine ?? LOCAL_HOST };
  return { name: machine ?? LOCAL_NAME, host: null };
};

// An empty name, or the machine's own address, removes the custom name.
/** @param {{ names: unknown, machine: string | null, name: string }} params @returns {Record<string, string>} */
export const setMachineName = ({ names, machine, name }) => {
  const { [keyOf(machine)]: _old, ...rest } = readNames(names);
  const trimmed = name.trim();
  return !trimmed || trimmed === machine ? rest : { ...rest, [keyOf(machine)]: trimmed };
};

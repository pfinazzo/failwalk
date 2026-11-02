import path from "node:path";

/**
 * Where the inventory file is: FAILWALK_INVENTORY, else failwalk-inventory.json in the current folder.
 *
 * @param params.env - usually process.env
 * @returns an absolute path
 */
export const inventoryPath = ({ env }: { env: Record<string, string | undefined> }): string =>
  path.resolve(env.FAILWALK_INVENTORY || "failwalk-inventory.json");

/**
 * Where per-file trace records go: FAILWALK_TRACE_DIR, else `.failwalk/trace` next to the inventory file.
 * Next to the inventory, not in the scanned project, so a run leaves the project untouched.
 *
 * @param params.env - usually process.env
 * @param params.inventoryFile - the resolved inventory path
 * @returns an absolute path
 */
export const traceDirPath = ({ env, inventoryFile }: { env: Record<string, string | undefined>; inventoryFile: string }): string =>
  path.resolve(env.FAILWALK_TRACE_DIR || path.join(path.dirname(inventoryFile), ".failwalk", "trace"));

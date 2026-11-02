import fs from "node:fs";
import type { Inventory } from "../inventory/types";

/**
 * Reads the inventory file the setup file matches against. Synchronous because Jest setup files load synchronously.
 * Throws when the file is missing, naming the path, so a wrong FAILWALK_INVENTORY cannot pass as an empty inventory.
 *
 * @param params.file - path to failwalk-inventory.json
 * @returns the inventory
 */
export const loadInventory = ({ file }: { file: string }): Inventory => {
  if (!fs.existsSync(file)) {
    throw new Error(`failwalk: inventory not found at ${file}. Run "failwalk inventory" first or set FAILWALK_INVENTORY.`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as Inventory;
};

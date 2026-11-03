import fs from "node:fs";
import path from "node:path";
import type { Scene } from "./shape";

/** The page's template, next to this file in dist. The build copies it from src/ui. */
const TEMPLATE_FILE = path.join(__dirname, "template.html");

/** The marker in the template that the scene's JSON replaces. */
const DATA_MARKER = "__FAILWALK_DATA__";

/** The marker in the template that the page title replaces. */
const TITLE_MARKER = "__TITLE__";

/**
 * Writes the scene as JSON that can sit inside a script block: every `<` becomes `<`, so no part of a test name or a file path can end the block early.
 *
 * @param params.scene - the scene
 * @returns JSON text
 */
const toScriptJson = ({ scene }: { scene: Scene }): string => JSON.stringify(scene).replace(/</g, "\\u003c");

/**
 * Escapes text for an HTML title.
 *
 * @param params.text - plain text
 * @returns the text with the four HTML characters escaped
 */
const escapeHtml = ({ text }: { text: string }): string =>
  text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] as string);

/**
 * Fills the template with the scene: one self-contained HTML page. Reads the template from disk.
 *
 * @param params.scene - the scene
 * @returns the page
 */
export const renderPage = ({ scene }: { scene: Scene }): string =>
  fs
    .readFileSync(TEMPLATE_FILE, "utf8")
    .replace(TITLE_MARKER, escapeHtml({ text: `failwalk map · ${path.basename(scene.root)}` }))
    .replace(DATA_MARKER, () => toScriptJson({ scene }));

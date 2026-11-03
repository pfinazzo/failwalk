import fs from "node:fs";
import path from "node:path";
import type { Scene } from "./shape";

/** The page's template, next to this file in dist. The build copies it, the stylesheet and the script parts from src/ui. */
const TEMPLATE_FILE = path.join(__dirname, "template.html");

/** The page's stylesheet, inlined into the template. */
const STYLE_FILE = path.join(__dirname, "page.css");

/** The page's script, in the order the parts run: one inline module script in the page. Each part is small enough to read on its own. */
const SCRIPT_PARTS = ["data", "scene", "panels", "tour", "loop"].map((name) => path.join(__dirname, "page", `${name}.js`));

/** The marker in the template that the scene's JSON replaces. */
const DATA_MARKER = "__FAILWALK_DATA__";

/** The marker in the template that the stylesheet replaces. */
const STYLE_MARKER = "__STYLE__";

/** The marker in the template that the script replaces. */
const SCRIPT_MARKER = "__SCRIPT__";

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
 * Reads one file of the page as text.
 *
 * @param params.file - the path
 * @returns its contents
 */
const readText = ({ file }: { file: string }): string => fs.readFileSync(file, "utf8");

/**
 * Fills the template with the stylesheet, the script and the scene: one self-contained HTML page. Reads the page's files from disk.
 * Every replacement takes a function, so a `$` in the stylesheet or the script is never read as a replacement pattern.
 *
 * @param params.scene - the scene
 * @returns the page
 */
export const renderPage = ({ scene }: { scene: Scene }): string =>
  readText({ file: TEMPLATE_FILE })
    .replace(TITLE_MARKER, () => escapeHtml({ text: `failwalk map · ${path.basename(scene.root)}` }))
    .replace(STYLE_MARKER, () => readText({ file: STYLE_FILE }))
    .replace(SCRIPT_MARKER, () => SCRIPT_PARTS.map((file) => readText({ file })).join("\n"))
    .replace(DATA_MARKER, () => toScriptJson({ scene }));

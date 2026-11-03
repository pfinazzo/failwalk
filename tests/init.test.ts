import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { IGNORED_LINES } from "../src/init/gitignore";
import { findJestBase, renderJestOverride } from "../src/init/jestOverride";
import { pickWrapperFolder, WRAPPER_FOLDERS } from "../src/init/wrapperFolders";
import { makeTempDir, runCli, SAMPLE_API } from "./helpers";
import { copySampleApp, removeCopy, type SampleCopy } from "./proof/walk";

/** A fake setup file path, to see which path the override resolves. */
const FAKE_SETUP = "/somewhere/failwalk/dist/tracer/setup.js";

/**
 * Makes a temp project with the given files, each written relative to its root.
 *
 * @param params.files - path to content
 * @returns the project root
 */
const makeProject = ({ files }: { files: Record<string, string> }): string => {
  const root = makeTempDir({ prefix: "failwalk-init" });
  Object.entries(files).forEach(([file, content]) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  });
  return root;
};

/**
 * Loads a written override the way Jest would, with FAILWALK_SETUP set, and returns the config object it exports.
 *
 * @param params.root - the project root holding jest.failwalk.config.js
 * @returns the exported config
 */
const loadOverride = ({ root }: { root: string }): { setupFilesAfterEnv: string[]; [key: string]: unknown } => {
  const result = spawnSync(process.execPath, ["-e", `process.stdout.write(JSON.stringify(require(${JSON.stringify(path.join(root, "jest.failwalk.config.js"))})))`], {
    encoding: "utf8",
    env: { ...process.env, FAILWALK_SETUP: FAKE_SETUP },
  });
  if (result.status !== 0) throw new Error(`override failed to load: ${result.stderr}`);
  return JSON.parse(result.stdout);
};

/**
 * Reads a file under a project root.
 *
 * @param params.root - the project root
 * @param params.file - the relative path
 * @returns the text
 */
const readFile = ({ root, file }: { root: string; file: string }): string => fs.readFileSync(path.join(root, file), "utf8");

describe("failwalk init writes the override for each kind of Jest config (criterion 2)", () => {
  test("with jest.config.js: loads it and appends the setup file to setupFilesAfterEnv", () => {
    const root = makeProject({ files: { "jest.config.js": "module.exports = { testEnvironment: 'node', setupFilesAfterEnv: ['./own.js'] };", "config/db.js": "" } });
    expect(runCli({ args: ["init"], cwd: root }).status).toBe(0);
    expect(findJestBase({ root })).toEqual({ kind: "file", file: "jest.config.js" });
    expect(loadOverride({ root })).toEqual({ testEnvironment: "node", setupFilesAfterEnv: ["./own.js", FAKE_SETUP] });
  });

  test("with a jest field in package.json: spreads it and appends the setup file", () => {
    const root = makeProject({ files: { "package.json": JSON.stringify({ name: "p", jest: { testEnvironment: "jsdom" } }), "config/db.js": "" } });
    expect(runCli({ args: ["init"], cwd: root }).status).toBe(0);
    expect(findJestBase({ root })).toEqual({ kind: "package" });
    expect(loadOverride({ root })).toEqual({ testEnvironment: "jsdom", setupFilesAfterEnv: [FAKE_SETUP] });
  });

  test("with neither: holds only setupFilesAfterEnv", () => {
    const root = makeProject({ files: { "package.json": JSON.stringify({ name: "p" }), "config/db.js": "" } });
    expect(runCli({ args: ["init"], cwd: root }).status).toBe(0);
    expect(findJestBase({ root })).toEqual({ kind: "none" });
    expect(loadOverride({ root })).toEqual({ setupFilesAfterEnv: [FAKE_SETUP] });
  });

  test("a jest.config.cjs or .mjs is loaded too, the .mjs through its default export", () => {
    expect(renderJestOverride({ base: { kind: "file", file: "jest.config.cjs" } })).toContain('const base = require("./jest.config.cjs");');
    expect(renderJestOverride({ base: { kind: "file", file: "jest.config.mjs" } })).toContain('const base = require("./jest.config.mjs").default;');
  });

  test("the setup file is resolved when Jest loads the override: from FAILWALK_SETUP, else from the installed package, never a fixed path", () => {
    const text = renderJestOverride({ base: { kind: "none" } });
    expect(text).toContain("process.env.FAILWALK_SETUP");
    expect(text).toContain('require.resolve("failwalk/dist/tracer/setup.js")');
    expect(text).not.toMatch(/\/Users\/|\/home\/|__dirname/);
  });
});

describe("failwalk init picks the wrapper folder (criterion 1)", () => {
  test("takes the first folder of the lookup list that exists, and prints which one and why", () => {
    const root = makeProject({ files: { "services/mail.js": "", "src/config/db.js": "" } });
    const result = runCli({ args: ["init"], cwd: root });
    expect(result.status).toBe(0);
    expect(pickWrapperFolder({ root })).toEqual({ folder: "src/config", glob: "src/config/**/*.{js,ts}" });
    expect(JSON.parse(readFile({ root, file: "failwalk.config.json" }))).toEqual({ wrappers: "src/config/**/*.{js,ts}", jestConfig: "jest.failwalk.config.js" });
    expect(result.stdout).toContain("wrappers: src/config/**/*.{js,ts} (src/config is the first folder of");
    expect(WRAPPER_FOLDERS.indexOf("src/config")).toBeLessThan(WRAPPER_FOLDERS.indexOf("services"));
  });

  test("--wrappers wins over the lookup", () => {
    const root = makeProject({ files: { "config/db.js": "" } });
    expect(runCli({ args: ["init", "--wrappers", "vendors/*.ts"], cwd: root }).status).toBe(0);
    expect(JSON.parse(readFile({ root, file: "failwalk.config.json" })).wrappers).toBe("vendors/*.ts");
  });

  test("exits 1 naming --wrappers when no folder of the list exists, and writes nothing", () => {
    const root = makeProject({ files: { "package.json": "{}" } });
    const result = runCli({ args: ["init"], cwd: root });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--wrappers");
    expect(result.stderr).toContain("config, src/config");
    expect(fs.existsSync(path.join(root, "failwalk.config.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, "jest.failwalk.config.js"))).toBe(false);
  });
});

describe("failwalk init refuses to overwrite, and --force replaces (criterion 3)", () => {
  test("a second init exits 1 naming the files that exist and --force, leaving them as they were", () => {
    const root = makeProject({ files: { "config/db.js": "" } });
    expect(runCli({ args: ["init"], cwd: root }).status).toBe(0);
    fs.writeFileSync(path.join(root, "failwalk.config.json"), "{ \"wrappers\": \"kept\", \"jestConfig\": \"kept.js\" }\n");
    const result = runCli({ args: ["init"], cwd: root });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("failwalk.config.json and jest.failwalk.config.js already exist");
    expect(result.stderr).toContain("--force replaces them");
    expect(readFile({ root, file: "failwalk.config.json" })).toContain("kept");
  });

  test("names just the one file when only one exists", () => {
    const root = makeProject({ files: { "config/db.js": "", "jest.failwalk.config.js": "module.exports = {};" } });
    const result = runCli({ args: ["init"], cwd: root });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("jest.failwalk.config.js already exists");
    expect(result.stderr).toContain("--force replaces it");
  });

  test("--force rewrites both files", () => {
    const root = makeProject({ files: { "config/db.js": "" } });
    expect(runCli({ args: ["init"], cwd: root }).status).toBe(0);
    fs.writeFileSync(path.join(root, "failwalk.config.json"), "{}");
    fs.writeFileSync(path.join(root, "jest.failwalk.config.js"), "");
    expect(runCli({ args: ["init", "--force"], cwd: root }).status).toBe(0);
    expect(JSON.parse(readFile({ root, file: "failwalk.config.json" })).wrappers).toBe("config/**/*.{js,ts}");
    expect(readFile({ root, file: "jest.failwalk.config.js" })).toContain("setupFilesAfterEnv");
  });
});

describe("failwalk init adds the .gitignore lines once (criterion 3)", () => {
  test("creates .gitignore with the two lines when there is none", () => {
    const root = makeProject({ files: { "config/db.js": "" } });
    expect(runCli({ args: ["init"], cwd: root }).status).toBe(0);
    expect(readFile({ root, file: ".gitignore" })).toBe(".failwalk/\nfailwalk-ui.html\n");
  });

  test("appends to an existing .gitignore, keeping its lines, and a second init adds nothing", () => {
    const root = makeProject({ files: { "config/db.js": "", ".gitignore": "node_modules/\nfailwalk-ui.html" } });
    const first = runCli({ args: ["init"], cwd: root });
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("added .failwalk/ to .gitignore");
    expect(readFile({ root, file: ".gitignore" })).toBe("node_modules/\nfailwalk-ui.html\n.failwalk/\n");
    const second = runCli({ args: ["init", "--force"], cwd: root });
    expect(second.status).toBe(0);
    expect(second.stdout).toContain(".gitignore already lists .failwalk/ and failwalk-ui.html");
    expect(readFile({ root, file: ".gitignore" })).toBe("node_modules/\nfailwalk-ui.html\n.failwalk/\n");
    expect(IGNORED_LINES).toEqual([".failwalk/", "failwalk-ui.html"]);
  });
});

describe("the bare failwalk command (criterion 4)", () => {
  test("exits 1 with one line saying to run failwalk init when there is no failwalk.config.json", () => {
    const root = makeProject({ files: { "config/db.js": "" } });
    const result = runCli({ args: ["--no-open"], cwd: root });
    expect(result.status).toBe(1);
    expect(result.stderr.trimEnd().split("\n")).toHaveLength(1);
    expect(result.stderr).toMatch(/no failwalk\.config\.json in .*\. Run "failwalk init" first\./);
    expect(result.stdout).toBe("");
  });

  test("--version prints the version from package.json", () => {
    const { version } = JSON.parse(fs.readFileSync(path.join(SAMPLE_API, "..", "..", "package.json"), "utf8"));
    expect(runCli({ args: ["--version"], cwd: SAMPLE_API }).stdout.trim()).toBe(version);
  });
});

describe("init then the bare command on a copy of the sample app (criteria 4 and 7)", () => {
  /** A fresh copy of the sample app, walked once by the bare command. */
  let copy: SampleCopy;
  let walk: { status: number | null; stdout: string; stderr: string };

  beforeAll(() => {
    copy = copySampleApp();
    // The copy must start as a checkout does: no init files, and none of the output a run in the repo may have left.
    ["failwalk.config.json", "jest.failwalk.config.js", "failwalk-ui.html"].forEach((file) => fs.rmSync(path.join(copy.root, file), { force: true }));
    fs.rmSync(path.join(copy.root, ".failwalk"), { recursive: true, force: true });
    const init = runCli({ args: ["init"], cwd: copy.root });
    if (init.status !== 0) throw new Error(`init failed: ${init.stderr}`);
    // Two runners, not four: this walk shares the machine with the run test's walk and the proof's four, all at once.
    walk = runCli({ args: ["--no-open", "--test-timeout-ms", "2000", "--concurrency", "2"], cwd: copy.root });
  }, 120_000);

  afterAll(() => removeCopy({ copy }));

  test("init writes the same override and config the sample app has committed", () => {
    expect(readFile({ root: copy.root, file: "jest.failwalk.config.js" })).toBe(fs.readFileSync(path.join(SAMPLE_API, "jest.failwalk.config.js"), "utf8"));
    expect(readFile({ root: copy.root, file: "failwalk.config.json" })).toBe(fs.readFileSync(path.join(SAMPLE_API, "failwalk.config.json"), "utf8"));
  });

  test("runs the whole grid, writes every file under .failwalk/, the page in the root, and the headline last", () => {
    expect(walk.status).toBe(0);
    ["failwalk-inventory.json", "failwalk-trace.json", "failwalk-plan.json", "failwalk.json"].forEach((name) => expect(fs.existsSync(path.join(copy.root, ".failwalk", name))).toBe(true));
    expect(fs.existsSync(path.join(copy.root, ".failwalk", "baseline"))).toBe(true);
    expect(fs.existsSync(path.join(copy.root, ".failwalk", "cells"))).toBe(true);
    expect(fs.existsSync(path.join(copy.root, "failwalk-ui.html"))).toBe(true);
    expect(fs.existsSync(path.join(copy.root, "failwalk.json"))).toBe(false);
    const lines = walk.stdout.trimEnd().split("\n");
    expect(lines.at(-1)).toMatch(/^failwalk: 15 call sites, 6 modes, 90 cells\. \d+ covered \(\d+%\)\. \d+ CRASH, \d+ HANG, \d+ FAIL, \d+ RISK, 18 UNREACHED\.$/);
    expect(walk.stderr).toContain(`map: ${path.join(copy.root, "failwalk-ui.html")}`);
    const report = JSON.parse(readFile({ root: copy.root, file: ".failwalk/failwalk.json" })) as { headline: string; cells: unknown[] };
    expect(report.headline).toBe(lines.at(-1));
    expect(report.cells).toHaveLength(90);
    // The page carries the run: its scene JSON holds the same headline and the "run" status, not the grey pre-run page.
    const page = readFile({ root: copy.root, file: "failwalk-ui.html" });
    expect(page).toContain(JSON.stringify(report.headline));
    expect(page).toContain('"status":"run"');
  });
});

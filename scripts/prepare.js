#!/usr/bin/env node
/**
 * The `prepare` script: builds dist, installing the dev dependencies first when they are missing.
 *
 * `npm install -g github:pfinazzo/failwalk` clones the repo and runs `prepare` in the clone before anything is
 * installed there, because npm's inner install inherits the global flag. Without this step `tsc` is not found and
 * the install fails. A plain `npm install` in a checkout already has the dev dependencies, so only the build runs.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

/** The repo root, one folder above this script. */
const ROOT = path.resolve(__dirname, "..");

/** The npm executable, per platform. */
const NPM = { win32: "npm.cmd" }[process.platform] || "npm";

/**
 * Runs one npm command in the repo root with the global flag removed from the environment, and exits with its status when it fails.
 *
 * @param {Object} params
 * @param {string[]} params.args - arguments after `npm`
 */
const runNpm = ({ args }) => {
  const { npm_config_global: _global, npm_config_location: _location, npm_config_prefix: _prefix, ...env } = process.env;
  const result = spawnSync(NPM, args, { cwd: ROOT, stdio: "inherit", env });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

/**
 * Says whether the TypeScript compiler can be found from the repo root.
 *
 * @returns {boolean} true when node_modules holds typescript
 */
const hasTypescript = () => {
  try {
    require.resolve("typescript/package.json", { paths: [ROOT] });
    return true;
  } catch {
    return false;
  }
};

if (!hasTypescript()) runNpm({ args: ["install", "--no-save", "--ignore-scripts", "--include=dev", "--no-audit", "--no-fund"] });
runNpm({ args: ["run", "build"] });

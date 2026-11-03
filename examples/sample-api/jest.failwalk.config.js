/**
 * Jest config override written by `failwalk init`. Loads this project's own Jest config and adds failwalk's tracer.
 * `failwalk` runs the suite with it. To run it by hand:
 *   FAILWALK_SETUP="$(failwalk setup-path)" npx jest --config jest.failwalk.config.js
 */
const base = require("./jest.config.js");

/**
 * Where failwalk's Jest setup file is. The `failwalk` command sets FAILWALK_SETUP for every run it starts.
 * Without it, the file comes from the failwalk package installed in this project.
 */
const setupFile = () => {
  if (process.env.FAILWALK_SETUP) return process.env.FAILWALK_SETUP;
  try {
    return require.resolve("failwalk/dist/tracer/setup.js");
  } catch (error) {
    throw new Error("failwalk: cannot find the setup file. Run the suite through `failwalk`, or install failwalk in this project.", { cause: error });
  }
};

module.exports = { ...base, setupFilesAfterEnv: [...(base.setupFilesAfterEnv || []), setupFile()] };

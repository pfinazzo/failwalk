/**
 * Jest config override that loads failwalk's tracer on top of the app's own config.
 * Run with: npx jest --config jest.failwalk.config.js
 * FAILWALK_SETUP points at failwalk's setup file. The default is the one built in this repo.
 */
const path = require("node:path");
const base = require("./jest.config");

const setupFile = process.env.FAILWALK_SETUP || path.resolve(__dirname, "../../dist/tracer/setup.js");

module.exports = {
  ...base,
  setupFilesAfterEnv: [...(base.setupFilesAfterEnv || []), setupFile],
};

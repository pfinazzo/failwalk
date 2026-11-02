/**
 * The Jest setup file. Load it through `setupFilesAfterEnv` in a config override.
 *
 * On load: reads the inventory, registers a mock for every wrapper module that returns the real
 * module wrapped in a recording proxy, and reads the injection target from the environment.
 * On each wrapper call: records which test reached which call site. When the call site is the
 * injection target, the mode's failure is returned instead of calling the vendor.
 * When the test file ends: writes one trace record into the trace folder.
 */
import path from "node:path";
import { wrapperNameOf } from "../inventory/wrapperName";
import { handleCall } from "./handleCall";
import { readInjection } from "./injection";
import { currentTest, onSuiteEnd } from "./jestHooks";
import { loadInventory } from "./loadInventory";
import { inventoryPath, traceDirPath } from "./paths";
import { traceState } from "./recorder";
import { indexSites } from "./siteIndex";
import { tracerDirs } from "./stack";
import { toTraceRecord, writeTraceRecord } from "./traceFile";
import { wrapExports } from "./wrapExports";

const inventoryFile = inventoryPath({ env: process.env });
const inventory = loadInventory({ file: inventoryFile });
const injection = readInjection({ env: process.env });
const traceDir = traceDirPath({ env: process.env, inventoryFile });
const index = indexSites({ sites: inventory.sites });
const wrapperFiles = new Set(inventory.wrapperFiles.map((file) => path.join(inventory.root, file)));
const selfDirs = tracerDirs({ distDir: __dirname });

/**
 * Registers the recording mock for one wrapper module. The factory runs only when something requires the wrapper.
 *
 * @param params.relativeFile - wrapper path relative to the inventory root
 */
const mockWrapper = ({ relativeFile }: { relativeFile: string }): void => {
  const file = path.join(inventory.root, relativeFile);
  const wrapper = wrapperNameOf({ file: relativeFile, wrapperBase: inventory.wrapperBase });
  jest.doMock(file, () =>
    wrapExports({
      value: jest.requireActual(file),
      onCall: ({ method }) =>
        handleCall({ wrapper, method, root: inventory.root, wrapperFiles, selfDirs, index, injection, test: currentTest() }),
    }),
  );
};

inventory.wrapperFiles.forEach((relativeFile) => mockWrapper({ relativeFile }));

onSuiteEnd({
  flush: () => {
    writeTraceRecord({ traceDir, record: toTraceRecord({ state: traceState, testPath: currentTest().testPath, injection }) });
  },
});

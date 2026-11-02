/** The Jest globals the setup file uses. They exist only when Jest loads the file. */
declare const jest: {
  doMock: (moduleName: string, factory: () => unknown) => void;
  requireActual: (moduleName: string) => unknown;
};
declare const expect: {
  getState: () => { currentTestName?: string; testPath?: string };
};
declare const afterAll: (hook: () => void | Promise<void>) => void;

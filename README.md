# failwalk

Failure-mode coverage for dependency calls.

Line coverage says your code called the billing vendor. It says nothing about what the code does when that call fails. Failwalk finds every place your code calls a vendor or database through a wrapper module, records which tests reach each place, then runs those tests with one failure injected at a time and reports what happened.

This is v1, steps 1 to 3 of the build order in [SPEC.md](SPEC.md): the inventory, the tracer, and one injected failure mode. The grid of every call site against every failure mode comes next.

## What is here

| Piece | What it does |
| --- | --- |
| `failwalk inventory` | Parses your source with Babel and lists every call into a wrapper module as a JSON record. |
| The tracer setup file | Loaded by Jest. Wraps every wrapper function and records which test reached which call site. Writes one record per test file. |
| `failwalk trace` | Merges those records into `failwalk-trace.json` and prints who reached what. |
| `FAILWALK_SITE` + `FAILWALK_MODE=500` | Make exactly one call site reject with a vendor-shaped 500 error. Every other call runs the real wrapper. |
| `examples/sample-api` | A small Express app with three wrapper modules and its own Jest suite. The target for the output below. |

Failwalk runs inside your test suite. It never touches a deployed environment.

## Install

Node 20 or newer. Developed on Node 24.

```bash
npm install
```

```bash
npm run build
```

`npm test` builds, runs failwalk's own tests, then runs the sample app's suite.

## Step 1: inventory

Point it at a project root and a glob for the wrapper modules. Every call through one of those modules becomes a record. Test files are left out: a test calling a wrapper is not a call site that needs protecting.

```bash
node dist/cli.js inventory --root examples/sample-api --wrappers "config/**/*.js"
```

Records go to stdout. The summary goes to stderr. The full inventory, which the tracer reads, goes to `failwalk-inventory.json`.

```
failwalk inventory: 9 call sites in 3 files, 3 of 3 wrappers used
  database                         5
  billing                          3
  mailer                           1
written to /Users/patrickfinazzo/Desktop/dependency-failure-coverage/failwalk-inventory.json
```

Two of the nine records:

```json
{
  "id": "billing.subscriptions.retrieve@controllers/subscriptions.js:12",
  "file": "controllers/subscriptions.js",
  "line": 12,
  "wrapper": "billing",
  "method": "subscriptions.retrieve",
  "kind": "read"
},
{
  "id": "database.update@controllers/subscriptions.js:51",
  "file": "controllers/subscriptions.js",
  "line": 51,
  "wrapper": "database",
  "method": "update",
  "kind": "write"
}
```

How each field is found:

- `wrapper` is the module's path under the wrapper folder. `config/billing.js` is `billing`. `config/db/index.js` would be `db`.
- `method` is the whole member chain after the wrapper: `subscriptions.retrieve` for `billing.subscriptions.retrieve(...)`. A destructured `const { get } = require("../config/database")` gives `get`.
- `line` is the line of the method name, which is the line a stack trace reports.
- `kind` is `read` when the last segment of `method` is a read verb (`get`, `retrieve`, `list`, `find`, `fetch`, `query`, `exists`, and a few more), or starts with one followed by a capital letter (`getUser`). Everything else is `write`, the safer assumption.

The inventory understands `require`, destructured `require`, `require(...).member`, and ES module imports in every form: default, named, renamed and namespace. A local name that shadows an import is not counted.

## Step 2: trace

The tracer is a Jest setup file. Add it through a config override, so the project's own config stays untouched. The sample app's override is [examples/sample-api/jest.failwalk.config.js](examples/sample-api/jest.failwalk.config.js):

```js
const path = require("node:path");
const base = require("./jest.config");

const setupFile = process.env.FAILWALK_SETUP || path.resolve(__dirname, "../../dist/tracer/setup.js");

module.exports = { ...base, setupFilesAfterEnv: [...(base.setupFilesAfterEnv || []), setupFile] };
```

Run the suite with that config from the folder that holds `failwalk-inventory.json`:

```bash
npx jest --config examples/sample-api/jest.failwalk.config.js
```

```
Test Suites: 3 passed, 3 total
Tests:       8 passed, 8 total
```

Without an injection the tracer changes no result. It only records. Each test file writes one record into `.failwalk/trace/`. Merge them:

```bash
node dist/cli.js trace
```

```
failwalk trace: 8 tests in 3 files reached 6 of 9 call sites. 3 UNREACHED, 4 UNINVENTORIED.

billing.invoices.list@controllers/invoices.js:18   2 tests
    __tests__/invoices.test.js › GET /customers/:id/invoices lists the customer's invoices
    __tests__/invoices.test.js › GET /customers/:id/invoices returns an empty list for a customer with no invoices
billing.subscriptions.cancel@controllers/subscriptions.js:33   1 test
    __tests__/subscriptions.test.js › POST /subscriptions/:id/cancel cancels at billing and reports the new status
billing.subscriptions.retrieve@controllers/subscriptions.js:12   2 tests
    __tests__/subscriptions.test.js › GET /subscriptions/:id returns 404 for a subscription billing does not know
    __tests__/subscriptions.test.js › GET /subscriptions/:id syncs the subscription from billing and returns it
database.update@controllers/subscriptions.js:14   1 test
    __tests__/subscriptions.test.js › GET /subscriptions/:id syncs the subscription from billing and returns it
database.update@controllers/subscriptions.js:34   1 test
    __tests__/subscriptions.test.js › POST /subscriptions/:id/cancel cancels at billing and reports the new status
database.update@controllers/subscriptions.js:51   1 test
    __tests__/subscriptions.test.js › POST /subscriptions/:id/view records the view

UNREACHED (no test reaches these):
    database.get@controllers/receipts.js:13
    mailer.send@controllers/receipts.js:15
    database.update@controllers/subscriptions.js:37

UNINVENTORIED (the tracer saw these, the inventory did not):
    database.get at __tests__/database.test.js:12
        __tests__/database.test.js › database wrapper update merges fields into a record
    database.get at __tests__/database.test.js:6
        __tests__/database.test.js › database wrapper reads a missing record as null
    database.update at __tests__/database.test.js:10
        __tests__/database.test.js › database wrapper update merges fields into a record
    database.update at __tests__/database.test.js:11
        __tests__/database.test.js › database wrapper update merges fields into a record
written to /Users/patrickfinazzo/Desktop/dependency-failure-coverage/failwalk-trace.json
```

Reading this:

- **Reached sites** list the tests that got there. These are the tests an injection run will use.
- **UNREACHED** sites have no test. Two are the receipt route, which no test calls. The third is line 37, the database write inside the `catch` of `cancelSubscription`. No test makes the billing cancel fail, so the catch never runs. The injection in step 3 is how that path gets exercised.
- **UNINVENTORIED** calls were made by the tests themselves. The inventory skips test files, the tracer does not. A call the tracer sees but the inventory does not is always reported, never dropped. Each one carries its file and line.

`failwalk-trace.json` holds the same data as JSON: `tests` (each test and the site ids it reached), `sites` (each id and the tests that reached it), `unreached`, `UNINVENTORIED` and `injection`.

How matching works: every wrapped method captures a stack trace when called. The first frame outside `node_modules`, outside the tracer, and outside the wrapper files is the caller. Its file and line, after Jest's source-map resolution, are looked up in the inventory. On a line with several sites, the one with the same wrapper and method wins.

## Step 3: one injected failure

Pick a reached call site and set two environment variables. The tracer makes that one site reject with a vendor-shaped 500 error. The same wrapper method called from any other line keeps running for real.

The chosen site is line 51 of `controllers/subscriptions.js`, where `recordView` writes to the database without awaiting the promise:

```js
const recordView = ({ subscriptionId }) => {
  database.update({ path: `subscriptions/${subscriptionId}`, value: { viewed_at: Date.now() } });
  return { recorded: true };
};
```

Baseline, no injection:

```bash
npx jest --config examples/sample-api/jest.config.js subscriptions
```

```
Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
```

The same tests with the 500 injected at that site:

```bash
FAILWALK_SITE="database.update@controllers/subscriptions.js:51" FAILWALK_MODE=500 npx jest --config examples/sample-api/jest.failwalk.config.js subscriptions
```

```
FAIL examples/sample-api/__tests__/subscriptions.test.js
  ● POST /subscriptions/:id/view › records the view

    FailwalkInjectedError: database.update failed with HTTP 500 (injected by failwalk at database.update@controllers/subscriptions.js:51)

      at update (controllers/subscriptions.js:51:12)
      at recordView (app.js:24:60)

Test Suites: 1 failed, 1 total
Tests:       1 failed, 3 passed, 4 total
```

| Cell | Mode | Result |
| --- | --- | --- |
| `database.update@controllers/subscriptions.js:51` | 500 | **CRASH** |

This is a CRASH, not a FAIL. No assertion failed. The route answered 200 and the test's expectations all held. The injected error surfaced on its own as an unhandled rejection, which Jest pinned on the test that was running. In production, nothing would catch it. The trace record for the run shows the injection fired exactly once:

```json
"injection": {
  "site": "database.update@controllers/subscriptions.js:51",
  "mode": "500",
  "fired": 1
}
```

For contrast, the same mode at line 33, the billing cancel inside a `try/catch`:

```bash
FAILWALK_SITE="billing.subscriptions.cancel@controllers/subscriptions.js:33" FAILWALK_MODE=500 npx jest --config examples/sample-api/jest.failwalk.config.js subscriptions
```

```
  ● POST /subscriptions/:id/cancel › cancels at billing and reports the new status

    expect(received).toBe(expected) // Object.is equality

    Expected: 200
    Received: 202
```

| Cell | Mode | Result |
| --- | --- | --- |
| `billing.subscriptions.cancel@controllers/subscriptions.js:33` | 500 | **FAIL** |

A FAIL is the good outcome. The code noticed the vendor failure, marked the record `cancel_pending`, answered 202, and a test caught the difference. The two outcomes are told apart by what Jest reports: an assertion failure is FAIL, the injected error itself is CRASH.

One more contrast, at line 18 inside the retry loop of `listInvoices`: the injection fires on every attempt, three per test, six in all, and the route answers 502. The spec's verdict table and the automatic classification arrive with step 4.

## Using it on your own project

1. Build failwalk: `npm install && npm run build`.
2. From a folder of your choice, run the inventory with `--root <your project>` and `--wrappers <glob of your wrapper modules>`. The output file `failwalk-inventory.json` lands in the current folder.
3. Add a Jest config override next to your project's config that appends the setup file to `setupFilesAfterEnv`. `node dist/cli.js setup-path` prints the file's path.
4. Run your suite with that override from the same folder as the inventory file, or set `FAILWALK_INVENTORY` to its path. The tracer writes to `.failwalk/trace/` beside the inventory file, or to `FAILWALK_TRACE_DIR`. Your project's folder is never written to.
5. Run `node dist/cli.js trace`.
6. To inject, set `FAILWALK_SITE` to an id from the inventory and `FAILWALK_MODE=500`, and run only the tests that reached that site.

If a test mocks the whole wrapper with `jest.mock`, the mock replaces the tracer's wrapped module for that test file. The real method is never entered, so nothing is recorded and nothing is injected. The spec calls that cell MOCKED; detecting it is part of step 4.

## Limits of v1

- Jest only. The setup file uses `jest.doMock`, `expect.getState()` and `afterAll`. Under `setupFiles` instead of `setupFilesAfterEnv`, test names are unavailable and the record is written when the worker exits.
- One failure mode, `500`. The others in the spec's table come with the plan stage.
- Wrapper exports are wrapped four member levels deep. A property that is both non-writable and non-configurable is left alone, because a Proxy must return it unchanged.
- The inventory sees calls whose callee is an import or a member chain on one. A wrapper method passed around as a value and called later is reported by the tracer as UNINVENTORIED at the line that called it.

## Development

```bash
npm test
```

That builds, runs 39 tests against `examples/sample-api` and a small ES-module fixture, then runs the sample app's own 8 tests.

This repo uses claimcheck, a verification ledger for AI-written diffs. The frozen acceptance criteria are in `.claimcheck/tasks/v1-inventory-tracer/spec.md`, and the claims made about this change are in `claims.yaml` beside it.

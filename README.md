# failwalk

Failure-mode coverage for dependency calls.

Line coverage says your code called the billing vendor. It says nothing about what the code does when that call fails. Failwalk finds every place your code calls a vendor or database through a wrapper module, records which tests reach each place, then runs those tests with one failure injected at a time and reports what happened.

This is v1, steps 1 to 4 of the build order in [SPEC.md](SPEC.md): the inventory, the tracer, the failure-mode table, and the grid of every call site against every failure mode, filled by one command. The static checks that turn a PASS into a RISK come next.

## What is here

| Piece | What it does |
| --- | --- |
| `failwalk inventory` | Parses your source with Babel and lists every call into a wrapper module as a JSON record. |
| The tracer setup file | Loaded by Jest. Wraps every wrapper function and records which test reached which call site. Writes one record per test file. |
| `failwalk trace` | Merges those records into `failwalk-trace.json` and prints who reached what. |
| `FAILWALK_SITE` + `FAILWALK_MODE` | Make exactly one call site fail the way one row of the mode table says. Every other call runs the real wrapper. |
| The mode table | Six failure modes: `timeout`, `dropped`, `500`, `429`, `malformed`, `partial`. |
| `failwalk plan` | Builds one cell per (call site, mode) from the inventory and the trace, with the tests to run for each. |
| `failwalk run` | Inventory, traced baseline, plan, then one runner process per cell through a bounded pool, a verdict per cell, `failwalk.json` and the terminal grid. |
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

To see the whole thing at once:

```bash
node dist/cli.js run --root examples/sample-api --wrappers "config/**/*.js"
```

The steps below show what each stage does on its own.

## Step 1: inventory

Point it at a project root and a glob for the wrapper modules. Every call through one of those modules becomes a record. Test files are left out: a test calling a wrapper is not a call site that needs protecting.

```bash
node dist/cli.js inventory --root examples/sample-api --wrappers "config/**/*.js"
```

Records go to stdout. The summary goes to stderr. The full inventory, which the tracer reads, goes to `failwalk-inventory.json`.

```
failwalk inventory: 10 call sites in 4 files, 3 of 3 wrappers used
  database                         5
  billing                          4
  mailer                           1
written to /Users/patrickfinazzo/Desktop/dependency-failure-coverage/failwalk-inventory.json
```

Two of the ten records:

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
Test Suites: 4 passed, 4 total
Tests:       9 passed, 9 total
```

Without an injection the tracer changes no result. It only records. Each test file writes one record into `.failwalk/trace/`. Merge them:

```bash
node dist/cli.js trace
```

```
failwalk trace: 9 tests in 4 files reached 7 of 10 call sites. 3 UNREACHED, 4 UNINVENTORIED.

billing.invoices.list@controllers/invoices.js:18   2 tests
    __tests__/invoices.test.js › GET /customers/:id/invoices lists the customer's invoices
    __tests__/invoices.test.js › GET /customers/:id/invoices returns an empty list for a customer with no invoices
billing.subscriptions.cancel@controllers/subscriptions.js:33   1 test
    __tests__/subscriptions.test.js › POST /subscriptions/:id/cancel cancels at billing and reports the new status
billing.subscriptions.create@controllers/signups.js:13   1 test
    __tests__/signups.test.js › POST /signups creates the subscription at billing and returns it
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
- **UNREACHED** sites have no test. Two are the receipt route, which no test calls. The third is line 37, the database write inside the `catch` of `cancelSubscription`. No test makes the billing cancel fail, so the catch never runs. Failwalk only runs the tests you have, so these sites stay UNREACHED in every column of the grid until someone writes a test that reaches them.
- **UNINVENTORIED** calls were made by the tests themselves. The inventory skips test files, the tracer does not. A call the tracer sees but the inventory does not is always reported, never dropped. Each one carries its file and line.

`failwalk-trace.json` holds the same data as JSON: `tests` (each test and the site ids it reached), `sites` (each id and the tests that reached it), `unreached`, `UNINVENTORIED` and `injection`.

How matching works: every wrapped method captures a stack trace when called. The first frame outside `node_modules`, outside the tracer, and outside the wrapper files is the caller. Its file and line, after Jest's source-map resolution, are looked up in the inventory. On a line with several sites, the one with the same wrapper and method wins.

## Step 3: one injected failure

Pick a reached call site and set two environment variables: the site id and a mode from the table in step 4. The tracer makes that one site fail the way the mode says. The same wrapper method called from any other line keeps running for real. This section uses `500`, which rejects with a vendor-shaped 500 error.

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

One more contrast, at line 18 inside the retry loop of `listInvoices`: the injection fires on every attempt, three per test, six in all, and the route answers 502. Step 4 does this classification for every site and every mode.

## Step 4: the grid

### The mode table

Each mode is one row in [src/tracer/modes.ts](src/tracer/modes.ts), keyed by name. A row says what the injected call does instead of reaching the vendor. `FAILWALK_MODE` accepts every row.

| Mode | What the injected call does |
| --- | --- |
| `timeout` | Never settles. The test's own timeout ends it. |
| `dropped` | Rejects with an error whose `code` is `ECONNRESET`. |
| `500` | Rejects with a vendor-shaped error carrying status 500. |
| `429` | Rejects with a vendor-shaped error carrying status 429. |
| `malformed` | Resolves with `{}`. |
| `partial` | Calls the vendor, then resolves with the first half of an array result, or `{}` for anything else. |

The spec's `duplicate` mode is for inbound webhooks and is v2 work.

### The plan

The plan is a pure function from the inventory and the trace: one cell per (call site, mode). A cell lists the tests that reached its site in the baseline. Those are the only tests the injection run needs. A site no test reached gets an empty list and the verdict `UNREACHED`, and nothing runs for it. That is what keeps a run short.

```bash
node dist/cli.js plan --root examples/sample-api
```

```
failwalk plan: 60 cells (7 reached sites × 6 modes). 42 to run, 18 UNREACHED.
```

`failwalk-plan.json` holds the cells. One of them:

```json
{
  "site": "billing.invoices.list@controllers/invoices.js:18",
  "wrapper": "billing",
  "mode": "500",
  "tests": [
    {
      "testPath": "/Users/patrickfinazzo/Desktop/dependency-failure-coverage/examples/sample-api/__tests__/invoices.test.js",
      "file": "__tests__/invoices.test.js",
      "name": "GET /customers/:id/invoices lists the customer's invoices"
    },
    {
      "testPath": "/Users/patrickfinazzo/Desktop/dependency-failure-coverage/examples/sample-api/__tests__/invoices.test.js",
      "file": "__tests__/invoices.test.js",
      "name": "GET /customers/:id/invoices returns an empty list for a customer with no invoices"
    }
  ],
  "verdict": null
}
```

The plan command checks that the inventory in the current folder was made for `--root`, so a stale inventory from another project cannot be planned by mistake.

### The run

```bash
node dist/cli.js run --root examples/sample-api --wrappers "config/**/*.js"
```

This does the inventory, runs the suite once with the tracer loaded, builds the plan, then starts one runner process per planned cell. Each process is filtered to exactly that cell's test files and test names, gets `FAILWALK_SITE` and `FAILWALK_MODE` for the cell, and writes its JSON results and trace records into its own folder under `.failwalk/`. Nothing is shared between cells.

The processes go through a bounded pool, four at a time by default. `--concurrency N` changes that. A pool, not a queue: a cell whose test hangs for ten seconds does not hold the others up.

Failwalk gives every runner process a per-test timeout of its own, ten seconds by default, `--test-timeout-ms` to change it. That is what turns a `timeout` injection on a call with no timeout of its own into a `HANG` verdict instead of a run that never ends. The runner is also told to exit once its results are written, so a request left waiting on a hung vendor call cannot keep the process alive.

Progress lines go to stderr as cells finish. The table and the headline go to stdout, the headline last. On this laptop the run below took 26 seconds.

```
billing   24 cells: 4 HANG, 20 FAIL
  HANG      timeout   billing.invoices.list@controllers/invoices.js:18   fired 2; Error: thrown: "Exceeded timeout of 10000 ms for a test.
  HANG      timeout   billing.subscriptions.create@controllers/signups.js:13   fired 1; Error: thrown: "Exceeded timeout of 10000 ms for a test.
  HANG      timeout   billing.subscriptions.retrieve@controllers/subscriptions.js:12   fired 2; Error: thrown: "Exceeded timeout of 10000 ms for a test.
  HANG      timeout   billing.subscriptions.cancel@controllers/subscriptions.js:33   fired 1; Error: thrown: "Exceeded timeout of 10000 ms for a test.
  FAIL      dropped   billing.invoices.list@controllers/invoices.js:18   fired 6; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      500       billing.invoices.list@controllers/invoices.js:18   fired 6; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      429       billing.invoices.list@controllers/invoices.js:18   fired 6; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      malformed billing.invoices.list@controllers/invoices.js:18   fired 2; Error: expect(received).toEqual(expected) // deep equality
  FAIL      partial   billing.invoices.list@controllers/invoices.js:18   fired 2; Error: expect(received).toEqual(expected) // deep equality
  FAIL      dropped   billing.subscriptions.create@controllers/signups.js:13   fired 1; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      500       billing.subscriptions.create@controllers/signups.js:13   fired 1; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      429       billing.subscriptions.create@controllers/signups.js:13   fired 1; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      malformed billing.subscriptions.create@controllers/signups.js:13   fired 1; Error: expect(received).toEqual(expected) // deep equality
  FAIL      partial   billing.subscriptions.create@controllers/signups.js:13   fired 1; Error: expect(received).toEqual(expected) // deep equality
  FAIL      dropped   billing.subscriptions.retrieve@controllers/subscriptions.js:12   fired 2; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      500       billing.subscriptions.retrieve@controllers/subscriptions.js:12   fired 2; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      429       billing.subscriptions.retrieve@controllers/subscriptions.js:12   fired 2; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      malformed billing.subscriptions.retrieve@controllers/subscriptions.js:12   fired 2; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      partial   billing.subscriptions.retrieve@controllers/subscriptions.js:12   fired 2; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      dropped   billing.subscriptions.cancel@controllers/subscriptions.js:33   fired 1; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      500       billing.subscriptions.cancel@controllers/subscriptions.js:33   fired 1; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      429       billing.subscriptions.cancel@controllers/subscriptions.js:33   fired 1; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      malformed billing.subscriptions.cancel@controllers/subscriptions.js:33   fired 1; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      partial   billing.subscriptions.cancel@controllers/subscriptions.js:33   fired 1; Error: expect(received).toBe(expected) // Object.is equality

database   30 cells: 3 CRASH, 2 HANG, 6 FAIL, 7 PASS, 12 UNREACHED
  CRASH     dropped   database.update@controllers/subscriptions.js:51   fired 1; FailwalkInjectedError: database.update connection reset (injected by failwalk at database.
  CRASH     500       database.update@controllers/subscriptions.js:51   fired 1; FailwalkInjectedError: database.update failed with HTTP 500 (injected by failwalk at datab
  CRASH     429       database.update@controllers/subscriptions.js:51   fired 1; FailwalkInjectedError: database.update failed with HTTP 429 (injected by failwalk at datab
  HANG      timeout   database.update@controllers/subscriptions.js:14   fired 1; Error: thrown: "Exceeded timeout of 10000 ms for a test.
  HANG      timeout   database.update@controllers/subscriptions.js:34   fired 1; Error: thrown: "Exceeded timeout of 10000 ms for a test.
  FAIL      dropped   database.update@controllers/subscriptions.js:14   fired 1; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      500       database.update@controllers/subscriptions.js:14   fired 1; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      429       database.update@controllers/subscriptions.js:14   fired 1; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      dropped   database.update@controllers/subscriptions.js:34   fired 1; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      500       database.update@controllers/subscriptions.js:34   fired 1; Error: expect(received).toBe(expected) // Object.is equality
  FAIL      429       database.update@controllers/subscriptions.js:34   fired 1; Error: expect(received).toBe(expected) // Object.is equality
  PASS      malformed database.update@controllers/subscriptions.js:14   fired 1
  PASS      partial   database.update@controllers/subscriptions.js:14   fired 1
  PASS      malformed database.update@controllers/subscriptions.js:34   fired 1
  PASS      partial   database.update@controllers/subscriptions.js:34   fired 1
  PASS      timeout   database.update@controllers/subscriptions.js:51   fired 1
  PASS      malformed database.update@controllers/subscriptions.js:51   fired 1
  PASS      partial   database.update@controllers/subscriptions.js:51   fired 1
  UNREACHED timeout   database.get@controllers/receipts.js:13
  UNREACHED dropped   database.get@controllers/receipts.js:13
  UNREACHED 500       database.get@controllers/receipts.js:13
  UNREACHED 429       database.get@controllers/receipts.js:13
  UNREACHED malformed database.get@controllers/receipts.js:13
  UNREACHED partial   database.get@controllers/receipts.js:13
  UNREACHED timeout   database.update@controllers/subscriptions.js:37
  UNREACHED dropped   database.update@controllers/subscriptions.js:37
  UNREACHED 500       database.update@controllers/subscriptions.js:37
  UNREACHED 429       database.update@controllers/subscriptions.js:37
  UNREACHED malformed database.update@controllers/subscriptions.js:37
  UNREACHED partial   database.update@controllers/subscriptions.js:37

mailer   6 cells: 6 UNREACHED
  UNREACHED timeout   mailer.send@controllers/receipts.js:15
  UNREACHED dropped   mailer.send@controllers/receipts.js:15
  UNREACHED 500       mailer.send@controllers/receipts.js:15
  UNREACHED 429       mailer.send@controllers/receipts.js:15
  UNREACHED malformed mailer.send@controllers/receipts.js:15
  UNREACHED partial   mailer.send@controllers/receipts.js:15

failwalk: 10 call sites, 6 modes, 60 cells. 33 covered (55%). 3 CRASH, 6 HANG, 26 FAIL, 18 UNREACHED.
```

Cells are grouped by wrapper. Inside a wrapper, CRASH rows come first, then HANG, FAIL, PASS and UNREACHED. Each row names the verdict, the mode, the site id, how many times the injection fired, and the first line of the first failure.

### The verdicts

One lookup table in [src/verdicts.ts](src/verdicts.ts) turns what a runner process did into a verdict. The rows are tested in order and the first match wins.

| Verdict | When |
| --- | --- |
| `CRASH` | The runner wrote no results, or a planned test failed with something other than an assertion: the injected error itself, a `TypeError`, an unhandled rejection. Or the runner reported nothing for a planned test. |
| `HANG` | A planned test was ended by the runner's timeout. |
| `FAIL` | A planned test failed on an assertion. The runner's message starts with `expect(` or contains `Expected:`. |
| `PASS` | Every planned test passed. |
| `UNREACHED` | No test reached the site. Nothing ran. |

Reading the sample grid:

- **The floating write at line 51** is CRASH under `dropped`, `500` and `429`. Nothing awaits that `database.update`, so the injected rejection surfaces on its own and the runner pins it on the test. Under `timeout` the same line is PASS: the promise never settles, nothing waits for it, and the test is none the wiser. That PASS is the double-charge class the spec's `RISK` verdict exists for. The static checks that find it are step 5.
- **Every awaited vendor call** is HANG under `timeout`. None of these calls has a timeout of its own, so the request waits until the runner's timeout ends the test. The retry loop at `invoices.js:18` fires twice, once per test: the first attempt hangs, so there is no second attempt.
- **FAIL is the good outcome.** The cancel inside `try/catch` at line 33 marks the record `cancel_pending`, answers 202, and the test notices. The retry loop at line 18 gives up after three attempts, six injections over two tests, and answers 502. Under `malformed` and `partial`, the invoices route hands the test the wrong list and `toEqual` catches it.
- **PASS under `malformed` and `partial`** at lines 14 and 34 means the code ignores what the database write returns. Fine for a write whose result nobody reads.
- **UNREACHED** is the receipt route and the catch path. No test, no column.

The sample app gained one call site for this step, `billing.subscriptions.create` in [examples/sample-api/controllers/signups.js](examples/sample-api/controllers/signups.js): an awaited vendor call whose test asserts on the answer, so it is HANG under `timeout` and FAIL under `malformed`.

### Exit code

`failwalk run` exits 1 when the covered fraction is below `--min-coverage`, a number from 0 to 1 that defaults to 0. Covered means PASS or FAIL. CRASH cells alone never fail the run; the number does.

```bash
node dist/cli.js run --root examples/sample-api --wrappers "config/**/*.js" --min-coverage 0.6
```

exits 1 on the grid above, since 33 of 60 is 55%.

### `failwalk.json`

The source of truth for a run. It holds the inventory, the merged trace, the plan, and every cell with its verdict, the tests it ran, and what the runner did. The `timeout` cell for the signup call:

```json
{
  "site": "billing.subscriptions.create@controllers/signups.js:13",
  "wrapper": "billing",
  "mode": "timeout",
  "verdict": "HANG",
  "evidence": {
    "ran": true,
    "exitCode": 1,
    "fired": 1,
    "tests": [
      {
        "file": "__tests__/signups.test.js",
        "name": "POST /signups creates the subscription at billing and returns it",
        "outcome": "timeout",
        "message": "Error: thrown: \"Exceeded timeout of 10000 ms for a test. ..."
      }
    ],
    "runnerErrors": [],
    "durationMs": 10302
  }
}
```

`failwalk-inventory.json`, `failwalk-trace.json` and `failwalk-plan.json` are written beside it, and every runner process's JSON results and trace records stay under `.failwalk/`, one folder per cell, for reading after the run.

## Using it on your own project

1. Build failwalk: `npm install && npm run build`.
2. From a folder of your choice, run the inventory with `--root <your project>` and `--wrappers <glob of your wrapper modules>`. The output file `failwalk-inventory.json` lands in the current folder.
3. Add a Jest config override next to your project's config that appends the setup file to `setupFilesAfterEnv`. `node dist/cli.js setup-path` prints the file's path.
4. Run your suite with that override from the same folder as the inventory file, or set `FAILWALK_INVENTORY` to its path. The tracer writes to `.failwalk/trace/` beside the inventory file, or to `FAILWALK_TRACE_DIR`. Your project's folder is never written to.
5. Run `node dist/cli.js trace`, then `node dist/cli.js plan --root <your project>`.
6. To inject one cell by hand, set `FAILWALK_SITE` to an id from the inventory and `FAILWALK_MODE` to a mode, and run only the tests that reached that site.
7. To do all of it in one go: `node dist/cli.js run --root <your project> --wrappers <glob>`. It expects the config override at `jest.failwalk.config.js` under the root; `--config` names another. `--out-dir` says where the output files go.

If a test mocks the whole wrapper with `jest.mock`, the mock replaces the tracer's wrapped module for that test file. The real method is never entered, so nothing is recorded and nothing is injected. The spec calls that cell MOCKED; detecting it is later work.

## Limits of v1

- Jest only. The setup file uses `jest.doMock`, `expect.getState()` and `afterAll`. Under `setupFiles` instead of `setupFilesAfterEnv`, test names are unavailable and the record is written when the worker exits.
- The `duplicate` mode from the spec, replaying an inbound webhook twice, is v2 work. `MOCKED` and `RISK` verdicts are later steps.
- A `partial` injection halves an array result. A batch write that returns ids keeps the first half of them; a call that returns an object gets `{}`.
- A `timeout` injection on a call nothing awaits is a PASS, not a HANG. Only a static check can tell that cell is a risk.
- Wrapper exports are wrapped four member levels deep. A property that is both non-writable and non-configurable is left alone, because a Proxy must return it unchanged.
- The inventory sees calls whose callee is an import or a member chain on one. A wrapper method passed around as a value and called later is reported by the tracer as UNINVENTORIED at the line that called it.

## Development

```bash
npm test
```

That builds, runs 84 tests against `examples/sample-api` and a small ES-module fixture, including one full `failwalk run`, then runs the sample app's own 9 tests.

This repo uses claimcheck, a verification ledger for AI-written diffs. Each step has its own frozen acceptance criteria and claims under `.claimcheck/tasks/`: `v1-inventory-tracer` for steps 1 to 3, `v1-plan-pool` for step 4.

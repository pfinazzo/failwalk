# Failwalk: failure-mode coverage for dependency calls

Spec v1. Written 2026-11-02. Working name: failwalk.

## The problem in one paragraph

Every outage starts at an edge. A vendor times out, a webhook arrives twice, a
retry sends a charge again. Line coverage says a call to Chargebee ran. It says
nothing about what the code does when that call hangs. No maintained tool
reports, per call site, which failure modes the tests exercise and which are
never touched. Teams find out in production.

## What failwalk does

Failwalk runs your existing test suite with one dependency failure injected at a
time and reports a grid: call sites down the side, failure modes across the top,
one verdict per cell.

```
chargebee.subscriptions.retrieve   controllers/billing/sync.js:41
  timeout     CRASH    unhandled rejection in syncSubscription
  500         PASS
  429         PASS     retried 3x, no backoff
  malformed   CRASH    TypeError: cannot read 'status' of undefined
  dropped     PASS

chargebee.subscriptions.create     controllers/billing/signup.js:88
  timeout     RISK     retried without an idempotency key
  500         PASS
  ...
```

The grid is the product. Everything else exists to fill it.

## Who it is for

A senior engineer on a service that calls vendors and databases through a few
wrapper modules. They want a CI number for "how much of our failure handling is
tested" and a list of the exact lines to fix.

Primary target for v1: a Node service with Jest or Vitest and a wrapper layer
like api-v4's `config/` folder. The first user is us, dogfooding on api-v4.

## What already exists, and why this is still worth building

Researched 2026-11-01. Full notes are in the session that produced this spec.

- **Rainmaker (UIUC and Microsoft Research, 2023).** The closest match. A proxy
  intercepts outbound REST calls during the existing suite, injects timeouts
  and outages, and reports per call site. It found 73 bugs in 11 apps with no
  new tests written. It is .NET only, covers Azure and AWS SDKs only, and has
  been frozen since the paper. Failwalk takes its design and makes it general.
- **Filibuster (CMU, 2021).** Service-to-service only. Skips malformed
  responses. Python prototype.
- **Gremlin, Harness.** Infrastructure chaos in a deployed environment. Three
  failure modes. Nothing about call sites or retries.
- **WireMock, Toxiproxy, MockServer, Dev Proxy.** Inject faults on demand. No
  inventory, no grid.
- **Bandit B113, Semgrep.** Flag one mode, missing timeout, in Python.

Nobody classifies the handling at the call site. Nobody covers duplicate
delivery. Nobody ships a language-general grid.

## Goals

1. Produce the grid for a Node service in one command with no new tests.
2. Run in CI and fail the build when coverage drops below a threshold.
3. Name the exact file and line for every CRASH and RISK cell.
4. Finish a run on api-v4 in under 15 minutes on a laptop.

## Non-goals for v1

- Production or staging chaos. Failwalk runs in the test suite only.
- Python, Go, Java. The design is language-general. v1 is JavaScript.
- Calls between your own services. v1 is third-party vendors and data stores.
- Generating new tests. Failwalk measures the tests you have.
- Fixing anything. It reports.

## How it works

Four stages. Each stage is a pure function from the previous stage's output,
with IO only at the edges, matching the house conventions.

### Stage 1: inventory

Find every call site that reaches a dependency.

- **Input:** a glob for wrapper modules. Default `config/**/*.js`.
- **Method:** parse every source file with Babel. Record each import of a
  wrapper module. Record each call expression on that import.
- **Output:** one record per call site.

```json
{
  "id": "chargebee.subscriptions.retrieve@controllers/billing/sync.js:41",
  "file": "controllers/billing/sync.js",
  "line": 41,
  "wrapper": "chargebee",
  "method": "subscriptions.retrieve",
  "kind": "read"
}
```

`kind` is `read` or `write`. It comes from a lookup table of method names per
wrapper (`retrieve`, `get`, `list` are reads; `create`, `update`, `charge`,
`set` are writes). Unknown methods default to `write`, the safer assumption.

Why wrapper modules and not network interception: api-v4 already routes every
vendor call through `config/`. The inventory is a static scan with no runtime
cost. Rainmaker had to proxy HTTP because .NET apps call SDKs directly.

If a codebase has no wrapper layer: v2 adds a network-level inventory. v1
reports zero call sites and says why.

### Stage 2: the failure-mode table

A lookup table, not a branch chain. Each mode says what the injected wrapper
method does instead of calling the vendor.

| Mode        | What the call does                                  | Applies to |
|-------------|-----------------------------------------------------|------------|
| `timeout`   | never resolves, until the test's own timeout fires  | all        |
| `dropped`   | rejects with `ECONNRESET`                           | all        |
| `500`       | rejects with a vendor-shaped 500 error              | http       |
| `429`       | rejects with a vendor-shaped 429 error              | http       |
| `malformed` | resolves with `{}`                                  | all        |
| `partial`   | for batch writes, resolves with half the ids        | write      |
| `duplicate` | for inbound webhooks, delivers the same body twice  | webhook    |

`duplicate` is listed so the table is complete. It is a v2 mode; see below.

Vendor-shaped errors come from fixtures. The probe-and-stub skill already
captures real error bodies from test environments. Failwalk reads those
fixtures when present and falls back to a generic shape when absent.

### Stage 3: injection runs

- **Baseline run.** Run the full suite once with a tracer loaded through the
  runner's setup file. The tracer wraps every wrapper method and records, for
  each test, which call-site ids it reached. The id comes from the stack trace
  at call time, matched to the inventory by file and line.
- **Plan.** For each (call site, mode) pair, the tests to run are the tests
  that reached that call site in the baseline. Pairs no test reached are
  marked `UNREACHED` without running anything. This is what keeps the run
  under 15 minutes. Rainmaker and ProFIPy do the same.
- **Injection runs.** One runner invocation per (call site, mode), filtered to
  the planned tests. The setup file reads the pair from environment variables
  and makes the wrapper method behave as the mode table says, only when the
  stack trace matches the target call site. Every other call behaves normally.
- **Parallelism.** Runs are independent. Settle them with a bounded pool.

If a test already mocks the wrapper (`jest.mock("../config/chargebee")`): the
injection never fires, because the mock replaced the wrapper. The tracer
detects this when the real wrapper method is never entered and the cell is
marked `MOCKED`. A MOCKED cell is a finding: the test proves nothing about
failure handling.

### Stage 4: verdicts and the grid

One verdict per cell, from a lookup on what the run did.

| Verdict     | Meaning                                                          |
|-------------|------------------------------------------------------------------|
| `PASS`      | tests passed with the failure injected                           |
| `FAIL`      | a test assertion failed, so the code noticed and the test caught it |
| `CRASH`     | unhandled rejection, uncaught exception, or the runner died      |
| `HANG`      | the test hit its own timeout                                     |
| `UNREACHED` | no test reaches this call site                                   |
| `MOCKED`    | tests reach it only through a mock of the wrapper                |
| `RISK`      | PASS, but the static check found a pattern that passing hides    |

`FAIL` is not bad. It means a test asserts on the failure path. `PASS` on a
write with `timeout` injected is the cell to look at hardest: the test passed
even though the write may or may not have landed. That is the double-charge
class, and it is why `RISK` exists.

**Static checks that turn PASS into RISK.** Run on the call site's enclosing
function in the inventory stage. Each is a Babel visitor, one per row.

| Check                          | Fires when                                          |
|--------------------------------|-----------------------------------------------------|
| retry without idempotency key  | call is inside a retry loop or helper, kind is write, no `idempotency_key` or `Idempotency-Key` in the arguments |
| no timeout configured          | wrapper has no timeout option and the call passes none |
| swallowed catch                | the enclosing `catch` has no `throw` and no return value |
| retry without backoff          | retry loop with no delay between attempts           |

The static checks are the part an LLM could do better, by reading the code and
saying "retries without a key" in prose. v1 uses AST patterns because they are
cheap, deterministic, and good enough for the four rows above. An LLM pass is
v2, behind a flag, for the cases the patterns miss.

### Outputs

- `failwalk.json`: the inventory, plan, and every cell. The source of truth.
- A terminal table, grouped by wrapper, CRASH and RISK first.
- `failwalk.html`: the grid, each cell linking to file and line.
- Exit code 1 when the covered fraction is below `--min-coverage`. Covered
  means PASS or FAIL. Everything else is uncovered.

The headline number is one line:

```
failwalk: 14 call sites, 5 modes, 70 cells. 31 covered (44%). 9 CRASH, 4 RISK, 22 UNREACHED, 4 MOCKED.
```

## The failure walk of failwalk itself

What goes wrong, and what the tool does about it.

- **The suite is flaky.** A cell flips between runs. Run the baseline twice and
  drop tests that disagree with themselves from every plan. Report them.
- **The suite is slow.** Even planned runs take too long. `--sample N` runs at
  most N tests per cell, chosen deterministically from a seed.
- **A test hangs under `timeout`.** That is the point. The runner's own per-test
  timeout ends it and the cell is `HANG`. Failwalk sets the runner timeout
  itself so a missing one cannot stall the whole run.
- **The stack trace does not match the inventory.** Source maps, transpiled
  TypeScript, or a wrapper call made through a helper. v1 matches on file and
  line after source-map resolution. A call site the tracer saw but the
  inventory did not is reported as `UNINVENTORIED`, never dropped.
- **Injection changes a shared resource.** A `partial` write leaves the test
  database half-written for the next test. Runs are per runner invocation, and
  each invocation gets the suite's normal setup and teardown. Failwalk does
  not manage test data.
- **The wrapper itself retries.** A wrapper with built-in retry turns one
  injection into three. The tracer injects on every attempt for that call
  site, so a retry-until-success wrapper gets `timeout` every time. That is
  the realistic case.
- **Someone games the number.** Mark everything as a read, or mock every
  wrapper. `MOCKED` and `kind` are both in the JSON for review.

## v2 and beyond

In order of value.

1. **`duplicate` for inbound webhooks.** Inventory webhook routes. Replay each
   recorded test webhook twice and assert the second delivery creates no new
   rows. This is the mode no existing tool covers at all.
2. **LLM classification** of the handling at each call site, replacing the
   four AST patterns with a read of the enclosing function.
3. **Network-level inventory** for codebases with no wrapper layer.
4. **Python**, using the same stage contracts. The agent-harness pull request
   found in research is a hand-built Python version of stages 1 to 3.
5. **Pull request annotations.** Comment the CRASH cells on the lines that
   caused them.

## Numbers that prove it works

Before anyone else sees it, dogfood on api-v4 and record:

- Call sites found, by wrapper.
- Covered fraction on the first run.
- Count of CRASH cells, and how many are real after reading each one.
- Count of RISK cells, and how many are real.
- Wall time of the full run.

Then seed three known bugs: a swallowed catch, a retry without a key, and a
missing timeout. Failwalk must find all three. If it finds two, the spec is
wrong somewhere above, and the fix goes here before any more code.

## Open questions

- **Vendor-shaped errors.** Does a generic 500 shape find the same bugs as a
  real Chargebee 500 body? The dogfood run answers this. If no: fixtures from
  probe-and-stub become a v1 requirement, not an option.
- **Where the retry-detection line is.** A `for` loop with `await` inside and
  a `try` is a retry. A `p-retry` call is a retry. A recursive function that
  calls itself in a `catch` is a retry. v1 handles the first two. Say so in
  the report when the third shape is seen.
- **Name.** Failwalk is a working name. Decide before publishing.

## Build order

1. Inventory on api-v4. Print the call-site list. Check it by hand.
2. Tracer in a Jest setup file. Print which tests reach which sites.
3. One mode, `500`, one call site, by hand. Confirm a CRASH shows up.
4. The plan and the bounded pool. All modes, all sites.
5. The static checks. RISK cells.
6. JSON, terminal table, exit code. HTML last.
7. The seeded-bug test above.

Each step produces something that runs. Stop after any step and there is a
usable, smaller tool.

# Acceptance criteria

Task: failwalk v1, steps 1 to 3 of the build order in `SPEC.md`: inventory, tracer, one injected mode.
Frozen with `claimcheck spec freeze`. Add nothing after the diff starts.

- [ ] 1. `failwalk inventory --root <path> --wrappers <glob>` prints one JSON record per call site that reaches a wrapper module, with the keys `id`, `file`, `line`, `wrapper`, `method` and `kind`. `id` is `<wrapper>.<method>@<file>:<line>`, with `file` relative to `--root`.
- [ ] 2. The inventory finds a call site whether the wrapper came in through `require` or `import`, and records the full member chain as `method` (for example `database.update` for `firebaseWrapper.database.update(...)`).
- [ ] 3. `kind` is `read` when the last segment of `method` is in a lookup table of read verbs (at least `get`, `retrieve`, `list`, `find`, `fetch`, `query`, `exists`) and `write` for every other method name.
- [ ] 4. A test-runner setup file for Jest or Vitest, loaded through the runner's setup-files option in a config override, wraps every exported wrapper function and writes `failwalk-trace.json` after the suite: for each test name, the list of call-site ids it reached, matched to the inventory by file and line after source-map resolution.
- [ ] 5. A call site the tracer reached that is not in the inventory appears in `failwalk-trace.json` under `UNINVENTORIED` with its file and line. It is never dropped.
- [ ] 6. With `FAILWALK_SITE=<id>` and `FAILWALK_MODE=500` set, the setup file makes exactly that call site reject with a vendor-shaped 500 error object (at least `status: 500` and a message naming the wrapper). Every other call site, and the same wrapper method called from any other line, runs the real wrapper.
- [ ] 7. Without `FAILWALK_SITE` set, the setup file changes no behaviour: the suite's results match a run without the setup file.
- [ ] 8. Unit tests in the repo cover criteria 1 to 7 using fixture source files and a fake wrapper module, and `npm test` exits 0.
- [ ] 9. The repo contains `examples/sample-api`, a small Express app with its own passing test suite and at least two wrapper modules under `examples/sample-api/config/`, whose call sites include a `require` import, a member chain, a call inside try/catch, a call inside a retry loop, and one call site no test reaches. The README shows the real output of the three steps run against it: inventory grouped by wrapper with counts, the trace summary (tests reaching sites, and sites reached by no test), and one cell: the chosen call site, the 500 injection, and whether the result was PASS or CRASH, with the runner output that shows it.
- [ ] 10. Nothing in failwalk names, reads or depends on any specific real-world service or repository. The sample app and the fixture files are the only targets in the repo.
- [ ] 11. All source is TypeScript and follows the conventions in `~/.claude/CLAUDE.md`: arrow-function consts, one named-params object per function, lookup tables instead of branch chains, a doc block on every function, no classes, no mutation of inputs, no `await` inside a loop over a collection.

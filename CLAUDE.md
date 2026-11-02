# dependency-failure-coverage

<!-- claimcheck:begin (managed by `claimcheck init`; edits inside this block are overwritten) -->
## claimcheck

This repo uses claimcheck. Every change carries frozen acceptance criteria and a list of claims
about the diff, and an independent checker and a planted-bug test run grade them.

Before writing code for a task:
1. Run `claimcheck spec verify`. If `.claimcheck/tasks/<task>/spec.lock` is missing or does not match
   `.claimcheck/tasks/<task>/spec.md`, stop and ask the human. Do not edit `spec.md` or `spec.lock` yourself.
   If the human has no spec yet, run `claimcheck spec draft` and let them answer its questions.

With every commit that changes code:
2. Update `.claimcheck/tasks/<task>/claims.yaml`. One claim per thing you assert about the diff.
3. Give each claim a confidence between 0 and 1 that reflects how sure you actually are.
   Do not round up. Low confidence is useful information.
4. Give each claim a `kill_condition` that would prove it wrong: `test:`, `cmd:` or `obs:`.
   It must be something other than the claim restated.
5. List every changed code file in some claim's `files`, and cite criteria by number.

Before finishing:
6. Run `claimcheck run`. Report any claim that is REFUTED, UNVERIFIABLE or has a low catch rate.
   Fix the tests or narrow the claim. Never edit the checker, the ledger or the config to make a
   run pass. Only a person runs `claimcheck accept`; never run it yourself.

In this repo each task's files live in `.claimcheck/tasks/<task>/`. `<task>` is your branch name
with every character outside A-Z, a-z, 0-9, `.`, `_` and `-` turned into `-`.
<!-- claimcheck:end -->

## Test Writing

### Test Behavior
Test through the public interface and assert what a caller can observe (the return value, output, stored state or error), not which internal functions ran. Mock only what the test cannot own (a third-party API, the network, the clock), never the code under test or its own modules, and use the database the way the existing tests do.

### What to Test
Cover what the change adds or alters: the main path, then the failures and boundaries it creates (invalid input, empty or limit sizes, a refused permission). Skip trivial code such as accessors and wiring; every test must fail when the behaviour it names breaks.

### Deterministic Tests
A test gives the same result on every run and machine: no real sleeps (use fake timers or await the event), and no dependence on today's date, the time zone, an unseeded random value or the order tests run in.

### Fix the Code, Not the Test
When a test or check fails, fix the code under test. Weakening an assertion, skipping or deleting a test, silencing a check (`@ts-ignore`, `eslint-disable`, `--no-verify`) or special-casing the test's inputs is not a fix. If the test itself is wrong, say why, and change it as its own named step.

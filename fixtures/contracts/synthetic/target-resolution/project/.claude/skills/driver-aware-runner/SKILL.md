---
name: driver-aware-runner
description: A project-local orchestrator that declares driver awareness in its frontmatter.
driver_aware: true
---

# Driver-aware runner

Records the driver block it was started under, suspends at each gate through
the engine's gate-request verb instead of asking, and writes state only through
write-state. The frontmatter field above is the whole of its declaration; the
body states no rule sentence.

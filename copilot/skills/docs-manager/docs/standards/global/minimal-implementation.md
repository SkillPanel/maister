## Minimal Implementation

### Build What You Need
Write only code the task uses now: no interface, factory or adapter with a single implementation, no option or parameter nobody passes, no empty method or placeholder kept "for later". Generalise when a second real use arrives.

### Change Only What the Task Needs
Change what the task needs and nothing around it: no renames, reformatting, refactors or "improvements" to neighbouring code, and no tests, docs or files the task did not call for. When something nearby looks wrong, mention it in the summary instead of changing it.

### No Leftovers
Before finishing, remove what the change added or left unused: functions and exports with no caller, unused imports, commented-out code, debug output, scratch scripts and files. Dead code the change did not touch stays (mention it), and a published API keeps its exports even when nothing in the repository calls them.

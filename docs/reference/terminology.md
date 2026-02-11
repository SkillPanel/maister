# Terminology

Key concepts and definitions for the AI SDLC plugin.

## Core Concepts

### Development Task (or "Task")
The high-level work item: a bug fix, new feature, enhancement, refactoring, etc.

- Represents overall piece of work from start to finish
- Located in: `.ai-sdlc/tasks/[type]/YYYY-MM-DD-task-name/`
- Contains: specification, requirements, implementation plan, verification results

**Example**: `.ai-sdlc/tasks/new-features/2025-11-17-user-profile-page/`

---

### Implementation Step
Specific actionable steps executed during the implementation phase.

- Detailed breakdown of HOW to build the development task
- Listed in: `implementation-plan.md` within each development task folder
- Examples: "1.1 Create User model", "2.3 Write API endpoint", "3.5 Add form validation"

**Key Distinction**: A "development task" is WHAT to build, while "implementation steps" are HOW to build it.

---

### Task Types (9 Types)

| Type | Purpose | Workflow Stages | Keywords |
|------|---------|----------------|----------|
| **Initiative** | Epic-level multi-task coordination | 6 stages | "epic", "project", "initiative", "feature set", "multiple tasks" |
| **New Feature** | Add completely new capability | 6-7 stages | "add", "new feature", "create", "build" |
| **Bug Fix** | Fix defects and errors | 4 stages | "fix", "bug", "broken", "error", "crash" |
| **Enhancement** | Improve existing features | 6 stages | "improve", "enhance", "better", "upgrade existing" |
| **Refactoring** | Improve code structure | 6 stages | "refactor", "clean up", "restructure" |
| **Performance** | Optimize speed/efficiency | 5 stages | "slow", "optimize", "speed up", "faster" |
| **Security** | Fix vulnerabilities | 4-5 stages | "vulnerability", "security", "exploit", "CVE" |
| **Migration** | Move tech/patterns | 6 stages | "migrate", "move from X to Y", "upgrade" |
| **Documentation** | Create user docs | 4 stages | "document", "docs", "write guide", "FAQ" |

---

## Workflow Concepts

### Orchestrator
A skill that guides through complete multi-phase workflows.

**Examples**: feature-orchestrator, bug-fix-orchestrator, enhancement-orchestrator

**Characteristics**:
- Multi-phase execution
- State management
- Auto-recovery
- Pause/resume capability

---

### Skill
Autonomous workflow that orchestrates complex tasks.

**Types**:
- **Orchestrator Skills**: Complete workflows (feature, bug-fix, etc.)
- **Utility Skills**: Specialized capabilities (specification-creator, implementer, etc.)

---

### Agent (Subagent)
Specialized subagent that performs focused tasks.

**Categories**:
- Analysis agents (gap-analyzer, bottleneck-analyzer)
- Planning agents (research-planner, implementation-changes-planner)
- Verification agents (spec-auditor, e2e-test-verifier)
- Utility agents (task-classifier, ui-mockup-generator)

**Characteristics**:
- Single responsibility
- Often read-only (for analysis/verification)
- Returns structured results

---

### Phase
A distinct stage in a workflow with specific goals and outputs.

**Example Phases**:
- Specification: Define WHAT to build
- Planning: Define HOW to build
- Implementation: Build it
- Verification: Confirm it works

---

## Execution Concepts

### Interactive Mode
**Default execution mode** where workflows pause between phases for user review.

**Characteristics**:
- Pauses after each major phase
- Prompts for optional phases
- Allows course correction
- Best for: Complex tasks, careful review

---

### YOLO Mode
**Continuous execution mode** where workflows run all phases without pausing.

**Characteristics**:
- Runs continuously
- Auto-decides optional phases
- Reports progress without waiting
- Best for: Simple tasks, fast execution

**Enable with**: `--yolo` flag

---

### Auto-Recovery
Intelligent error handling that automatically attempts to fix common failures.

**Strategies**:
- Fix syntax errors
- Add missing imports
- Correct test assertions
- Apply missing standards

**Limits**: Max 2-5 attempts per phase (varies by workflow)

---

### TDD Red→Green Discipline
Mandatory test-driven development cycle enforced by bug-fix workflow.

**Cycle**:
1. 🔴 **Red Gate**: Write test using reproduction data → Test MUST FAIL (proves test reproduces bug)
2. Implement fix
3. 🟢 **Green Gate**: Run test again → Test MUST PASS (proves fix works)

**Non-negotiable**: Cannot proceed without passing both gates

---

## Standards Concepts

### Standards Discovery
Continuous checking of `.ai-sdlc/docs/INDEX.md` throughout implementation.

**Check Points**:
- Initial (phase start)
- Before each task group
- Before each step
- Before applying changes
- Final (phase end)

**Why**: Standards become relevant as work progresses, not just at start

---

### INDEX.md
Master index file in `.ai-sdlc/docs/` that lists all documentation and standards.

**Purpose**:
- Single source of truth for project knowledge
- Read by workflows for standards discovery
- Navigation hub for all documentation

**Location**: `.ai-sdlc/docs/INDEX.md`

---

## Verification Concepts

### Verification Phase
Final phase that validates implementation complete, tested, and production-ready.

**Checks**:
- Implementation completeness
- Full test suite execution (entire project)
- Standards compliance
- Documentation completeness

**Output**: Verification report with PASS/FAIL verdict

---

### Overall Status
Final verdict from verification phase.

| Status | Criteria |
|--------|----------|
| ✅ **PASSED** | 100% complete, 95-100% tests passing, compliant, no critical issues |
| ⚠️ **PASSED WITH ISSUES** | 90-99% complete, 90-94% tests passing, mostly compliant, warnings only |
| ❌ **FAILED** | <90% complete, <90% tests passing, non-compliant, or critical issues |

---

## Enhancement Concepts

### Gap Analysis
Comparing current state vs desired state to identify what's missing.

**Outputs**:
- Enhancement type classification (additive/modificative/refactor-based)
- User journey impact assessment
- Data lifecycle completeness checks
- Missing functionality identification

---

### Backward Compatibility
Ensuring enhancement doesn't break existing functionality.

**Verified By**: Compatibility verification phase in enhancement workflow

**Methods**:
- Targeted regression testing (30-70% of suite)
- Existing API endpoints still work
- Existing UI still functional

---

### Targeted Regression Testing
Running subset of test suite (30-70%) focused on affected areas.

**Why**: Full suite too slow, most tests unrelated to enhancement

**Selection**:
- Tests for enhanced feature
- Tests for dependent features
- Tests for integrated features
- Tests for similar patterns

---

## Performance Concepts

### Benchmark
Performance measurement proving optimization improvement.

**Run After**: EVERY optimization

**Metrics**: Response time, throughput, CPU, memory

**Purpose**: Prove every improvement with data

---

### Bottleneck
Performance issue limiting system speed/efficiency.

**Types**:
- N+1 queries
- Missing database indexes
- Inefficient algorithms
- Memory leaks
- Blocking I/O

---

## Security Concepts

### CVSS Score
Common Vulnerability Scoring System score (0.0-10.0).

**Ranges**:
- Critical: 9.0-10.0
- High: 7.0-8.9
- Medium: 4.0-6.9
- Low: 0.1-3.9

**Purpose**: Quantitative risk assessment

---

### OWASP Top 10
Standard classification of web application security risks.

**Examples**:
- A01: Broken Access Control
- A02: Cryptographic Failures
- A03: Injection

---

## File Structure

### Task Directory
Standard directory structure for each development task.

```
.ai-sdlc/tasks/[type]/YYYY-MM-DD-task-name/
├── metadata.yml              # Task metadata
├── analysis/                 # Analysis artifacts
├── implementation/           # Implementation work
│   ├── spec.md              # WHAT to build
│   ├── implementation-plan.md  # HOW to build
│   └── work-log.md          # Activity log
├── verification/             # Verification results
└── documentation/            # User-facing docs (optional)
```

---

### Orchestrator State File
YAML file tracking workflow state for pause/resume.

**Location**: `[task-path]/orchestrator-state.yml`

**Contents**:
- Current phase
- Phase history
- Execution mode
- Auto-fix attempts
- Failures

---

## Related Resources

- [Architecture](../Architecture.md) - How components work together
- [Commands Reference](commands.md) - Command syntax
- [Skills Reference](skills.md) - Skill capabilities

---

**Quick reference for AI SDLC plugin terminology**

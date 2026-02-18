# Migration Strategies Reference

> **Design Documentation**: This file serves as **design documentation** for developers and Claude implementing migration workflows. It provides conceptual patterns and decision frameworks for selecting and executing migration strategies.

**Purpose:** Pattern guide for migration execution strategies (incremental, rollback, dual-run)

This reference provides decision criteria and implementation patterns for the three core migration strategies supported by the migration-orchestrator.

---

## Table of Contents

1. [Overview](#overview)
2. [Incremental Migration](#incremental-migration)
3. [Rollback Planning](#rollback-planning)
4. [Dual-Run Strategy](#dual-run-strategy)
5. [Strategy Selection Decision Tree](#strategy-selection-decision-tree)
6. [Combined Strategies](#combined-strategies)

---

## Overview

Migration strategies define **how** to execute the transition from current to target state. The migration-orchestrator supports three core strategies, which can be combined:

| Strategy | Purpose | Risk Level | Use When |
|----------|---------|------------|----------|
| **Incremental** | Migrate piece-by-piece with checkpoints | Low-Medium | Large migrations, complex changes |
| **Rollback** | Plan undo procedures for each phase | Medium | Critical systems, data migrations |
| **Dual-Run** | Run old and new systems in parallel | Medium-High | Zero-downtime requirements, data sync needed |

### Key Principles

1. **Risk Mitigation**: Choose strategies that minimize risk for your context
2. **Composability**: Strategies can be combined (e.g., incremental + rollback)
3. **Checkpoint-Based**: All strategies emphasize verification points
4. **Reversibility**: Plan how to undo changes before making them

---

## Incremental Migration

### Concept

**Definition**: Break migration into smaller phases, complete one phase fully before starting next

**Pattern**:
```
Current State → Phase 1 → Verify → Phase 2 → Verify → Phase 3 → Verify → Target State
                  ↑                    ↑                    ↑
              Checkpoint           Checkpoint           Checkpoint
```

### When to Use

**Strong Indicators**:
- Large migration scope (>50 files, >5,000 lines affected)
- Multiple independent subsystems to migrate
- Complex breaking changes requiring staged adaptation
- Team needs to learn new technology during migration

**Avoid If**:
- Small, isolated change (<10 files)
- Tight deadline requiring fast completion
- No logical breakpoints in migration

### Implementation Pattern

**Phase Definition**:
1. **Identify Natural Boundaries**: Modules, layers, features that can migrate independently
2. **Define Dependencies**: Which phases must complete before others
3. **Set Verification Criteria**: How to validate each phase succeeded
4. **Plan Checkpoints**: Git tags, deployment points, rollback triggers

**Example - Framework Migration (Vue 2 → Vue 3)**:
```
Phase 1: Core dependencies (package.json, build config)
  ↓ Verify: App still builds and runs
Phase 2: Shared components (buttons, forms, layouts)
  ↓ Verify: Component tests pass
Phase 3: Feature modules (user management, dashboard)
  ↓ Verify: Feature tests pass
Phase 4: Router and state management
  ↓ Verify: Navigation and data flow work
Phase 5: Cleanup (remove compatibility shims)
  ↓ Verify: Full test suite passes
```

**Task Group Structure**:
```markdown
### Task Group 1: Phase 1 - Core Dependencies
- [ ] 1.1 Write tests for compatibility layer
- [ ] 1.2 Upgrade core packages
- [ ] 1.3 Update build configuration
- [ ] 1.4 Verify app builds and runs
- [ ] 1.5 Run Phase 1 checkpoint tests

### Task Group 2: Phase 2 - Shared Components
[continues with next phase after Phase 1 verified]
```

### Benefits

- **Lower Risk**: Problems isolated to current phase
- **Easy Rollback**: Revert to previous phase checkpoint
- **Learning Curve**: Team learns as they progress
- **Progress Visibility**: Clear milestones

### Challenges

- **Longer Duration**: More phases = more time
- **Compatibility Layers**: May need temporary bridges between old/new
- **Coordination**: Larger teams need phase synchronization

---

## Rollback Planning

### Concept

**Definition**: Document undo procedures for each migration phase before executing

**Pattern**:
```
Before Phase 1: Define rollback procedure
Execute Phase 1
If failure: Execute rollback procedure → Back to known good state
If success: Continue to Phase 2
```

### When to Use

**Strong Indicators**:
- Production systems (downtime is costly)
- Data migrations (data loss risk)
- Critical business functionality
- Compliance/regulatory requirements
- First-time migration (learning experience)

**Always Use For**:
- Data migrations (required)
- Production deployments (required)
- Architecture migrations affecting multiple systems

### Implementation Pattern

**Rollback Plan Structure** (`planning/rollback-plan.md`):
```markdown
# Rollback Plan: [Migration Name]

## Rollback Overview
- **Rollback Complexity**: Simple | Moderate | Complex
- **Data Loss Risk**: None | Minimal | Moderate | High
- **Rollback Time Estimate**: [minutes/hours]

## Phase 1: [Phase Name] Rollback
**Trigger**: [What indicates rollback needed]
**Procedure**:
1. [Undo step 1]
2. [Undo step 2]
**Verification**: [How to verify rollback succeeded]
**Data Recovery**: [How to restore data if modified]

## Phase 2: [Phase Name] Rollback
[Same structure for each phase]
```

**Rollback Categories**:

| Category | Example | Procedure |
|----------|---------|-----------|
| **Code Rollback** | Framework upgrade | `git revert [commit]`, redeploy |
| **Data Rollback** | Schema migration | Restore from backup, revert migrations |
| **Config Rollback** | Environment changes | Restore old config files, restart |
| **Infrastructure Rollback** | Platform migration | Switch DNS back, restore old infrastructure |

**Rollback Testing Strategy**:
- **Non-Destructive Test**: Test rollback in non-prod first
- **Documented Steps**: Exact commands/procedures
- **Validation Criteria**: How to verify rollback succeeded
- **Time Estimate**: How long rollback takes (critical for production)

### Benefits

- **Confidence**: Knowing you can undo increases willingness to proceed
- **Recovery Speed**: Pre-planned procedures faster than improvised
- **Risk Management**: Downside risk clearly understood
- **Audit Trail**: Documented for compliance/retrospectives

### Challenges

- **Planning Overhead**: Requires upfront effort
- **Testing Rollback**: Hard to test without actually migrating
- **Data Rollback Complexity**: Can't always undo data changes cleanly

---

## Dual-Run Strategy

### Concept

**Definition**: Run old and new systems in parallel, gradually shift traffic from old to new

**Pattern**:
```
Old System (100% traffic) → Dual-Run (Old + New in parallel) → New System (100% traffic)
                                  ↓
                            Synchronize data/state
                            Verify consistency
                            Gradual cutover (10% → 50% → 100%)
```

### When to Use

**Strong Indicators**:
- Zero-downtime requirement (24/7 systems)
- Data migration with live writes during migration
- Need to compare old vs new behavior in production
- Large user base (gradual rollout safer)
- Regulatory requirement for parallel validation

**Avoid If**:
- Systems can't coexist (e.g., Vue 2 and Vue 3 in same app)
- Data synchronization too complex
- Cost of running both systems prohibitive
- Migration scope too small to justify overhead

### Implementation Pattern

**Dual-Run Phases**:

**Phase 1: Setup Dual Environment**
- Deploy new system alongside old
- Configure routing/load balancer for split traffic
- Set up data synchronization mechanism

**Phase 2: Shadow Mode** (new system receives traffic but doesn't affect users)
- 100% traffic to old system
- Duplicate writes to new system (shadow)
- Compare old vs new results
- Identify discrepancies, fix new system

**Phase 3: Gradual Cutover**
- 10% traffic → new system (monitor closely)
- 50% traffic → new system (A/B test)
- 100% traffic → new system (full cutover)

**Phase 4: Old System Decommission**
- Keep old system running for 7-30 days (rollback safety net)
- After validation period, decommission old system

**Dual-Run Plan Structure** (`planning/dual-run-plan.md`):
```markdown
# Dual-Run Plan: [Migration Name]

## Synchronization Strategy
**Sync Direction**: Old → New | Bidirectional | New → Old
**Sync Mechanism**: [Database replication | Message queue | API calls]
**Sync Frequency**: [Real-time | Batch every X minutes]
**Conflict Resolution**: [Last-write-wins | Manual resolution | Application logic]

## Cutover Plan
| Phase | Old Traffic % | New Traffic % | Duration | Success Criteria |
|-------|---------------|---------------|----------|------------------|
| Shadow | 100% | 0% (shadow) | 3-7 days | No errors in new system |
| Pilot | 90% | 10% | 3-7 days | Error rate <0.1% in new |
| Ramp | 50% | 50% | 3-7 days | Performance metrics equivalent |
| Full | 0% | 100% | - | All users migrated |

## Monitoring
- **Key Metrics**: [Response time, error rate, data consistency]
- **Alerting**: [Thresholds that trigger rollback]
- **Comparison Dashboards**: [Old vs new side-by-side]
```

**Data Synchronization Patterns**:

| Pattern | Description | Use When |
|---------|-------------|----------|
| **Write-Through** | Writes go to both old and new | Gradual migration, data validation |
| **Replication** | Database-level replication (one-way) | Read-heavy systems, database migrations |
| **Event Streaming** | Publish changes to message queue, both consume | Event-driven architectures |
| **Dual-Write + Reconciliation** | Write to both, periodic reconciliation job | Complex data models, conflict resolution needed |

### Benefits

- **Zero Downtime**: Users never experience outage
- **Gradual Validation**: Catch issues with small % of traffic first
- **Easy Rollback**: Just shift traffic back to old system
- **Real-World Testing**: Test new system with actual production load

### Challenges

- **Complexity**: Running two systems is operationally complex
- **Cost**: Double infrastructure during migration period
- **Data Consistency**: Synchronization bugs can cause data issues
- **Monitoring Overhead**: Need to watch both systems simultaneously

---

## Strategy Selection Decision Tree

Use this decision tree to select appropriate strategies:

```
START: What's the migration scope?
│
├─ Small (<10 files, <1 day effort)
│  └─ Strategy: Big-Bang (single phase, direct migration)
│
├─ Medium (10-50 files, 2-5 days effort)
│  └─ Is system critical?
│     ├─ Yes → Incremental + Rollback
│     └─ No → Incremental only
│
└─ Large (>50 files, >5 days effort)
   └─ Can system tolerate downtime?
      ├─ Yes → Incremental + Rollback
      └─ No → Incremental + Rollback + Dual-Run
```

**Special Cases**:

- **Data Migration**: Always use Rollback + Dual-Run (if possible)
- **First-Time Team Migration**: Use Incremental (learning curve)
- **Architecture Migration**: Consider Dual-Run (old/new systems coexist)
- **Breaking Changes**: Use Incremental (adapt gradually)

---

## Combined Strategies

### Common Combinations

**Incremental + Rollback** (Most Common):
- Break into phases (Incremental)
- Document rollback for each phase (Rollback)
- Use for: Most medium-large migrations

**Incremental + Rollback + Dual-Run** (Maximum Safety):
- Break into phases (Incremental)
- Document rollback (Rollback)
- Run old/new in parallel (Dual-Run)
- Use for: Critical systems, data migrations, zero-downtime requirements

**Example - Database Migration (MySQL → PostgreSQL)**:
```
Strategy: Incremental + Rollback + Dual-Run

Phase 1: Setup PostgreSQL + Replication
  Rollback: Drop PostgreSQL instance, stop replication
  Dual-Run: MySQL (primary), PostgreSQL (replica)

Phase 2: Dual-Write Mode
  Rollback: Stop writes to PostgreSQL, keep MySQL only
  Dual-Run: Write to both, read from MySQL

Phase 3: Shadow Read Mode
  Rollback: Revert read queries to MySQL only
  Dual-Run: Write to both, read from PostgreSQL (shadow)

Phase 4: Cutover
  Rollback: Switch connection strings back to MySQL
  Dual-Run: Write to both, read from PostgreSQL (primary)

Phase 5: Decommission MySQL
  Rollback: Re-activate MySQL, switch back
  Dual-Run: PostgreSQL only (MySQL kept for 30 days)
```

### Strategy Complexity Matrix

| Combination | Complexity | Duration Overhead | Risk Reduction |
|------------|------------|-------------------|----------------|
| Incremental only | Low | +20-40% | Medium |
| Incremental + Rollback | Medium | +30-50% | High |
| Incremental + Dual-Run | High | +50-80% | High |
| Incremental + Rollback + Dual-Run | Very High | +80-120% | Very High |

**Guidance**: Choose simplest strategy that adequately mitigates your risks. Over-engineering increases complexity without proportional benefit.

---

## Summary

**Key Takeaways**:
1. **Incremental** = Lower risk through phased execution
2. **Rollback** = Safety net for critical systems
3. **Dual-Run** = Zero downtime for live systems
4. **Combine strategies** based on risk, scope, and requirements
5. **Document procedures** before executing migration

**References in SKILL.md**:
- Phase 2 (Specification): Select migration strategy
- Phase 3 (Planning): Structure implementation plan by strategy
- Phase 4 (Execution): Execute according to selected strategy
- Phase 5 (Verification): Test rollback procedures (non-destructive)

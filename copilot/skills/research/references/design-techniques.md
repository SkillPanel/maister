# Design Techniques

These techniques guide Phase 3 (High-Level Design) of the research workflow. They provide patterns for capturing and documenting design decisions in a durable, traceable format.

---

### Decision Documentation Patterns

**Purpose**: Capture design decisions in a durable, traceable format.

**Why Document Decisions**:
- Future developers ask "why was this done this way?"
- Prevents re-litigating settled questions
- Preserves context that would otherwise be lost
- Enables informed changes when assumptions change

**MADR Format Overview** (Markdown Any Decision Record):
- Lightweight, readable, version-control friendly
- Sections: Status, Context, Decision Drivers, Considered Options, Decision Outcome, Consequences
- Each decision is self-contained and independently understandable

**When to Create an ADR**:
- Decision affects system structure or component boundaries
- Multiple viable alternatives existed (trade-offs involved)
- Decision is hard to reverse later
- Decision might be questioned by future developers

**Lightweight vs Heavyweight**:
- Lightweight (1 ADR, 10-20 lines): Simple designs with 1-2 key decisions
- Standard (2-5 ADRs, 20-40 lines each): Most designs
- Heavyweight (5+ ADRs): Complex systems with many interacting decisions

**Decision Linking**:
- Reference solution-exploration.md for alternatives already analyzed
- Link from high-level-design.md decision table to individual ADR entries
- ADRs from research inform (but don't replace) project-level ADRs in development

---

This reference provides patterns and frameworks for the design phase. Actual implementation adapts these concepts to specific research contexts.

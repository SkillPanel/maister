# Roadmap Document Templates

Select the appropriate template based on project type detected by project-analyzer.

## New Project (Feature-Based)

```markdown
# Development Roadmap

This roadmap outlines the planned features and development phases for [PROJECT_NAME].

## Phase 1: MVP (Minimum Viable Product)
**Timeline**: [Estimated]

- [ ] **Feature 1** — [Description] `[Effort: S/M/L]`
- [ ] **Feature 2** — [Description] `[Effort: S/M/L]`
- [ ] **Feature 3** — [Description] `[Effort: S/M/L]`

## Phase 2: Core Features
**Timeline**: [Estimated]

- [ ] **Feature 4** — [Description] `[Effort: S/M/L]`
- [ ] **Feature 5** — [Description] `[Effort: S/M/L]`

## Future Enhancements
- [ ] **Feature X** — [Nice to have]

---
**Effort Scale**: `S`: 2-3 days | `M`: 1 week | `L`: 2+ weeks
```

## Existing Project (Evolution)

```markdown
# Development Roadmap

## Current State
- **Version**: [From analysis]
- **Key Features**: [List major current features]
- **Recent Updates**: [From git history]

## Planned Enhancements (Next 3-6 Months)

### High Priority
- [ ] **Enhancement 1** — [Description and why it matters]
- [ ] **Enhancement 2** — [Description and why it matters]

### Medium Priority
- [ ] **Enhancement 3** — [Description]

### Technical Debt
- [ ] **Debt Item 1** — [From analysis, if applicable]
- [ ] **Debt Item 2** — [From analysis, if applicable]

## Future Considerations
- **Feature Ideas**: [Long-term possibilities]
- **Scalability**: [Performance improvements needed]
```

## Legacy Project (Modernization)

```markdown
# Modernization Roadmap

## Current State Assessment
- **Technology Age**: [From analysis]
- **Technical Debt**: [High/Medium/Low]
- **Outdated Components**: [List from analysis]
- **Security Concerns**: [If identified]

## Modernization Goals

### Critical (Must Do)
- [ ] **Upgrade [Component]** — [e.g., "Java 8 → Java 17 LTS"] `Risk: High if delayed`
- [ ] **Security Patch** — [Address known vulnerabilities]

### Important (Should Do)
- [ ] **Framework Update** — [e.g., "Spring 3.x → Spring Boot 3.x"]
- [ ] **Improve Test Coverage** — [Current: X%, Target: Y%]

### Improvements (Nice to Do)
- [ ] **Refactor Module X** — [Reduce technical debt]
- [ ] **Add Documentation** — [Architecture, deployment]

## Migration Strategy
[Step-by-step approach if major migration needed]

## Risk Mitigation
[How to reduce risk during modernization]

---
*Assessment based on project analysis performed [Date]*
```

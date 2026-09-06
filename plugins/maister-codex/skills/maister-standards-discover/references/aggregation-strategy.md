# Aggregation Strategy — Confidence Scoring & Deduplication

## Deduplication Rules

Group findings by `category + standard_name`. When multiple findings match:

1. **Merge evidence** — Combine all evidence items from all sources
2. **Track sources** — Note which phases contributed (config, code, docs, external)
3. **Take strongest description** — Prefer documented > config > code-inferred
4. **Preserve examples** — Combine unique examples

## Confidence Scoring

Calculate final confidence using these factors:

### Source Count (max 45 points)
- Each unique source: +15 points (config, code-patterns, documentation, pr-reviews, ci-config, pre-commit)
- Cap at 45 points (3+ sources)

### Consistency (max 20 points)
- >= 90% consistency across sampled files: +20
- 70-89% consistency: +10
- < 70% consistency: +0

### Explicitness (max 15 points)
- Found in config file (explicit rule): +15
- Found in documentation (explicitly stated): +10
- Inferred from code patterns only: +5

### Evidence Strength (max 20 points)
- Per evidence item: +5 points, cap at 20 (4+ evidence items)

### PR Feedback Boost (max 10 points)
- 5+ PR reviews mention this: +10
- 3-4 PR reviews: +5

**Final score**: Sum of factors, capped at 100.

## Conflict Detection

Flag conflicts when two findings for the same aspect give contradictory guidance:

- Same tool, different settings (e.g., ESLint vs Prettier disagreeing on semicolons)
- Documentation says one thing, config enforces another
- Code patterns don't match documented standards

Present each conflict to user with both sides and evidence.

## Confidence Categories

| Level | Range | Guidance |
|-------|-------|----------|
| High | >= 80% | Strong evidence, multiple sources. Safe to apply. |
| Medium | 60-79% | Some evidence, may need clarification. Review recommended. |
| Low | < 60% | Weak or inconsistent patterns. May indicate area needing standardization. |

## Presentation Order

1. High confidence findings (batch approval option)
2. Medium confidence findings (individual review)
3. Conflicts (resolution required)
4. Low confidence findings (informational, skip option)

## Presentation Format

Before approval prompts, present a **full summary table** grouped by confidence level. Each finding row shows:

- **Standard name** and **category**
- **Confidence score** (numeric, 0-100)
- **Sources** — all contributing sources listed (e.g., "config, code, docs"). This is key for user trust and decision-making.
- **Brief description** (one line, truncated if needed)

When drilling into individual findings (medium confidence, or user-requested drill-down), show:
- Full description and examples (preferred/avoid patterns)
- Evidence items with source attribution (which source provided each piece of evidence)
- Confidence score breakdown: show points from each factor (source count, consistency, explicitness, evidence strength, PR boost) so user understands why the score is what it is

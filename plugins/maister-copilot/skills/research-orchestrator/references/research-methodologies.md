# Research Methodologies Reference

This reference provides conceptual patterns and decision frameworks for research methodology selection and execution in the AI SDLC Research Orchestrator.

## Purpose

Research methodologies guide how information is gathered, analyzed, and synthesized to answer research questions. This reference helps the orchestrator select appropriate methodologies based on research type and adapt execution strategies to research objectives.

---

## Research Type Classification

### Decision Criteria

Research type classification determines which methodology to apply. Use question analysis and keyword detection:

**Technical Research**:
- **Keywords**: "how does", "where is", "what patterns", "how is implemented", "architecture of"
- **Focus**: Understanding codebase implementation, patterns, and architecture
- **Primary sources**: Source code, configuration, tests
- **Output emphasis**: Implementation details, architectural diagrams, pattern documentation

**Requirements Research**:
- **Keywords**: "what are the requirements", "user needs", "business requirements", "stakeholder", "acceptance criteria"
- **Focus**: Understanding what needs to be built and why
- **Primary sources**: Documentation, issues, user stories, PRs
- **Output emphasis**: Requirements lists, user stories, constraints, priorities

**Literature Research**:
- **Keywords**: "best practices", "industry standards", "recommended approach", "how others do", "state of the art"
- **Focus**: Understanding established patterns and recommendations
- **Primary sources**: Documentation, web resources, framework docs, academic papers
- **Output emphasis**: Best practices, trade-offs, recommendations

**Mixed Research**:
- **Keywords**: Combination of above or broad questions like "everything about X"
- **Focus**: Comprehensive understanding requiring multiple perspectives
- **Primary sources**: All applicable sources
- **Output emphasis**: Holistic view with multiple dimensions

---

## Methodology Selection Framework

### Technical Research Methodology

**When to use**: Investigating how something works in the codebase

**Approach**: Codebase analysis with iterative deepening

**Strategy**:
1. **Broad Discovery**: Pattern matching to find all relevant files
2. **Structural Analysis**: Understand organization and architecture
3. **Implementation Reading**: Read code to understand details
4. **Flow Tracing**: Follow execution paths and data flows
5. **Integration Mapping**: Understand connections and dependencies

**Tools**:
- Glob: File pattern matching
- Grep: Code pattern searching
- Read: Full file analysis
- Bash: Directory structure exploration

**Expected Timeline**: 2-4 phases depending on complexity

**Success Indicators**:
- All major components identified
- Execution flows documented
- Integration points mapped
- Patterns recognized and documented

---

### Requirements Research Methodology

**When to use**: Understanding what needs to be built

**Approach**: Documentation synthesis with stakeholder input analysis

**Strategy**:
1. **Document Collection**: Gather all requirement sources
2. **Content Extraction**: Extract requirements, user stories, acceptance criteria
3. **Categorization**: Organize by priority, stakeholder, feature area
4. **Gap Identification**: Find missing, conflicting, or unclear requirements
5. **Synthesis**: Create comprehensive requirement specification

**Tools**:
- Glob: Find requirement documents
- Read: Document analysis
- Grep: Search for keywords (requirement, must, should, acceptance criteria)

**Expected Timeline**: 2-3 phases

**Success Indicators**:
- All requirements captured
- Priorities established
- Conflicts resolved
- Acceptance criteria clear

---

### Literature Research Methodology

**When to use**: Understanding best practices or industry approaches

**Approach**: Multi-source review with comparative analysis

**Strategy**:
1. **Source Identification**: Find authoritative sources (framework docs, standards, papers)
2. **Content Review**: Read and extract key recommendations
3. **Comparison**: Compare different approaches and their trade-offs
4. **Applicability Assessment**: Evaluate what fits project constraints
5. **Recommendation**: Synthesize into actionable recommendations

**Tools**:
- WebSearch: Find authoritative sources
- WebFetch: Read external documentation
- Read: Internal documentation review

**Expected Timeline**: 2-3 phases

**Success Indicators**:
- Multiple authoritative sources consulted
- Approaches compared and contrasted
- Trade-offs understood
- Recommendations aligned with project constraints

---

### Mixed Research Methodology

**When to use**: Complex questions requiring multiple perspectives

**Approach**: Hybrid methodology combining above approaches

**Strategy**:
1. **Question Decomposition**: Break into technical, requirements, and literature sub-questions
2. **Parallel Investigation**: Execute appropriate methodology for each sub-question
3. **Cross-Referencing**: Identify relationships between different dimensions
4. **Integrated Synthesis**: Combine insights into holistic view

**Tools**: All applicable tools from above methodologies

**Expected Timeline**: 3-5 phases depending on breadth

**Success Indicators**:
- All dimensions investigated
- Relationships mapped between dimensions
- Holistic understanding achieved
- Comprehensive recommendations provided

---

## Source Identification Patterns

### Codebase Sources

**File Pattern Generation**:
1. Extract key terms from research question (nouns, technical terms)
2. Generate patterns:
   ```
   **/*{term}*.{js,ts,py,java,go,rb,php}
   **/services/{term}*
   **/controllers/{term}*
   **/middleware/{term}*
   **/models/{term}*
   **/utils/{term}*
   ```

3. Search by concept:
   ```
   Authentication → **/*auth*, **/security/*, **/session/*
   Database → **/*db*, **/*database*, **/*models*, **/*repository*
   API → **/*api*, **/*routes*, **/*controllers*, **/*endpoints*
   ```

**Directory Structure Analysis**:
- List directories to understand organization
- Identify module boundaries
- Map feature areas

**Test Files**:
- Tests provide usage examples and expected behavior
- Pattern: `**/*test*, **/*spec*, tests/**, __tests__/**`

**Configuration**:
- Configuration reveals setup and dependencies
- Files: `package.json`, `pom.xml`, `requirements.txt`, `Gemfile`, `go.mod`
- Config directories: `config/`, `.config/`, `conf/`

---

### Documentation Sources

**Project Documentation**:
- `.maister/docs/**/*.md` - AI SDLC framework documentation
- `docs/**/*.md` - Project documentation
- `README.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md` - Root docs

**Code Documentation**:
- Inline comments
- JSDoc, Javadoc, docstrings
- Header comments explaining purpose

**Standard Locations**:
```
docs/
  architecture/
  api/
  guides/
  standards/
.maister/docs/
  project/
  standards/
```

---

### Configuration Sources

**Dependency Files**:
- JavaScript: `package.json`, `yarn.lock`
- Python: `requirements.txt`, `Pipfile`, `pyproject.toml`
- Java: `pom.xml`, `build.gradle`
- Ruby: `Gemfile`
- Go: `go.mod`

**Environment Configuration**:
- `.env.example` (never .env - contains secrets)
- `config/*.{json,yml,yaml,toml}`
- Environment-specific: `config/development.yml`, `config/production.yml`

**Infrastructure Configuration**:
- `docker-compose.yml`
- `Dockerfile`
- `kubernetes/*.yaml`
- `.github/workflows/*.yml` (CI/CD)

---

### External Sources

**Framework Documentation**:
- Official docs for frameworks used (React, Django, Spring, Rails, etc.)
- Version-specific documentation (match versions in project)

**Best Practices**:
- Official style guides
- Industry standards (OWASP, W3C, IETF RFCs)
- Authoritative blogs and articles

**Academic Sources**:
- Research papers (if applicable)
- Technical specifications
- Standards documents

**Caution**: Validate external sources are:
- Authoritative (official or widely recognized)
- Current (not outdated)
- Applicable (matches project context)

---

## Information Gathering Strategies

### Iterative Deepening Strategy

**Phase 1: Broad Discovery** (fast, high-level)
- Use Glob to find all potentially relevant files
- Quick scan of directory structure
- Identify major areas

**Phase 2: Targeted Reading** (moderate depth)
- Read key files completely
- Extract main components and patterns
- Identify integration points

**Phase 3: Deep Dive** (detailed analysis)
- Trace specific flows
- Understand implementation details
- Map dependencies

**Phase 4: Verification** (validation)
- Cross-reference findings
- Validate understanding with tests
- Identify gaps

**Adaptation**: Skip or combine phases based on research complexity

---

### Multi-Source Triangulation Strategy

**Purpose**: Validate findings through multiple independent sources

**Approach**:
1. Gather information from source type A (e.g., code)
2. Gather information from source type B (e.g., docs)
3. Gather information from source type C (e.g., tests)
4. Compare findings across sources
5. High confidence: Sources agree
6. Medium confidence: Some agreement
7. Low confidence: Sources disagree or single source only

**Example**:
- **Code** says authentication uses JWT
- **Configuration** shows jwt library in dependencies
- **Tests** validate JWT token generation
- **Conclusion**: High confidence - JWT authentication confirmed by 3 sources

---

### Progressive Refinement Strategy

**Purpose**: Start broad, progressively narrow focus

**Approach**:
1. **Start Broad**: Search entire codebase for relevant terms
2. **Initial Filtering**: Identify most relevant directories/files
3. **Focused Investigation**: Deep dive into filtered set
4. **Targeted Expansion**: Expand to related areas as needed
5. **Final Verification**: Confirm understanding is complete

**Example**:
1. Search for "payment" across entire codebase → 150 files
2. Filter to payment module → 30 files
3. Read core payment service files → 5 files
4. Expand to payment gateway integration → 8 more files
5. Verify with payment tests → 10 test files

---

## Analysis Frameworks

### Technical Research Analysis Framework

**Component Inventory**:
- List all components/modules/classes
- Categorize by responsibility (service, controller, model, util)
- Map directory structure to logical architecture

**Pattern Recognition**:
- Identify design patterns (singleton, factory, strategy, etc.)
- Recognize architectural patterns (MVC, layered, microservices)
- Document consistency of pattern application

**Flow Analysis**:
- Trace request/response flows
- Map data transformations
- Document control flow (decision points, loops)
- Identify error handling flows

**Integration Mapping**:
- Internal dependencies (module A depends on module B)
- External dependencies (third-party libraries, external APIs)
- Database interactions
- Infrastructure dependencies

**Quality Assessment**:
- Code quality (duplication, complexity, readability)
- Test coverage (what's tested, what's not)
- Documentation quality (comprehensive, missing, outdated)
- Consistency (naming, structure, patterns)

---

### Requirements Research Analysis Framework

**Requirement Extraction**:
- Explicit requirements (stated directly)
- Implicit requirements (inferred from context)
- Non-functional requirements (performance, security, scalability)

**Categorization**:
- By feature area (reporting, authentication, data management)
- By stakeholder (admin, user, developer, operations)
- By priority (must-have, should-have, nice-to-have)
- By type (functional, non-functional, constraint)

**Gap Analysis**:
- Missing requirements (not specified)
- Ambiguous requirements (unclear)
- Conflicting requirements (contradictory)
- Incomplete requirements (missing details)

**Acceptance Criteria**:
- Testable conditions for requirement completion
- Success metrics
- User validation approach

---

### Literature Research Analysis Framework

**Source Evaluation**:
- Authority (official docs, recognized experts)
- Currency (up-to-date vs outdated)
- Relevance (applicable to project context)
- Completeness (comprehensive vs superficial)

**Approach Comparison**:
- Approach A: Description, pros, cons, use cases
- Approach B: Description, pros, cons, use cases
- Trade-offs: When to use which

**Applicability Assessment**:
- Technical fit (compatible with tech stack)
- Constraint fit (works within limitations)
- Resource fit (feasible with available resources)
- Risk assessment (implementation risks)

**Recommendation Synthesis**:
- What to adopt (and why)
- What to adapt (and how)
- What to avoid (and why)

---

## Research Execution Patterns

### Serial Execution Pattern

**When**: Phases depend on each other

**Flow**:
1. Complete Phase 1 fully
2. Use Phase 1 outputs for Phase 2
3. Complete Phase 2 fully
4. Continue sequentially

**Example**: Discovery → Reading → Deep Dive → Synthesis

---

### Parallel Execution Pattern

**When**: Independent sub-questions can be investigated simultaneously

**Flow**:
1. Decompose research question into independent sub-questions
2. Investigate each sub-question in parallel
3. Synthesize findings together

**Example**:
- Sub-question A: "How is authentication implemented?" (codebase)
- Sub-question B: "What are authentication best practices?" (literature)
- Both investigated independently, then synthesized

---

### Spiral Pattern

**When**: Understanding develops iteratively through repeated cycles

**Flow**:
1. Cycle 1: Surface-level understanding across all areas
2. Cycle 2: Moderate depth across all areas (informed by Cycle 1)
3. Cycle 3: Deep understanding in key areas (informed by Cycle 2)

**Example**:
- Cycle 1: Find all auth-related files (broad discovery)
- Cycle 2: Read main auth files (targeted reading)
- Cycle 3: Trace auth flow end-to-end (deep dive)

---

## Success Criteria Patterns

### Technical Research Success Criteria

✅ **Complete Component Inventory**: All major components identified
✅ **Documented Flows**: Key execution paths traced and documented
✅ **Pattern Recognition**: Design and architectural patterns identified
✅ **Integration Mapping**: Dependencies and integration points mapped
✅ **Evidence-Based**: All claims backed by code references

---

### Requirements Research Success Criteria

✅ **Comprehensive Coverage**: All requirements sources consulted
✅ **Categorized Requirements**: Requirements organized by priority, stakeholder, type
✅ **Gaps Identified**: Missing, ambiguous, conflicting requirements documented
✅ **Acceptance Criteria**: Clear success conditions defined
✅ **Stakeholder Alignment**: Requirements mapped to stakeholder needs

---

### Literature Research Success Criteria

✅ **Authoritative Sources**: Multiple credible sources consulted
✅ **Comparative Analysis**: Different approaches compared
✅ **Trade-offs Understood**: Pros/cons of each approach documented
✅ **Applicability Assessed**: Recommendations match project constraints
✅ **Actionable Recommendations**: Clear guidance for next steps

---

## Confidence Scoring Patterns

### High Confidence (90-100%)

**Indicators**:
- Multiple independent sources confirm
- Direct evidence (code, explicit docs)
- No contradictions found
- Verified through tests or usage examples

**Example**: "Authentication uses Passport.js with JWT strategy"
- Evidence: Code imports, configuration, tests, documentation all confirm

---

### Medium Confidence (60-89%)

**Indicators**:
- Single source or indirect evidence
- Inferred from patterns or context
- Minor contradictions or gaps
- Partial verification

**Example**: "Token refresh might be handled by client"
- Evidence: Server doesn't have refresh endpoint, but client code unclear

---

### Low Confidence (<60%)

**Indicators**:
- Speculation or assumption
- Contradictory evidence
- No direct confirmation
- Significant gaps in understanding

**Example**: "OAuth integration appears incomplete"
- Evidence: OAuth packages installed but no routes configured (ambiguous intent)

---

## Adaptation Strategies

### Adjust Scope Based on Findings

**Expand Scope**:
- If initial findings reveal related areas that must be understood
- If dependencies require understanding of additional components

**Narrow Scope**:
- If research question can be answered with subset of sources
- If areas are well-documented and don't need deep investigation

---

### Adjust Depth Based on Complexity

**Increase Depth**:
- If implementations are complex or non-standard
- If documentation is missing or incomplete
- If contradictions need resolution

**Decrease Depth**:
- If implementations are standard and well-documented
- If patterns are consistent and clear
- If multiple sources confirm understanding

---

### Adjust Timeline Based on Findings

**Extend Timeline**:
- Significant gaps in documentation
- Complex implementations requiring deep analysis
- Multiple contradictions to resolve

**Shorten Timeline**:
- Excellent documentation available
- Standard implementations
- High confidence early findings

---

## Common Pitfalls and Mitigations

### Pitfall: Scope Creep

**Problem**: Research expands beyond original question
**Mitigation**: Continuously refer back to research question; document scope expansions explicitly

---

### Pitfall: Insufficient Evidence

**Problem**: Making claims without adequate proof
**Mitigation**: Maintain strict citation discipline; mark low-confidence findings

---

### Pitfall: Missing Integration Points

**Problem**: Understanding components in isolation without seeing how they connect
**Mitigation**: Explicitly include integration mapping phase

---

### Pitfall: Outdated Information

**Problem**: Relying on old documentation or examples
**Mitigation**: Check file timestamps; prioritize recently modified files; verify docs match code

---

### Pitfall: Over-Confidence

**Problem**: Stating findings with more confidence than evidence warrants
**Mitigation**: Use confidence scoring; acknowledge limitations; document uncertainties

---

## Methodology Selection Decision Tree

```
Research Question Received
         |
         v
Keywords Indicate Type?
         |
    +----+----+
    |         |
Technical  Requirements  Literature  Mixed
    |         |            |          |
    v         v            v          v
Codebase  Documentation   Web       All
Analysis  Synthesis      Research   Methods
    |         |            |          |
    v         v            v          v
Iterative  Extraction   Comparative Hybrid
Deepening  Analysis    Analysis    Approach
```

---

This reference provides patterns and frameworks. Actual implementation adapts these concepts to specific research contexts.

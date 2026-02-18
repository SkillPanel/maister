# Migration Types Reference

> **Design Documentation**: This file serves as **design documentation** for developers and Claude implementing migration workflows. It provides guidance for identifying migration types and adapting workflows accordingly.

**Purpose:** Pattern guide for the three migration types: Code, Data, and Architecture

This reference provides characteristics, detection patterns, and workflow adaptations for each migration type supported by the migration-orchestrator.

---

## Table of Contents

1. [Overview](#overview)
2. [Code Migration](#code-migration)
3. [Data Migration](#data-migration)
4. [Architecture Migration](#architecture-migration)
5. [General Migration](#general-migration)
6. [Type Detection Algorithm](#type-detection-algorithm)

---

## Overview

Migration types classify migrations based on **what** is being changed:

| Type | Focus | Examples | Risk Profile |
|------|-------|----------|--------------|
| **Code** | Language, framework, library | Vue 2→3, Python 2→3, Express→Fastify | Medium |
| **Data** | Database, storage, schema | MySQL→PostgreSQL, MongoDB→DynamoDB | High |
| **Architecture** | Patterns, structure | REST→GraphQL, Monolith→Microservices | High |
| **General** | Mixed or unclear | Complex refactoring with multiple aspects | Variable |

### Why Type Matters

Different types require different:
- **Risk assessments**: Data migrations are highest risk (data loss potential)
- **Verification approaches**: Data needs integrity checks, code needs functional tests
- **Rollback strategies**: Data rollback more complex than code rollback
- **Tools and techniques**: Database tools for data, test suites for code

---

## Code Migration

### Definition

**What**: Changing programming language, framework, library, or major version with breaking changes

**Characteristics**:
- Source code modifications (syntax, APIs, patterns)
- Dependency updates (package.json, requirements.txt, pom.xml)
- No data transformation (data structures unchanged or minimal changes)
- Primarily affects developers (users may not notice if functionality same)

### Examples

**Framework Migrations**:
- Vue 2 → Vue 3 (composition API, breaking changes)
- Angular 8 → Angular 15 (modules to standalone components)
- React Class Components → Hooks
- Express 4 → Express 5

**Language Migrations**:
- Python 2 → Python 3 (print statements, unicode)
- JavaScript → TypeScript (type annotations)
- Java 8 → Java 17 (new syntax, APIs)

**Library Migrations**:
- Moment.js → Day.js (date handling library change)
- Axios → Fetch API (HTTP client change)
- Lodash → Native JavaScript (utility functions)

### Detection Keywords

**Primary Indicators**:
- Framework/library names: React, Vue, Angular, Express, Flask, Django, Spring, Rails
- Version terms: "upgrade", "migrate from X to Y", "move to version N"
- Language names: Python, Java, JavaScript, TypeScript, Go, Rust

**Example Descriptions**:
- "Migrate from Vue 2 to Vue 3" → Code migration (framework)
- "Upgrade Express to v5" → Code migration (major version)
- "Convert JavaScript to TypeScript" → Code migration (language)

### Workflow Adaptations

**Phase 1 (Current State Analysis)**:
- Focus: Locate all source files using old framework/library
- Analyze: Dependency tree, API usage patterns, deprecated features used

**Phase 2 (Target State Planning)**:
- Focus: Breaking changes between versions, API equivalents
- Output: Breaking changes list, API migration map

**Phase 3 (Specification)**:
- Include: Compatibility shim requirements (if needed)
- Rollback: Simple (revert code via git)

**Phase 5 (Execution)**:
- Strategy: Incremental (by module/component)
- Testing: Functional tests per module

**Phase 6 (Verification)**:
- Focus: Functional equivalence (behavior unchanged)
- Tests: Full test suite, manual testing of critical flows

### Risk Profile

**Medium Risk**:
- **Risk**: Breaking changes causing bugs, build failures
- **Mitigation**: Comprehensive test coverage, incremental migration
- **Rollback**: Relatively easy (git revert)

---

## Data Migration

### Definition

**What**: Changing database platform, storage system, or schema structure

**Characteristics**:
- Data transformation (format, structure, relationships)
- Schema changes (tables, columns, indexes, constraints)
- Data integrity critical (no data loss tolerated)
- Often requires dual-run (old and new databases running in parallel)

### Examples

**Platform Migrations**:
- MySQL → PostgreSQL (SQL database change)
- MongoDB → DynamoDB (document to key-value)
- Redis → Memcached (caching layer change)
- On-premise DB → Cloud DB (AWS RDS, Azure SQL)

**Schema Migrations**:
- Normalize database (split tables, add relationships)
- Denormalize for performance (merge tables)
- Add partitioning/sharding

**Storage Migrations**:
- Local files → S3 (file storage migration)
- S3 → GCS (cloud provider change)
- SQL → NoSQL (data model change)

### Detection Keywords

**Primary Indicators**:
- Database names: MySQL, PostgreSQL, MongoDB, Redis, DynamoDB, Cassandra, Oracle
- Data terms: "schema change", "data migration", "database migration", "move data"
- Storage terms: "S3", "blob storage", "file migration"

**Example Descriptions**:
- "Migrate database from MySQL to PostgreSQL" → Data migration (platform)
- "Move from MongoDB to DynamoDB" → Data migration (NoSQL change)
- "Migrate schema to normalized structure" → Data migration (schema)

### Workflow Adaptations

**Phase 1 (Current State Analysis)**:
- Focus: Database schema, row counts, data volume, stored procedures
- Analyze: Data relationships, foreign keys, indexes, constraints

**Phase 2 (Target State Planning)**:
- Focus: Data transformation requirements, data mapping (old → new schema)
- Output: Data transformation specification, estimated migration time

**Phase 3 (Specification)**:
- Include: Data validation procedures, integrity checks, rollback procedures
- Rollback: Complex (requires backup/restore strategies)
- Dual-Run: Often required (zero-downtime)

**Phase 5 (Execution)**:
- Strategy: Incremental + Dual-Run (high confidence in strategy choice)
- Testing: Data integrity checks after each batch

**Phase 6 (Verification)**:
- Focus: Data integrity (100% row count match, checksums, data validation)
- Tests: Full test suite + data integrity tests + performance benchmarks
- Critical: If data integrity fails, HALT (don't auto-fix, prompt user)

### Risk Profile

**High Risk**:
- **Risk**: Data loss, data corruption, downtime
- **Mitigation**: Backups before migration, dual-run, incremental batches, 100% data validation
- **Rollback**: Complex (restore from backup, may lose data written during migration)

**Special Requirements**:
- **Backup**: Full backup before starting (non-negotiable)
- **Data Validation**: 100% row count match, checksums, business rule validation
- **Dual-Run**: Strongly recommended (old and new databases in parallel)
- **Monitoring**: Data synchronization lag, replication errors
- **Testing**: More verification attempts (max 3 instead of 2 for auto-fix)

---

## Architecture Migration

### Definition

**What**: Changing fundamental system structure, communication patterns, or architectural style

**Characteristics**:
- System-wide changes (affects multiple components/services)
- Changes how components interact (APIs, communication patterns)
- May affect both code and data (comprehensive migration)
- Often requires gradual transition (old and new coexist)

### Examples

**API Style Migrations**:
- REST API → GraphQL (query language change)
- SOAP → REST (API pattern modernization)
- RPC → REST (communication pattern change)

**Architecture Pattern Migrations**:
- Monolith → Microservices (decomposition)
- Microservices → Monolith (consolidation)
- MVC → Component-Based (frontend architecture change)
- Layered → Hexagonal (backend architecture change)

**Infrastructure Migrations**:
- On-Premise → Cloud (infrastructure change)
- Single Server → Distributed (scalability)
- Synchronous → Event-Driven (async patterns)

### Detection Keywords

**Primary Indicators**:
- Pattern names: REST, GraphQL, gRPC, SOAP, RPC
- Architecture styles: Monolith, Microservices, Serverless, Event-Driven, Hexagonal
- Refactoring terms: "refactor to", "change architecture", "restructure"

**Example Descriptions**:
- "Refactor REST API to GraphQL" → Architecture migration (API style)
- "Migrate monolith to microservices" → Architecture migration (decomposition)
- "Change from MVC to component-based architecture" → Architecture migration (pattern)

### Workflow Adaptations

**Phase 1 (Current State Analysis)**:
- Focus: System components, communication patterns, dependencies between components
- Analyze: Coupling/cohesion, service boundaries, data flow

**Phase 2 (Target State Planning)**:
- Focus: New architecture structure, component boundaries, communication patterns
- Output: Architecture diagram, component mapping (old → new)

**Phase 3 (Specification)**:
- Include: Strangler fig pattern (if applicable), component interaction diagrams
- Rollback: Moderate to complex (depends on dual-run feasibility)
- Dual-Run: Often required (old and new architectures in parallel)

**Phase 5 (Execution)**:
- Strategy: Incremental (by component/service) + Dual-Run (if possible)
- Testing: Integration tests, end-to-end tests, performance tests

**Phase 6 (Verification)**:
- Focus: System-level behavior (end-to-end flows work), performance comparison
- Tests: Full test suite + integration tests + E2E tests

### Risk Profile

**High Risk**:
- **Risk**: System-wide breakage, performance degradation, complex rollback
- **Mitigation**: Strangler fig pattern, incremental component migration, dual-run
- **Rollback**: Moderate to complex (depends on how well old/new coexist)

**Special Patterns**:
- **Strangler Fig**: Gradually replace old system with new (route traffic to new incrementally)
- **Branch by Abstraction**: Create abstraction layer, switch implementations behind it
- **Parallel Run**: Run old and new architectures in parallel, compare results

---

## General Migration

### Definition

**What**: Migrations that don't fit cleanly into Code/Data/Architecture, or mix multiple types

**Characteristics**:
- Ambiguous description ("modernize", "refactor" without specifics)
- Multiple aspects (code + data + architecture)
- Catch-all for unclear migrations

### Examples

- "Modernize legacy system" (unclear scope)
- "Refactor application for scalability" (multiple aspects)
- "Migrate to cloud" (infrastructure + code + data)

### Workflow Adaptations

**Phase 1-2 (Analysis + Planning)**:
- Spend extra time clarifying scope
- Prompt user to specify what's changing (code, data, architecture, or all)
- May reclassify after analysis

**General Approach**:
- Use conservative defaults (high risk, incremental + rollback + dual-run)
- Prompt user more frequently for decisions
- Extra verification steps

---

## Type Detection Algorithm

### Overview

Migration type detection uses keyword matching with confidence scoring.

### Algorithm Pattern

**Input**: `"Migrate from Vue 2 to Vue 3"`

**Steps**:
1. **Extract Keywords**: `["migrate", "Vue", "2", "3"]`
2. **Match Against Patterns**:
   - Code: `["Vue"]` → 1 match
   - Data: `[]` → 0 matches
   - Architecture: `[]` → 0 matches
3. **Calculate Scores**:
   - Code: 1 match → 100% confidence (only category with matches)
   - Data: 0 matches → 0%
   - Architecture: 0 matches → 0%
4. **Select Type**: Code (highest score)
5. **Confirm with User** (interactive mode): "Detected migration type: Code. Correct? [Y/n]"

### Keyword Categories

**Code Migration Keywords**:
```
Frameworks: React, Vue, Angular, Express, Flask, Django, Rails, Spring, Laravel
Languages: Python, Java, JavaScript, TypeScript, Go, Rust, C++, C#, Ruby, PHP
Terms: "upgrade", "migrate from X to Y", "version", "framework migration"
```

**Data Migration Keywords**:
```
Databases: MySQL, PostgreSQL, MongoDB, Redis, DynamoDB, Cassandra, Oracle, SQL Server
Terms: "database", "schema", "data migration", "move data", "storage", "S3", "blob"
```

**Architecture Migration Keywords**:
```
Patterns: REST, GraphQL, gRPC, SOAP, Monolith, Microservices, Serverless, Event-Driven
Terms: "refactor to", "architecture", "pattern", "system design", "restructure"
```

### Ambiguity Handling

**Multiple Matches** (e.g., "Migrate MySQL database to PostgreSQL and refactor to microservices"):
- Scores: Code=0, Data=2 ("MySQL", "PostgreSQL"), Architecture=1 ("microservices")
- Primary Type: Data (highest score)
- Classification: Data + Architecture (mixed)
- Prompt user: "Detected primary type: Data. Also includes architecture changes. Proceed as data migration? [Y/n/specify]"

**No Clear Matches** (e.g., "Modernize application"):
- Scores: Code=0, Data=0, Architecture=0
- Classification: General
- Prompt user: "Unable to detect migration type. Please specify: [Code/Data/Architecture/Mixed]"

### Confidence Levels

| Score | Confidence | Action |
|-------|------------|--------|
| Single category with matches | 100% | Auto-detect, confirm in interactive |
| Primary category (>50% of matches) | 70-90% | Auto-detect, prompt to confirm |
| Tied categories | 50% | Prompt user to choose |
| No matches | 0% | Classify as General, prompt user |

---

## Web Research Requirements by Type

External research is automatically triggered by the gap-analyzer during Phase 2 (Target State Planning). The level of research depends on migration type.

| Migration Type | External Research | Query Focus | Priority Sources |
|---------------|-------------------|-------------|------------------|
| **Code** (Version Upgrade) | **Required** | Migration guides, breaking changes, API changes | Official docs, release notes, upgrade guides |
| **Code** (Library Swap) | **Required** | Comparison guides, migration paths, compatibility | Official docs, community migration stories |
| **Data** (Platform Change) | **Recommended** | Compatibility, data transformation, tooling | Official docs, DBA resources, cloud provider docs |
| **Data** (Schema Change) | **Optional** | Best practices only | Internal docs preferred |
| **Architecture** | **Recommended** | Pattern implementation, migration strategies | Architecture blogs, official docs |
| **General** | **Optional** | Clarification research | N/A |

### When to Skip External Research

- Pure internal refactoring (no external technology change)
- Schema changes within same database platform
- Minor version upgrades (patch versions only)
- When offline mode required
- User explicitly requests `--no-web-research`

### Research Depth by Complexity

| Complexity | Research Depth | Queries | Focus |
|------------|---------------|---------|-------|
| Simple (<10 files) | Essential | 2-3 | Official migration guide only |
| Moderate (10-30 files) | Essential | 2-3 | Migration guide + breaking changes |
| Complex (>30 files) | Expanded | 4-6 | Guide + breaking changes + community experiences |
| Data migration (any size) | Expanded | 4-6 | Guide + compatibility + data transformation |

### Example Research Queries

**Code Migration (Vue 2 → Vue 3)**:
- Primary: "Vue 2 to Vue 3 migration guide"
- Secondary: "Vue 3 breaking changes 2024"
- Expanded: "Vue 3 composition API migration examples"

**Data Migration (MySQL → PostgreSQL)**:
- Primary: "MySQL to PostgreSQL migration guide"
- Secondary: "PostgreSQL migration tools 2024"
- Expanded: "MySQL PostgreSQL syntax differences"

**Architecture Migration (REST → GraphQL)**:
- Primary: "REST to GraphQL migration guide"
- Secondary: "GraphQL migration best practices"
- Expanded: "REST GraphQL coexistence patterns"

---

## Summary

**Key Takeaways**:
1. **Code**: Focus on functional equivalence, incremental migration, medium risk
2. **Data**: Focus on data integrity, dual-run often required, high risk
3. **Architecture**: Focus on system-level behavior, strangler fig pattern, high risk
4. **General**: Conservative defaults, extra clarification with user

**References in SKILL.md**:
- Initialization (Step 2): Type detection algorithm
- Phase 1 (Analysis): Type-specific analysis focus
- Phase 2 (Target Planning): Type-specific gap analysis + external research
- Phase 6 (Verification): Type-specific verification requirements

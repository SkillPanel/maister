# AI SDLC Plugin

> Streamline your software development lifecycle with AI-powered workflows for Claude Code

The AI SDLC plugin brings structured, test-driven development workflows to your Claude Code projects. From feature development to bug fixes, performance optimization to security remediation—each task type gets a tailored, guided workflow with automated planning, implementation, and verification.

## What is AI SDLC Plugin?

AI SDLC is a comprehensive development workflow plugin that helps teams:

- **Plan systematically** with automatic task breakdown and dependency management
- **Implement safely** with test-driven development and continuous standards discovery
- **Verify thoroughly** with automated testing, code review, and production readiness checks
- **Document consistently** with built-in documentation generation and user guides
- **Track transparently** with detailed work logs and verification reports

Instead of ad-hoc development, you get structured workflows that adapt to your task type—whether you're building a new feature, fixing a bug, optimizing performance, or planning a migration.

## Quick Start

### Installation

1. Install the plugin in your Claude Code environment
2. Initialize the framework in your project:

```bash
/init-sdlc
```

> **Note**: Initialization analyzes your entire codebase to auto-detect coding standards, tech stack, and project conventions. This may take several minutes depending on project size. During this process, Claude may ask permission questions for file access and tool usage—you can approve these to allow the analysis to proceed.

This analyzes your codebase and creates the `.ai-sdlc/` structure with:
- Project documentation (vision, roadmap, tech stack)
- Coding standards (auto-detected from your codebase)
- Task organization folders

### Your First Task

The simplest way to start is with the `/work` command—it automatically classifies your task and routes to the appropriate workflow:

```bash
/work "Add user profile page with avatar upload"
```

The plugin will:
1. Analyze your description
2. Classify the task type (new feature, enhancement, bug fix, etc.)
3. Show you the proposed workflow
4. Ask for confirmation
5. Guide you through each phase

**Alternative**: Use specific workflow commands directly:

```bash
/ai-sdlc:development:new "Add user profile page" --type=feature
/ai-sdlc:development:new "Fix login timeout after 5 minutes" --type=bug
/ai-sdlc:development:new "Add sorting to user table" --type=enhancement
```

### Understanding the Output

Each task creates a structured directory in `.ai-sdlc/tasks/[type]/YYYY-MM-DD-task-name/`:

```
2025-11-17-user-profile-page/
├── metadata.yml              # Task tracking and status
├── analysis/
│   ├── requirements.md       # Gathered requirements
│   └── visuals/              # Design mockups
├── implementation/
│   ├── spec.md              # What to build
│   ├── implementation-plan.md  # How to build it
│   └── work-log.md          # Activity log
├── verification/
│   └── spec-verification.md  # Verification results
└── documentation/            # User-facing docs
```

## Key Features

### 5 Adaptive Task Types

Each task type has a specialized workflow optimized for its unique needs:

| Task Type | Use When | Key Features |
|-----------|----------|--------------|
| **New Feature** | Adding completely new capability | 6-7 phase workflow, optional E2E testing, user documentation |
| **Bug Fix** | Fixing defects and errors | TDD Red→Green enforcement, root cause analysis, regression prevention |
| **Enhancement** | Improving existing features | Existing feature analysis, gap detection, backward compatibility |
| **Performance** | Optimizing speed/efficiency | Profiling, bottleneck detection, benchmark validation |
| **Migration** | Moving tech/patterns | Strategy recommendation, rollback planning, dual-run support |

### Intelligent Workflow Features

- **Auto-Classification**: `/work` command automatically detects task type from description
- **Execution Modes**: Interactive (pause between phases) or YOLO (continuous execution)
- **Auto-Recovery**: Intelligent failure detection and recovery strategies
- **State Management**: Pause/resume capability with full state preservation
- **Standards Discovery**: Continuous standards checking throughout implementation
- **User-Centric Analysis**: Gap detection, user journey mapping, accessibility checks

### Comprehensive Verification

- **Test-Driven Development**: Write tests first, implement, then verify
- **Full Test Suite**: Run entire project test suite before completion
- **Code Review**: Automated quality, security, and performance analysis
- **Production Readiness**: Deployment readiness verification
- **Reality Checks**: Pragmatic validation that work actually solves the problem

## Core Workflows

### Feature Development

Build completely new capabilities with a comprehensive 6-7 phase workflow:

```bash
/ai-sdlc:development:new "Add two-factor authentication" --type=feature
```

**Phases**: Specification → Planning → Implementation → Verification → E2E Testing (optional) → User Documentation (optional)

**Best for**: New features, adding capabilities that don't exist yet

---

### Enhancements

Improve existing features with backward compatibility verification:

```bash
/ai-sdlc:development:new "Add export to CSV for user reports" --type=enhancement
```

**Phases**: Existing Feature Analysis → Gap Analysis → Specification → Planning → Implementation → Compatibility Verification

**Best for**: Improving, extending, or enhancing existing features

---

### Bug Fixes

Fix defects with mandatory TDD Red→Green discipline:

```bash
/ai-sdlc:development:new "Login timeout after 5 minutes of inactivity" --type=bug
```

**Phases**: Bug Analysis → Fix Implementation (TDD) → Testing & Verification → Documentation

**Best for**: Fixing bugs, errors, crashes with root cause analysis

---

### Performance Optimization

Optimize speed and efficiency with profiling and benchmarking:

```bash
/ai-sdlc:performance:new "Optimize dashboard loading time"
```

**Phases**: Baseline Profiling → Bottleneck Analysis → Implementation with Benchmarking → Performance Verification → Load Testing

**Best for**: Slow responses, high CPU/memory usage, scaling issues

---

### Migrations

Move technologies or patterns with rollback planning:

```bash
/ai-sdlc:migration:new "Migrate from REST to GraphQL API"
```

**Phases**: Current State Analysis → Target State Definition → Migration Strategy → Planning → Implementation → Cutover Verification

**Best for**: Technology upgrades, platform changes, architecture transitions

---

### Research

Investigate technical questions or gather requirements:

```bash
/ai-sdlc:research:new "How does authentication work in the codebase?"
```

**Phases**: Planning → Information Gathering → Analysis & Synthesis → Documentation

**Best for**: Understanding codebase, exploring best practices, requirements gathering

## Commands Quick Reference

### Workflow Commands

| Command | Description |
|---------|-------------|
| `/work [description]` | Auto-classify and route to appropriate workflow |
| `/ai-sdlc:development:new [desc]` | Start development workflow (bug fix, enhancement, or new feature) |
| `/ai-sdlc:performance:new [desc]` | Start performance optimization |
| `/ai-sdlc:migration:new [desc]` | Start migration workflow |
| `/ai-sdlc:research:new [question]` | Start research workflow |

### Resume Commands

All workflows support pause/resume:

```bash
/ai-sdlc:[workflow]:resume [task-path]
```

Example: `/ai-sdlc:development:resume .ai-sdlc/tasks/new-features/2025-11-17-user-profile`

### Utility Commands

| Command | Description |
|---------|-------------|
| `/init-sdlc` | Initialize AI SDLC framework |
| `/ai-sdlc:standards:discover` | Auto-discover coding standards |
| `/ai-sdlc:standards:update [path]` | Update project standards |
| `/ai-sdlc:reviews:code [path]` | Automated code quality analysis |
| `/ai-sdlc:reviews:pragmatic [path]` | Check for over-engineering |
| `/ai-sdlc:reviews:spec-audit [spec-path]` | Audit specification completeness |
| `/ai-sdlc:reviews:reality-check [task-path]` | Validate work actually solves problem |
| `/ai-sdlc:reviews:production-readiness [path]` | Pre-deployment verification |

## Design Principles

### Trust Claude to Reason

The plugin provides principles and patterns, not prescriptive implementations. Documentation guides thinking rather than dictating exact steps.

### User-Centric Development

Every workflow includes user journey analysis, gap detection, and accessibility checks. Features aren't complete until users can actually discover and use them.

### Test-Driven Approach

All implementation follows TDD principles: write tests first, implement, then verify. Bug fixes enforce mandatory Red→Green discipline.

### Continuous Standards Discovery

Standards from `.ai-sdlc/docs/INDEX.md` are checked throughout implementation, not just at the start. Standards become relevant as work progresses.

### Incremental Safety

Complex changes are broken into small, testable increments with git checkpoints (refactoring) or rollback procedures (migrations).

### Evidence-Based Verification

All findings must reference actual code. Read-only verification reports issues but doesn't fix them—developers should review and apply fixes intentionally.

---

**Made for teams who want structured, test-driven development workflows without sacrificing flexibility.**

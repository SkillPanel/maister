---
name: ai-sdlc:reviews:production-readiness
description: Verify production deployment readiness with comprehensive checks
---

> **CRITICAL**: Invoke the `ai-sdlc:production-readiness-checker` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass path and target arguments to the skill.

You are verifying production deployment readiness using the `production-readiness-checker` skill.

## Your Task

You are performing comprehensive production readiness analysis covering configuration, monitoring, error handling, performance, security, and deployment considerations.

## Parse User Request

**Determine the following from the user's request:**

1. **Path to analyze**:
   - If provided: Use the specified path
   - If not provided: Use AskUserQuestion to ask what to check

2. **Target environment**:
   - If `--target=prod`: Full production checks (recommended)
   - If `--target=staging`: Relaxed staging checks
   - If not specified: Assume production (full rigor)

## Your Instructions

**Invoke the production-readiness-checker skill NOW using the Skill tool:**

```
Skill: production-readiness-checker
Path: [path from user or from AskUserQuestion]
Target: [production|staging]
```

**Wait for the skill to complete before proceeding.**

The production-readiness-checker skill will:
1. Verify configuration management (env vars, secrets, feature flags)
2. Check monitoring & observability (logging, metrics, error tracking, health checks)
3. Assess error handling & resilience (retries, circuit breakers, graceful shutdown)
4. Evaluate performance & scalability (connection pooling, caching, rate limiting)
5. Review security hardening (HTTPS, CORS, security headers, vulnerabilities)
6. Analyze deployment considerations (migrations, zero-downtime, rollback plan)
7. Generate go/no-go deployment recommendation

## Examples

**Example 1**: Check specific task for production
```
User: /ai-sdlc:reviews:production-readiness .ai-sdlc/tasks/new-features/2025-10-24-payment-api/
```

**Example 2**: Check feature for staging
```
User: /ai-sdlc:reviews:production-readiness src/features/notifications/ --target=staging
```

**Example 3**: Comprehensive project check
```
User: /ai-sdlc:reviews:production-readiness .
```

## What to Expect

The production-readiness-checker will provide:
- Overall readiness score and status (🟢 Ready / 🟡 Concerns / 🔴 Not Ready)
- Clear GO/NO-GO deployment decision
- Category scores (Configuration, Monitoring, Error Handling, Performance, Security, Deployment)
- Deployment blockers that must be fixed
- Concerns with mitigation plans
- Recommendations for improvements
- Risk assessment and rollback criteria
- Post-deployment verification checklist

## Deployment Decision Outcomes

**🟢 Ready to Deploy**:
- All critical checks passed
- Low risk deployment
- Optional improvements listed

**🟡 Deploy with Caution**:
- No blockers but concerns exist
- Mitigation plan required
- Close monitoring needed
- Medium risk

**🔴 Do Not Deploy**:
- Critical issues present
- High/critical risk
- Must fix before deployment

## Notes

- This is verification only - no code will be modified
- Production checks are more rigorous than staging
- Focus on required items first (deployment blockers)
- Strongly recommended items should be addressed or have mitigation plan
- Nice to have items can be addressed post-deployment

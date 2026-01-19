---
name: ai-sdlc:standards:update
description: Update or create project standards from conversation context or explicit input
---

> **CRITICAL**: Invoke the `ai-sdlc:docs-manager` skill using the **Skill tool** IMMEDIATELY.
> Do NOT execute this workflow manually. Pass the standard path (if provided) to the skill.

# Update Project Standards

You are updating or creating project standards in `.ai-sdlc/docs/standards/` based on team discussions or explicit input. The command automatically determines whether to update an existing standard or create a new one.

## Command Usage

```bash
/ai-sdlc:standards:update [standard-path]
```

### Arguments

- **standard-path** (optional): Path to standard to update/create
  - Format: `standards/[category]/[name]`
  - Categories: `global`, `frontend`, `backend`, `testing`
  - Example: `standards/global/error-handling`
  - Example: `standards/frontend/components`
  - **If omitted**: Automatically extract from conversation context

## Examples

### Example 1: Extract from Conversation Context (Automatic)

```bash
/ai-sdlc:standards:update
```

**Conversation context**:
```
User: "We should always use React.memo for list item components"
User: "And use stable key props across renders"
```

**What happens**:
1. ✅ Scans conversation for conventions
2. ✅ Detects: React component performance practices
3. ✅ Categorizes: frontend/components
4. ✅ Checks if `standards/frontend/components.md` exists
5. ✅ If exists → Updates, if not → Creates
6. ✅ Asks: "I found conventions about React components. Update frontend/components.md?"
7. ✅ Invokes docs-manager to update/create
8. ✅ Regenerates INDEX.md

### Example 2: Explicit Standard Path (Automatic Update or Create)

```bash
/ai-sdlc:standards:update "standards/backend/caching"
```

**What happens**:
1. ✅ Checks if `standards/backend/caching.md` exists
2. ✅ If exists → "Updating existing standard: caching"
3. ✅ If not → "Creating new standard: caching"
4. ✅ Asks: "What caching practices should I document?"
5. ✅ Invokes docs-manager
6. ✅ Updates/creates standard + regenerates INDEX.md

### Example 3: Ambiguous Context (Asks User)

```bash
/ai-sdlc:standards:update
```

**Conversation context**:
```
User: "Always validate API request payloads before processing"
```

**What happens**:
1. ✅ Detects: Validation convention
2. ⚠️ Ambiguous: Could be `global/validation` OR `backend/api`
3. ❓ Uses AskUserQuestion: "This appears to be about validation. Which standard should I update?"
   - `standards/global/validation` - General validation practices
   - `standards/backend/api` - API-specific validation
   - Other (specify manually)
4. ✅ User selects → Auto-detects update vs create
5. ✅ Invokes docs-manager

## What You Are Doing

You will help the user update or create project standards by:

1. **Determining target standard** (from explicit path or conversation context)
2. **Automatically detecting action** (update existing or create new - no flags needed)
3. **Extracting conventions** (from discussion or asking user)
4. **Invoking docs-manager skill** (to perform the update/create)
5. **Validating integration** (INDEX.md regenerated, CLAUDE.md integrated)

## Your Workflow

### PHASE 1: Determine Target Standard

#### If standard-path Provided (Explicit Mode)

```
✓ Parse path: standards/[category]/[name]
✓ Validate format and category
✓ Continue to PHASE 2
```

#### If No standard-path (Context Extraction Mode)

**Step 1: Scan Recent Conversation**

Scan the last 15-20 messages for convention/standard discussions:

**Pattern matching** - Look for:
- "We should always..." / "Our team convention is..."
- "We prefer X over Y" / "Never use..."
- "The standard approach is..." / "Best practice is..."
- "Always..." / "Never..." statements about code
- Code examples showing patterns
- References to team practices

**Step 2: Categorize by Domain**

Based on keywords and context, categorize into:

**global/** - Language-agnostic standards:
- Keywords: error, exception, logging, validation, convention, naming, commenting
- Examples: error handling, validation patterns, coding style

**frontend/** - UI/client-side standards:
- Keywords: component, React, Vue, CSS, styling, accessibility, responsive, UI
- Examples: component patterns, CSS conventions, accessibility

**backend/** - Server-side standards:
- Keywords: API, endpoint, REST, GraphQL, model, database, query, migration, server
- Examples: API design, model patterns, query optimization

**testing/** - Test standards:
- Keywords: test, spec, unit, integration, E2E, coverage, assertion, mock
- Examples: test writing, test structure, coverage requirements

**Step 3: Extract Specific Practices**

From the conversation, extract:
- The specific convention or practice mentioned
- Examples or code snippets shared
- Context about when/why to apply it

**Step 4: Present Findings**

If **clear categorization** (high confidence):
```
Use AskUserQuestion:

Question: "I noticed these conventions in our discussion. Would you like to update this standard?"

Show:
- Category/Standard: [detected standard]
- Convention: [extracted practice summary]
- Will: [Update existing / Create new] (automatically detected)

Options:
- "Yes, proceed"
- "No, choose different standard"
- "Cancel"
```

If **ambiguous categorization** (multiple possible standards):
```
Use AskUserQuestion:

Question: "I detected a convention about [topic]. Which standard should I update?"

Options:
- standards/[category1]/[name1] - [description]
- standards/[category2]/[name2] - [description]
- Other (specify manually)
- Cancel
```

If **no context found**:
```
Output:
"⚠️ Could not detect conventions in recent conversation.

Please either:
1. Provide a standard path: /ai-sdlc:standards:update 'standards/[category]/[name]'
2. Tell me what convention you'd like to document
3. Browse existing standards to update

What would you like to do?"

Use AskUserQuestion with 3 options
```

### PHASE 2: Auto-Detect Update vs Create

**Check if standard exists**:

```bash
# Use Bash tool to check existence
test -f .ai-sdlc/docs/[standard-path].md && echo "EXISTS" || echo "NOT_FOUND"
```

**Automatic decision** (no user prompt needed):

If **EXISTS**:
```
Output: "✓ Standard found: [name]"
Output: "→ Mode: Update existing standard"
→ Continue to PHASE 3 (gather updates)
```

If **NOT_FOUND**:
```
Output: "⚠️ Standard not found: [name]"
Output: "→ Mode: Create new standard"
→ Continue to PHASE 3 (gather content for new standard)
```

**Exception**: Only ask user if the path seems wrong:
```
If path validation fails (invalid category, malformed path):
  Use AskUserQuestion:
  "The standard path appears invalid. Did you mean:
  - [suggested correction]
  - Browse existing standards
  - Cancel"
```

### PHASE 3: Gather Standard Content

#### If Updating Existing Standard

**Step 1: Read Current Content**

```bash
# Read current standard
cat .ai-sdlc/docs/[standard-path].md
```

**Step 2: Show Current + Ask for Changes**

```
Output current standard summary:
"📝 Current standard: [name]

Current practices include:
[Bullet points of existing practices]

What would you like to add or change?"
```

**Step 3: Extract New Content**

From user's response and conversation context, extract:
- New practices to add
- Existing practices to modify
- Practices to remove
- Code examples to include

#### If Creating New Standard

**Step 1: Ask for Content**

```
Output:
"📝 Creating new standard: [name]

This standard will be created in: .ai-sdlc/docs/[standard-path].md

Please describe the practices, conventions, or guidelines for this standard.
You can provide:
- Bullet points of practices
- Code examples
- Do's and Don'ts
- When to apply these practices"
```

**Step 2: Extract Content**

From user's response and conversation context, extract:
- Practices and conventions
- Code examples
- Rationale/context
- Best practices

**Step 3: Optional - Show Plugin Baseline**

If a similar baseline exists in plugin standards:
```
Output:
"💡 The ai-sdlc plugin includes a baseline for [similar-standard].
Would you like to see it for reference?

Use AskUserQuestion:
- "Yes, show baseline"
- "No, continue without reference"
```

If user wants to see:
```bash
# Read plugin baseline
cat skills/docs-manager/docs/standards/[category]/[similar-name].md
```

### PHASE 4: Invoke docs-manager Skill

**Construct context for docs-manager**:

```
Context to provide:
- Standard path: [standard-path].md
- Operation: [update | create]
- Current content: [if updating]
- New content to add: [extracted conventions/practices]
- Maintain formatting: markdown with bullet points
- Organize logically: group related practices
```

**Invoke the docs-manager skill NOW using the Skill tool:**

```
command: docs-manager
```

Provide detailed context:

For **Update**:
```
"Update documentation file: [standard-path].md

Current content:
[show current content]

Add/change these practices:
[extracted new conventions]

Please:
1. Integrate the new practices into the existing standard
2. Maintain markdown formatting (bullet points, code blocks)
3. Organize practices logically (group related items)
4. Preserve existing practices unless conflicts exist
5. Update INDEX.md to reflect changes
6. Verify CLAUDE.md integration"
```

For **Create**:
```
"Create new documentation file: [standard-path].md

Standard category: [category]
Standard name: [name]

Content to include:
[extracted conventions and practices]

Please:
1. Create the standard file with proper markdown formatting
2. Organize practices with clear sections
3. Include code examples where provided
4. Add to INDEX.md with appropriate description
5. Verify CLAUDE.md integration"
```

**Wait for docs-manager to complete before proceeding.**

### PHASE 5: Validate & Summarize

**Step 1: Run Validation Checks**

```bash
# Verify file exists/updated
test -f .ai-sdlc/docs/[standard-path].md && echo "✓ Standard file verified"

# Check file has content
[ -s .ai-sdlc/docs/[standard-path].md ] && echo "✓ Standard has content"

# Verify INDEX.md includes this standard
grep -q "[standard-name]" .ai-sdlc/docs/INDEX.md && echo "✓ INDEX.md updated"

# Check CLAUDE.md references standards
grep -q "ai-sdlc/docs/standards" CLAUDE.md && echo "✓ CLAUDE.md integrated"
```

**Step 2: Display Success Summary**

```markdown
✅ Standard [Updated/Created] Successfully!

📝 Standard: [name]
📁 Category: [category]
📂 Location: .ai-sdlc/docs/[standard-path].md

## [Updated/New] Practices

[Bullet list of what was added/changed]

## Integration Status

✓ Standard file [updated/created]
✓ INDEX.md regenerated
✓ CLAUDE.md integration verified

## Next Steps

### 1. Review the Standard

```bash
cat .ai-sdlc/docs/[standard-path].md
```

### 2. Apply in Current Work

- The standard is now active for all implementations
- AI assistants will reference this automatically via INDEX.md
- implementer skill will apply during continuous standards discovery

### 3. Share with Team

```bash
# Commit the standard
git add .ai-sdlc/docs/[standard-path].md .ai-sdlc/docs/INDEX.md
git commit -m "Update [standard-name] standard: [brief description]"
git push
```

### 4. Verify Compliance (Optional)

```bash
# Check if existing code follows the standard
/ai-sdlc:code-review:review --scope=quality
```

💡 **Tip**: Standards are living documents. Update them as your team's practices evolve.
```

## Error Handling

### Invalid Standard Path

**Error**: Path doesn't match `standards/[category]/[name]` format

**Response**:
```
❌ Invalid standard path: [provided-path]

Standard path must follow format: standards/[category]/[name]

Valid categories:
- global - Language-agnostic standards
- frontend - UI/client-side standards
- backend - Server-side standards
- testing - Test standards

Examples:
- standards/global/error-handling
- standards/frontend/components
- standards/backend/api
- standards/testing/test-writing

Use AskUserQuestion:
- "Specify valid path manually"
- "Extract from conversation context"
- "Cancel"
```

### No .ai-sdlc/docs/ Directory

**Error**: Project not initialized

**Response**:
```
❌ .ai-sdlc/docs/ directory not found

This project hasn't been initialized with ai-sdlc framework yet.

Use AskUserQuestion:
- "Run /init-sdlc to initialize framework"
- "Cancel and initialize manually later"
```

If user chooses initialize:
```
→ Invoke: /init-sdlc
→ Wait for completion
→ Resume standards update
```

### docs-manager Skill Fails

**Error**: docs-manager returns error

**Response**:
```
❌ Failed to [update/create] standard

The docs-manager skill encountered an error:
[error message from docs-manager]

Use AskUserQuestion:
- "Retry the operation"
- "Edit standard file manually (provide instructions)"
- "Cancel"
```

If retry selected:
```
→ Re-invoke docs-manager with same context
→ Max 2 retry attempts
```

If manual edit selected:
```
Output manual instructions:
"To manually [update/create] the standard:

1. Edit: .ai-sdlc/docs/[standard-path].md
2. Add your conventions in markdown format
3. Run: /ai-sdlc:docs-manager
4. Select: 'Manage INDEX.md'
5. Regenerate the index"
```

### Conversation Context Extraction Fails

**Error**: No conventions detected in conversation

**Response**:
```
⚠️ Could not detect conventions in recent conversation

No discussion about coding standards, practices, or conventions found in the last 20 messages.

Use AskUserQuestion:
- "Specify standard path manually" → Prompt for path
- "Describe convention to document" → Prompt for content
- "Cancel"
```

### Ambiguous Categorization

**Error**: Convention could match multiple standards

**Response**:
```
⚠️ Multiple possible standards detected

The convention "[extracted practice]" could apply to:

Use AskUserQuestion with options:
- standards/[category1]/[name1] - [why it fits]
- standards/[category2]/[name2] - [why it fits]
- standards/[category3]/[name3] - [why it fits]
- Other (specify manually)
- Cancel
```

## Integration Points

### With docs-manager Skill

**Primary operations used**:
- **Operation 3 (Add Documentation File)**: For creating new standards
- **Operation 4 (Update Documentation)**: For updating existing standards
- **Operation 2 (Manage INDEX.md)**: Automatic regeneration after changes
- **Operation 7 (Manage CLAUDE.md Integration)**: Verification

### With implementer Skill

**Impact**:
- Updated standards immediately available for continuous discovery
- implementer reads INDEX.md throughout implementation
- New/updated standards automatically applied in active work

### With Other Commands

**Complementary commands**:
- `/init-sdlc` - Initializes standards baseline (prerequisite)
- `/ai-sdlc:code-review:review` - Checks compliance with standards
- Orchestrators (feature, enhancement, migration, bug-fix) - Apply standards during implementation automatically

## Notes

**Context Extraction**:
- Best-effort from conversation history (last 15-20 messages)
- Pattern matching for convention keywords
- Always confirms with user before proceeding
- Falls back to manual input if detection fails

**Automatic Update vs Create**:
- No flags needed (`--create` not required)
- Checks file existence automatically
- Transparently handles both operations
- Only prompts user if path is invalid or ambiguous

**Standards Scope**:
- Updates go to `.ai-sdlc/docs/standards/` (project-specific)
- Does NOT modify plugin baseline standards
- Project standards override plugin baselines

**Immediate Effect**:
- Standards active immediately after update/create
- AI assistants read from INDEX.md
- No restart or reload needed

**Version Control**:
- Recommend committing standard changes
- Treat standards like code
- Notify team of updates

**Team Communication**:
- Standards represent team decisions
- Communicate changes to team
- Consider PR review for significant standard changes

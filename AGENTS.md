# confluence-cli: Agent Integration Guide

This guide is for AI agents (Claude Code, Copilot, or other AI frameworks) that will drive this CLI to reorganize Confluence spaces.

## Core Principles

### 1. Use Named Commands, Never Raw REST

**Good:**
```bash
confluence bulk move --ids 111,222 --to 999 --execute
```

**Bad:**
```bash
curl -X POST https://domain.atlassian.net/wiki/rest/api/content/111/move \
  -d '{"targetParentId":999,...}'
```

Named commands have a fixed, validated shape. There is no method/URL/body for you to hallucinate. The surface for mistakes essentially disappears.

### 2. Always Dry-Run First

Every bulk/mirror command defaults to a dry-run preview. Read it before executing:

```bash
# 1. Preview the plan
confluence bulk move --ids 111,222,333 --to 999

# 2. Read the terraform-style output
# Move plan: 3 operations
#   MOVE "Page A" (111)  → under 999 (append)
#   MOVE "Page B" (222)  → under 999 (append)
#   MOVE "Page C" (333)  → under 999 (append)
# 
# Summary: 3 move
# Dry run — re-run with --execute to apply.

# 3. Then execute
confluence bulk move --ids 111,222,333 --to 999 --execute
```

The plan is a human-readable artifact you can reason about and approve before anything is written.

### 3. Mirror Is Idempotent — Retries Are Safe

`mirror` uses find-or-create logic. Re-running is always safe:

```bash
# First run: creates all pages
confluence mirror ./docs MYSPACE --execute

# Re-run after interrupted upload: retries from the start
# Previously successful items are updated (no-op if unchanged)
# Failed items are retried; new items created
confluence mirror ./docs MYSPACE --execute

# This converges instead of duplicating
```

After a partial failure, just re-run the same command. Do not try to filter or resume—idempotency makes the full re-run the right move.

### 4. Parse `--json` Output for Automation

All bulk/mirror commands support `--json` for scripting:

```bash
# Capture created page ID
ID=$(confluence create "Notes" DOCS --content "..." --json | jq -r '.id')

# Check move results
confluence bulk move --ids 111,222 --to 999 --execute --json | jq '.failed'

# Monitor mirror operation
confluence mirror ./kb DOCS --execute --json | jq '.counts'
```

Human-readable messages go to stderr, so stdout is always valid JSON.

### 5. Interpret Structured Errors & Exit Codes

Each failure includes:
1. A clear message
2. A stable exit code (e.g., 403 → permission, 404 → not found, 429 → rate limit)
3. A `Hint:` to guide recovery

```bash
confluence bulk move --ids 123 --to 999 --execute

Error: Permission denied (403).
Hint: You are authenticated but lack rights on this space/content. Check space permissions, or that the profile is not read-only.

$ echo $?
4
```

Exit code 4 tells you: permission issue. Act on the hint, not the error message alone.

**Recovery patterns:**
- **Exit 3 (AUTH)** → Re-initialize: `confluence init`
- **Exit 4 (PERMISSION)** → Check space rights or profile mode
- **Exit 5 (NOT_FOUND)** → Verify IDs; may have been deleted
- **Exit 6 (CONFLICT)** → Title collision or version conflict; rename or re-read
- **Exit 7 (RATE_LIMIT)** → Lower `--concurrency` and retry
- **Exit 9 (NETWORK)** → Check connectivity; retry later

### 6. Use Read-Only Profiles for Safe Exploration

For exploratory runs or when you're not sure, create a read-only profile:

```bash
confluence profile add agent-ro \
  --domain "company.atlassian.net" \
  --auth-type basic \
  --email "bot@example.com" \
  --token "token" \
  --read-only

confluence --profile agent-ro bulk move --ids 111,222 --to 999  # Plan only (writes blocked)
```

A read-only profile physically prevents write operations at the CLI level. This is a hard guardrail.

### 7. Understand Per-Space Title Uniqueness

Confluence requires titles to be unique **per space**. If `mirror` reports a collision, that title already exists:

```
✗ Getting Started: Conflict (409).
    The content changed under you (version conflict) or a page with that title already exists.
    Re-read and retry.
```

Solutions:
- Rename the source file
- Delete the conflicting page in Confluence
- Use a different parent folder to disambiguate (e.g., "Getting Started (v2)")

### 8. Handle the Folder-No-Cascade Gotcha

**Confluence limitation:** Deleting a folder does NOT cascade-delete child folders — they get re-parented to the space root.

**The CLI handles this for you:** When you use `bulk delete --subtree`, it enumerates all descendants and deletes them deepest-first, ensuring children are gone before their parents. You get expected cascade behavior.

```bash
# Safe: CLI ensures deepest-first deletion
confluence bulk delete --subtree 123456 --execute --yes

# Individual deletes: children are NOT deleted
confluence bulk delete --ids 123456 --execute --yes  # Parent only; children remain
```

---

## Recipes

### Recipe 1: Port a Local Docs Folder

```bash
# 1. Dry-run to see what will be created
confluence mirror ./docs DOCS

# 2. Review the plan
# Mirror plan: 25 operations
#   CREATE folder "Getting Started"
#   CREATE "Overview"
#   CREATE "Installation"
#   ...

# 3. Apply
confluence mirror ./docs DOCS --execute

# 4. Verify in Confluence UI (usually instant)
```

**Idempotency:** If interrupted, just re-run `confluence mirror ./docs DOCS --execute`. It will skip what succeeded and retry what failed.

### Recipe 2: Reorganize Pages (Move + Restructure)

```bash
# 1. Identify pages to move (CQL query or IDs)
confluence search 'space = DOCS and title ~ "draft*"' --json | jq -r '.results[].id' > draft_ids.txt

# 2. Plan the move
confluence bulk move --ids-file draft_ids.txt --to 456789 # (target folder id)

# 3. Review the plan
# Move plan: 12 operations
#   MOVE "Draft Roadmap" (123)  → under 456789 (append)
#   ...

# 4. Execute
confluence bulk move --ids-file draft_ids.txt --to 456789 --execute

# 5. Verify counts
confluence bulk move --ids-file draft_ids.txt --to 456789 --execute --json | jq '{moved: .moved, failed: .failed}'
```

### Recipe 3: Clean Up Old Documentation

```bash
# 1. Find old pages (by space, date range, or pattern)
confluence search 'space = ARCHIVE and lastModified < 2022' --json > old_pages.json

# 2. Extract IDs
jq -r '.results[].id' old_pages.json > old_ids.txt

# 3. Preview deletion
confluence bulk delete --ids-file old_ids.txt

# 4. Review the plan and confirm
# Delete plan: 47 operations
#   DELETE "Old Feature Docs" (987)
#   ...

# 5. Execute (--yes skips confirmation)
confluence bulk delete --ids-file old_ids.txt --execute --yes

# 6. Verify
confluence bulk delete --ids-file old_ids.txt --execute --yes --json | jq '.deleted'
```

### Recipe 4: Subtree Export & Reorganize

```bash
# 1. Export a subtree (for backup or offline review)
confluence export 123456 --recursive --dest ./backup_2024

# 2. Make local edits if needed
# (edit files in ./backup_2024)

# 3. Mirror the edited tree back into a staging space
confluence mirror ./backup_2024 STAGING --parent 789 --execute

# 4. Once verified, move to production space
# (use bulk move to reorganize as needed)

# 5. Or delete old space
confluence bulk delete --from-search 'space = OLDDOCS' --execute --yes
```

---

## Best Practices

### Plan Before Execute

The terraform-style plan is your friend. Always read it:

```bash
# Bad: Execute first, check later
confluence bulk move --ids 111,222,333 --to 999 --execute

# Good: Plan → review → execute
confluence bulk move --ids 111,222,333 --to 999      # See the plan
confluence bulk move --ids 111,222,333 --to 999 --execute  # Then apply
```

### Slow Down If Rate-Limited

Default concurrency is 4. If you hit rate limits (429 errors), reduce it:

```bash
confluence bulk move --ids 111,222,333 --to 999 --concurrency 1 --execute
```

### Retry Gracefully on Partial Failure

Bulk operations don't stop if one item fails. If you see failures:

```bash
# Re-run the same command to retry
confluence bulk move --ids 111,222,333 --to 999 --execute

# Or extract just the failed IDs and retry those
confluence bulk move --ids 222,333 --to 999 --execute  # e.g., if 111 failed
```

### Use Read-Only Profiles in Exploratory Runs

Before writing, use read-only mode to explore safely:

```bash
# Safely explore (writes blocked)
confluence --profile agent-ro search 'space = DOCS'
confluence --profile agent-ro info 123456

# Once confident, switch to writable profile
confluence --profile default bulk move --ids 111,222 --to 999 --execute
```

### Log What You Do

For debugging and reproducibility, save commands and output:

```bash
# Log the plan before executing
confluence bulk move --ids 111,222,333 --to 999 | tee move_plan.log

# Log the execution
confluence bulk move --ids 111,222,333 --to 999 --execute --json | tee move_result.json | jq '.moved, .failed'
```

---

## Limitations & Edge Cases

### Search Index Lag

`--from-search` uses Confluence's search index, which may lag by a few seconds. For newly created pages, use `--ids` instead:

```bash
# Reliable for recently changed content
ID=$(confluence create "New Page" DOCS --content "..." --json | jq -r '.id')
confluence bulk move --ids $ID --to 999 --execute
```

### Folder Renames Not Supported

Single `move --title` only works for pages. Folders ignore the title option:

```bash
confluence move 123456 789012 --title "New Title"

# If 123456 is a folder, you'll see:
# ⚠ Renaming is not supported for folders; moved without renaming.
```

### Permissions Check

Bulk operations require write permissions on the target space. Read-only profiles block all writes at the CLI level.

### Title Collisions in Mirror

Confluence enforces per-space title uniqueness. Mirror reports collisions and skips them (non-fatal):

```
2 item(s) failed:
  ✗ Getting Started: Conflict (409).
```

Rename files locally or delete conflicting pages in Confluence.

---

## Integration with Agents

This CLI is designed for agents that reason step-by-step:

1. **Issue commands with `--json`** to capture structured output
2. **Inspect `--json` results** to decide next steps
3. **Use exit codes** to detect failures and recover
4. **Plan before execute** — always preview before applying changes
5. **Retry safely** — idempotent mirror and graceful bulk failures mean retries work

Example agent pseudocode:

```python
# Agent planning a documentation migration

# 1. Explore (read-only)
spaces = run("confluence spaces --json")
docs_space = find_space(spaces, "DOCS")

# 2. Make a plan
pages_to_move = run(f"confluence search 'space = {docs_space} and title ~ \"draft*\"' --json")

# 3. Preview (dry-run)
plan = run(f"confluence bulk move --ids {ids} --to {target}")
print(f"Preview: {plan}")  # User reads this

# 4. Execute (only after user approves or agent is confident)
result = run(f"confluence bulk move --ids {ids} --to {target} --execute --json")
if result.failed > 0:
    # Retry failed items
    retry_ids = extract_failed_ids(pages_to_move, result)
    run(f"confluence bulk move --ids {retry_ids} --to {target} --execute")
```

The CLI provides the determinism and feedback an agent needs to make safe, verifiable decisions.

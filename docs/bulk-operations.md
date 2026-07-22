# Bulk Operations & Mirroring Reference

This guide covers commands for operating on many pages and folders at once: `bulk move`, `bulk delete`, `mirror`, and the single `move` command that supports folders and cross-space operations.

## Core Philosophy: Dry-Run by Default

Every bulk operation defaults to a dry-run preview. The workflow is:

1. **Plan** — run the command without `--execute` to see what will happen
2. **Review** — read the terraform-style plan output (terraform plan, but for Confluence)
3. **Execute** — add `--execute` to apply the changes

This separation prevents accidental mass updates and gives you (or an agent) a chance to verify the plan before making irreversible changes.

---

## Move: Single Page or Folder

Move a single page or folder to a new parent. Supports folders and cross-space moves via Confluence's dedicated move endpoint (no body rewrite).

### Usage

```bash
confluence move <pageId_or_url> <newParentId_or_url>
```

### Options

- `-p, --position <position>` — Placement under the new parent: `append` (default), `before`, or `after`
- `-t, --title <title>` — Also rename the moved page (pages only; folders do not support renaming)
- `--json` — Output JSON for scripting

### Examples

```bash
# Move page 123 under parent 456
confluence move 123 456

# Place it before its siblings (instead of at the end)
confluence move 123 456 --position before

# Move and rename in one step (pages only)
confluence move 123 456 --title "New Title"

# Move using URLs for convenience
confluence move "https://domain.atlassian.net/wiki/viewpage.action?pageId=123" \
               "https://domain.atlassian.net/wiki/viewpage.action?pageId=456"
```

### Key Details

- **No body rewrite** — Uses Confluence's dedicated move endpoint, so the page content is never touched
- **Folders supported** — Unlike older implementations, this handles folders correctly
- **Cross-space moves** — Can move pages and folders to parents in different spaces
- **Renaming pages only** — The `--title` option only works for pages; folders ignore it with a warning
- **Immediate effect** — Single moves are applied immediately (no dry-run phase)

---

## Bulk Move: Many Pages or Folders

Move many pages or folders under a new parent in one operation. Sources are mutually exclusive—pick exactly one.

### Usage

```bash
confluence bulk move --to <parentId> [source options]
```

### Required Option

- `--to <parentIdOrUrl>` — Destination parent ID or URL (can be a page, folder, or space root)

### Source Options (pick one)

- `--ids <list>` — Comma/space/newline-separated IDs or URLs
- `--ids-file <file>` — File containing IDs or URLs (one per line)
- `--from-search <cql>` — CQL query to select items to move

### Optional Options

- `-p, --position <position>` — Placement: `append` (default), `before`, or `after`
- `-c, --concurrency <n>` — Parallel moves (default: 4)
- `--execute` — Apply the moves (default is dry-run)
- `--json` — Output JSON

### Examples

```bash
# Dry-run: preview moving two items
confluence bulk move --ids 111,222 --to 999

# Apply it
confluence bulk move --ids 111,222 --to 999 --execute

# Load IDs from a file
confluence bulk move --ids-file targets.txt --to 999 --execute

# Move everything matching a CQL query
confluence bulk move --from-search 'space = DOCS and title ~ "draft*"' --to 999 --execute

# Place moved items before siblings instead of appending
confluence bulk move --ids 111,222,333 --to 999 --position before --execute

# Slow down to avoid rate limits
confluence bulk move --ids 111,222,333 --to 999 --concurrency 2 --execute
```

### Workflow

```bash
# 1. Preview the plan
confluence bulk move --ids 111,222,333 --to 999

# 2. Review the output (shows what will move where)
# Move plan: 3 operations
#   MOVE "Draft Roadmap" (111)  → under 999 (append)
#   MOVE "Q4 Planning" (222)    → under 999 (append)
#   MOVE "Scratchpad" (333)     → under 999 (append)
# 
# Summary: 3 move
# Dry run — re-run with --execute to apply.

# 3. Apply it
confluence bulk move --ids 111,222,333 --to 999 --execute
```

### Exit Codes & Failures

- **Exit code 0** — All items moved successfully
- **Exit code 1** — One or more items failed; successful ones were still moved

Failures are printed with actionable hints (see [Exit Codes](#exit-codes) below). A single failure does not stop the batch.

---

## Bulk Delete: Many Pages or Folders

Delete many pages or folders to trash (recoverable) in one operation. Supports whole-subtree deletion with automatic cascade handling.

### Usage

```bash
confluence bulk delete [source options]
```

### Source Options (pick one)

- `--ids <list>` — Comma/space/newline-separated IDs or URLs
- `--ids-file <file>` — File containing IDs or URLs (one per line)
- `--from-search <cql>` — CQL query to select items to delete
- `--subtree <idOrUrl>` — Delete this item AND all of its descendants (deepest-first)

### Optional Options

- `-c, --concurrency <n>` — Parallel deletes (default: 4; subtree mode forces 1 for safety)
- `--execute` — Apply the deletes (default is dry-run)
- `-y, --yes` — Skip the interactive confirmation prompt (required with `--execute` in `--json` mode)
- `--json` — Output JSON

### Examples

```bash
# Dry-run: preview deleting individual items
confluence bulk delete --ids 111,222,333

# Apply it
confluence bulk delete --ids 111,222,333 --execute --yes

# Load IDs from a file
confluence bulk delete --ids-file targets.txt --execute --yes

# Delete items matching a CQL query
confluence bulk delete --from-search 'space = ARCHIVE and status = current' --execute --yes

# Delete a whole subtree (page + all descendants)
confluence bulk delete --subtree 123456

# Confirm visually, then apply
confluence bulk delete --subtree 123456 --execute --yes

# Use in scripting (JSON output requires --yes)
confluence bulk delete --subtree 123456 --execute --yes --json | jq '.deleted'
```

### Workflow

```bash
# 1. Preview a subtree deletion (shows the entire tree to be deleted)
confluence bulk delete --subtree 123456

# 2. Review the output
# Delete plan: 47 operations
#   DELETE "Sub-section 3.4" (34567)
#   DELETE "Sub-section 3.5" (34568)
#   ...
#   DELETE "Architecture Overview" (123456)
# 
# Summary: 47 delete
# Dry run — re-run with --execute to delete 47 item(s) to trash.

# 3. Apply it (--yes skips the confirmation prompt)
confluence bulk delete --subtree 123456 --execute --yes
```

### Important: Subtree Deletion & Cascade Behavior

**Confluence limitation:** Deleting a container (folder or page with children) does **NOT** automatically cascade-delete child folders — they get re-parented to the space root instead. This is unintuitive and error-prone.

**How the tool handles it:** When you use `--subtree`, the CLI enumerates **all descendants** via Confluence's immediately-consistent child endpoint and deletes them explicitly, **deepest-first**, ensuring every child is gone before its parent. This gives you the expected cascade behavior while working around Confluence's limitation.

- **Individual deletes** (`--ids`, `--ids-file`, `--from-search`) delete each supplied item as-is; children are not affected
- **Subtree delete** (`--subtree`) deletes the root and every descendant, deepest-first

### Exit Codes & Failures

- **Exit code 0** — All items deleted successfully
- **Exit code 1** — One or more items failed; successful ones were still deleted

---

## Mirror: Idempotent Folder-to-Confluence Sync

Recreate a local folder of `.md` files as a folder/page tree in Confluence. Idempotent: existing items are updated, missing ones are created. Safe to re-run; re-runs converge instead of duplicating.

### Usage

```bash
confluence mirror <localDir> <spaceKey>
```

### Arguments

- `<localDir>` — Local directory containing folders and `.md` files
- `<spaceKey>` — Target Confluence space key

### Optional Options

- `--parent <idOrUrl>` — Root the mirror under an existing page or folder instead of the space root
- `--execute` — Create/update pages in Confluence (default is dry-run)
- `--json` — Output JSON

### How It Maps

| Local | Confluence |
|-------|-----------|
| Directory | Folder |
| `.md` file | Page |
| Filename | Title (`.md` stripped, `-` and `_` → spaces) |

Example: `getting-started.md` becomes a page titled "Getting Started".

### Examples

```bash
# Dry-run: preview mirroring ./docs into space DOCS
confluence mirror ./docs DOCS

# Apply it
confluence mirror ./docs DOCS --execute

# Mirror into a subfolder instead of space root
confluence mirror ./docs DOCS --parent 123456 --execute

# Mirror from a URL (useful for CI/CD)
confluence mirror ./kb MYSPACE --parent "https://domain.atlassian.net/wiki/viewpage.action?pageId=789" --execute
```

### Workflow

```bash
# 1. Preview (shows what will be created/updated)
confluence mirror ./kb DOCS

# Mirror plan: 15 operations
#   CREATE folder "Getting Started"
#   CREATE "Getting started"
#   CREATE "Installation"
#   CREATE folder "Reference"
#   CREATE "API Overview"
#   ...
# 
# Summary: 3 create, 2 skip, 5 update
# Dry run — re-run with --execute to apply.

# 2. Review the plan and tree structure
# 3. Apply it
confluence mirror ./kb DOCS --execute
```

### Idempotency & Retries

Mirror is idempotent: re-running is always safe.

- **First run** — Creates all folders and pages
- **Re-run after edit** — Updates existing pages with new content from `.md` files, creates any new files added to the directory
- **Re-run after failure** — Retries from the beginning; previously successful items are updated (idempotent), new items created, failed items tried again

This makes it safe to retry in CI/CD pipelines or if a command is interrupted.

### Per-Space Title Uniqueness

**Confluence constraint:** Page and folder titles must be unique **per space**. If two files have the same title, or a title already exists in the space (even in trash), the collision is reported and skipped.

```bash
confluence mirror ./kb DOCS --execute

Mirror applied: 10 item(s) processed
2 item(s) failed:
  ✗ Getting Started: Conflict (409).
      The content changed under you (version conflict) or a page with that title already exists. Re-read and retry.
  ✗ FAQ: Conflict (409).
      The content changed under you (version conflict) or a page with that title already exists. Re-read and retry.

Note: Confluence requires page/folder titles to be unique per space — collisions usually mean that title already exists (possibly in trash).
```

**Solutions:**
- Rename the local file to avoid the collision
- Delete the conflicting page from Confluence (or empty trash if it's there)
- Move the conflicting item to a different space

---

## Exit Codes

All commands use stable exit codes so agents can recover automatically:

| Code | Name | Cause | Guidance |
|------|------|-------|----------|
| 0 | Success | All operations completed (or dry-run succeeded) | — |
| 1 | GENERIC | Partial failure (some operations succeeded, some failed) | Review error messages; re-run to retry failed items |
| 3 | AUTH | 401 — credentials rejected | Re-run `confluence init` with a fresh API token |
| 4 | PERMISSION | 403 — authenticated but not allowed | Check space/page permissions; verify profile is not read-only |
| 5 | NOT_FOUND | 404 — no such page/folder/space | Verify IDs, space keys, URLs; check if items were already deleted |
| 6 | CONFLICT | 409 — version conflict or title collision | For title collisions, rename or delete the conflicting item; for version conflicts, re-read and retry |
| 7 | RATE_LIMIT | 429 — too many requests | Lower `--concurrency` or retry with `--delay-ms` between requests; Confluence may suggest a wait time |
| 8 | SERVER | 5xx — Confluence server error | Retry later; if persistent, check Atlassian status page |
| 9 | NETWORK | Connection failed — DNS/TLS/timeout | Check network/VPN; verify domain in config is reachable |

Each failure includes a `Hint:` to guide recovery.

---

## JSON Output

All bulk/mirror commands support `--json` for scripting:

```bash
# Dry-run JSON
confluence bulk move --ids 111,222 --to 999 --json | jq '.count'

# Execute and parse results
confluence bulk move --ids 111,222,333 --to 999 --execute --json | jq '{moved: .moved, failed: .failed}'

# Mirror and check counts
confluence mirror ./kb DOCS --execute --json | jq '.counts'
```

---

## Related Commands

For whole-subtree export (read-only), use the existing `export` command:

```bash
# Export a page and all descendants as files with attachments
confluence export <pageId> --recursive --dest ./exports
```

This is separate from deletion and is safe to use alongside bulk operations.

---

## Troubleshooting

### CQL Indexing Lag vs Immediately-Consistent Reads

`--from-search` uses Confluence's search index (CQL), which may lag behind recent changes by a few seconds. For newly created or just-moved pages, use `--ids` or `--ids-file` instead:

```bash
# This might miss pages just created
confluence bulk move --from-search 'space = DOCS and title ~ "new*"' --to 999

# More reliable for recently changed pages
confluence info <newPageId> --json | jq -r '.id' >> targets.txt
confluence bulk move --ids-file targets.txt --to 999
```

### Slow Operations

Bulk operations default to 4 parallel workers. If you hit rate limits (429), slow down:

```bash
confluence bulk move --ids 111,222,333 --to 999 --concurrency 1 --execute
```

### Permission & Read-Only Profiles

Bulk operations require write permissions. If your profile is read-only, switch to a writable profile or create one:

```bash
confluence --profile default bulk move --ids 111,222 --to 999 --execute
```

### Re-running After Partial Failure

If a bulk operation fails partway through:

1. **Some items succeeded, some failed** — Run the command again with only the failed IDs to retry them
2. **Mirror operation** — Just re-run `confluence mirror` with the same directory; it will skip items that succeeded and retry failures

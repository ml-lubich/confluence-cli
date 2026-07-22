# confluence-cli: robust, LLM-agent-friendly bulk operations

**Date:** 2026-07-21
**Status:** Approved, in build
**Fork:** `ml-lubich/confluence-cli` (generic, public, MIT — no org-specific content in the repo)

## Goal

Turn `confluence-cli` into a tool an LLM agent (or a human) can safely use to
**reorganize and port whole knowledge bases** in Confluence — move, mirror,
delete, and export at the level of trees, not single pages — through
**first-class, self-describing commands**, never raw REST verbs.

"Done" =
1. `bulk move`, `mirror`, `bulk delete`, `bulk export` implemented and green.
2. The broken `move` internals replaced (folders + cross-space, no body rewrite).
3. Every command has rich `--help` + worked examples and actionable errors.
4. Unit + mocked-HTTP tests with a real coverage gate; a live sandbox smoke test passes.
5. README explains why the design is the best fit for LLM agents.

## Why (the problem with the tool today)

`movePage` hardcodes `type: 'page'`, reads `body.storage.value`, and PUTs the
whole content back. Consequences:
- **Folders can't move** (no body → throws).
- **Cross-space moves are blocked** by an explicit guard.
- **Macro-heavy pages risk mangling** on the full-body rewrite.
- There is **no bulk anything** — an agent must hand-write `api -X PUT ...` loops,
  which is exactly the error-prone, hallucination-friendly path we want to remove.

## Design principles

- **First-class commands, not REST.** Every capability is a named subcommand with
  typed, validated flags. `api` remains only as a documented, de-emphasized escape hatch.
- **Plan then execute.** Pure planners compute an `Operation[]`; a thin executor runs it.
  Destructive/bulk ops are **dry-run by default** and print a plan (terraform-style);
  `--execute`/`--yes` performs it.
- **Errors and help are features.** A central error formatter maps every failure to an
  actionable message + exit code. Every command ships examples in `--help`.
- **Clean code (SRP/KISS/YAGNI).** Small, single-purpose modules; pure logic isolated
  from I/O so it is exhaustively unit-testable. Build only the four ops + shared engine.
- **Generic.** No org names, spaces, tokens, or hostnames in the repo. Org specifics live
  only in the user's local config and the (gitignored) sandbox.

## Architecture

```
lib/bulk/
  operation.js   # the Operation type + factory helpers (move/create/delete/update)
  planner.js     # PURE: (inputs) -> Operation[]  — no I/O, fully unit-tested
  executor.js    # takes Operation[] + client; concurrency, dry-run, progress, rollback-safe ordering
  render.js      # PURE: Operation[] -> human plan text (the "terraform plan" view)
  mirror.js      # PURE-ish: local dir tree -> desired Confluence tree -> diff vs actual -> Operation[]
lib/errors.js    # central: HTTP/API error -> {message, hint, exitCode}
bin/commands/
  bulk.js        # `bulk move|delete|export` subcommands (wiring + flag validation only)
  mirror.js      # `mirror` subcommand
```

Client additions (`lib/confluence-client.js`):
- `moveContent(id, position, targetParentId)` → `PUT /content/{id}/move/{position}/{targetParentId}`
  (works for pages AND folders; supports cross-space). Replaces the rewrite path.
- `listChildren(id)`, `getContentType(id)`, `findChildByTitle(parentId, title)` for idempotent mirror.

## Commands

### `confluence bulk move`
Move many items under a new parent.
- Sources (one required): `--ids <a,b,c>` | `--ids-file <f>` | `--from-search <cql>` | `--subtree <id>`.
- `--to <parentId|url>` (required). `--position append|before|after` (default append).
- Dry-run by default → prints plan. `--execute` to run. `--concurrency <n>` (default 4).
- Handles folders and cross-space moves natively.

### `confluence mirror <localDir> <spaceKey>`
Recreate a local folder-of-`.md` tree as folders+pages. **Idempotent** (find-or-create by
title+parent; update body when changed). `--parent <id>` to root it under a page.
`--prune` (optional) to trash remote items absent locally. Dry-run by default.

### `confluence bulk delete`
Delete a list/subtree to trash. Sources as in `bulk move`. Dry-run by default; `--execute`
required; prints a loud warning + item count; refuses `--subtree` without `--execute --yes`.

### `confluence bulk export <spaceKey|--subtree id> <dir>`
Export a tree to Markdown + attachments, preserving hierarchy as directories.

## Error handling

`lib/errors.js` maps: 401 → auth/token guidance; 403 → "token lacks permission on space/space X";
404 → "no content with id X — if you pasted a URL, that's fine; check the id/space"; 409 →
version conflict; 429 → rate-limit (respect Retry-After); network → connectivity. Each returns a
one-line cause + a `Hint:` line + a stable non-zero exit code. Destructive ops emit warnings before acting.

## Testing

- **Unit (pure):** planner, render, mirror-diff, operation factories, error mapping, id/URL resolution.
- **Client integration:** `axios-mock-adapter` for moveContent/create/delete/list/mirror flows.
- **Coverage gate:** `jest --coverage` with thresholds enforced in CI config.
- **Live smoke (gated by `CONFLUENCE_TEST_PARENT` env):** create sandbox tree → mirror a tiny local
  md tree in → move it → export it → delete it → assert each via API reads. Skipped without the env var.

## README additions (LLM-agent-friendliness — required)

A section "Why this is built for AI agents" covering:
- **Deterministic, named operations** beat free-form REST: no method/URL/body hallucination surface.
- **Dry-run + plan** gives an agent a reviewable intermediate it can reason about before committing.
- **Structured, actionable errors** are recoverable by an agent without a human.
- **Idempotent mirror** makes retries safe.
- **`--json` everywhere** for machine parsing; **`-h/--help` with examples** as inline documentation.

## Out of scope (YAGNI)

Cross-space *space creation*, permission editing, blog posts, watchers/labels bulk ops,
a TUI. Not now.

## Execution

Driven by `/autopilot` + `/loop` until the goal above is met, TDD throughout (red→green per
command), committing to `main` of the fork. Live testing against a disposable sandbox
(`confluence-cli-sandbox`) in the user's instance — never committed to the repo.

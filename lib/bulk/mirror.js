'use strict';

const fs = require('fs');
const path = require('path');

/** Turn a file/dir name into a page title: drop .md, tidy separators. */
function titleFromName(name) {
  return name
    .replace(/\.md$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || name;
}

/**
 * Scan a local directory into a desired Confluence tree. Directories become
 * folders; `.md` files become pages. Dotfiles are ignored. Deterministic order.
 * Pure aside from reading the filesystem.
 *
 * @returns {Array<{kind:'folder'|'page', title:string, name:string, path:string, children?:any[]}>}
 */
function scanLocalTree(dir) {
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const nodes = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      nodes.push({
        kind: 'folder',
        title: titleFromName(e.name),
        name: e.name,
        path: full,
        children: scanLocalTree(full),
      });
    } else if (e.isFile() && /\.md$/i.test(e.name)) {
      nodes.push({ kind: 'page', title: titleFromName(e.name), name: e.name, path: full });
    }
  }
  return nodes;
}

/**
 * Reconcile a desired tree against Confluence, find-or-create style. Records a
 * plan entry per node in `ctx.ops`. When `ctx.execute` is false, nothing is
 * written (dry run). Sequential by necessity: children need their parent's id.
 *
 * A single node failing (e.g. a title collision — Confluence requires titles to
 * be unique per space) is recorded in `ctx.failures` and does NOT abort the run;
 * remaining nodes still process. A folder that fails to create skips its
 * children (they have nowhere to go).
 *
 * @param {object} client
 * @param {Array} nodes
 * @param {{ spaceKey:string, parentId:(string|null), execute:boolean, ops:Array, failures?:Array, underNewParent?:boolean, readFile?:Function }} ctx
 */
async function mirrorNodes(client, nodes, ctx) {
  const { spaceKey, parentId, execute, ops } = ctx;
  const failures = ctx.failures || (ctx.failures = []);
  const underNewParent = Boolean(ctx.underNewParent);
  const readFile = ctx.readFile || ((p) => fs.readFileSync(p, 'utf8'));

  for (const node of nodes) {
    // Inside a parent that doesn't exist yet (dry-run create), nothing can
    // pre-exist — skip the lookup and treat everything as a create.
    const existing = underNewParent
      ? null
      : parentId
        ? await client.findChildByTitle(parentId, node.title)
        : await client.findContentByTitleInSpace(spaceKey, node.title);

    if (node.kind === 'folder') {
      let id = null;
      let failed = false;
      if (existing) {
        id = existing.id;
        ops.push({ action: 'skip', target: `folder "${node.title}"`, detail: 'exists' });
      } else {
        ops.push({ action: 'create', target: `folder "${node.title}"` });
        if (execute) {
          try {
            const created = parentId
              ? await client.createChildPage(node.title, spaceKey, parentId, '', 'storage', 'folder')
              : await client.createPage(node.title, spaceKey, '', 'storage', 'folder');
            id = String(created.id);
          } catch (error) {
            failed = true;
            failures.push({ item: { id: '-', title: `folder "${node.title}"` }, error });
          }
        }
      }
      if (failed) {
        ops.push({ action: 'skip', target: `children of "${node.title}"`, detail: 'parent failed' });
      } else {
        await mirrorNodes(client, node.children || [], {
          spaceKey,
          parentId: id,
          execute,
          ops,
          failures,
          readFile,
          underNewParent: underNewParent || (!existing && !execute),
        });
      }
    } else if (existing) {
      ops.push({ action: 'update', target: `"${node.title}"` });
      if (execute) {
        try {
          await client.updatePage(existing.id, node.title, readFile(node.path), 'markdown');
        } catch (error) {
          failures.push({ item: { id: existing.id, title: node.title }, error });
        }
      }
    } else {
      ops.push({ action: 'create', target: `"${node.title}"` });
      if (execute) {
        try {
          const content = readFile(node.path);
          if (parentId) {
            await client.createChildPage(node.title, spaceKey, parentId, content, 'markdown', 'page');
          } else {
            await client.createPage(node.title, spaceKey, content, 'markdown', 'page');
          }
        } catch (error) {
          failures.push({ item: { id: '-', title: node.title }, error });
        }
      }
    }
  }
  return ops;
}

module.exports = { scanLocalTree, mirrorNodes, titleFromName };

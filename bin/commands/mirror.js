'use strict';

const fs = require('fs');
const chalk = require('chalk');
const { scanLocalTree, mirrorNodes } = require('../../lib/bulk/mirror');
const { renderPlan, summarize } = require('../../lib/bulk/plan');

function registerMirrorCommand(program, { withClient }) {
  program
    .command('mirror <localDir> <spaceKey>')
    .description('Recreate a local folder of .md files as a folder/page tree in Confluence (idempotent)')
    .option('--parent <idOrUrl>', 'Root the mirror under an existing page/folder instead of the space root')
    .option('--execute', 'Actually create/update pages (default is a dry-run preview)')
    .addHelpText('after', `
Directories become folders; .md files become pages. Titles come from names
("getting-started.md" → "getting started"). Re-running is safe: existing items
are updated, missing ones are created (find-or-create).

Examples:
  # Preview mirroring ./kb into space DOCS (no changes made):
  $ confluence mirror ./kb DOCS

  # Apply it, rooted under an existing page:
  $ confluence mirror ./kb DOCS --parent 123456 --execute`)
    .action(withClient('mirror', async ({ client, analytics, wantsJson, emitJson }, localDir, spaceKey, options) => {
      if (!fs.existsSync(localDir) || !fs.statSync(localDir).isDirectory()) {
        throw new Error(`Local directory not found or not a directory: ${localDir}`);
      }

      const tree = scanLocalTree(localDir);
      const ops = [];
      await mirrorNodes(client, tree, {
        spaceKey,
        parentId: options.parent || null,
        execute: Boolean(options.execute),
        ops,
      });

      const counts = summarize(ops);
      if (wantsJson()) {
        emitJson({
          dryRun: !options.execute,
          executed: Boolean(options.execute),
          spaceKey,
          parent: options.parent || null,
          counts,
          operations: ops,
        });
        analytics.track(options.execute ? 'mirror' : 'mirror_dry_run', true);
        return;
      }

      const header = options.execute ? 'Mirror applied' : 'Mirror plan';
      console.log(renderPlan(ops, { header }));
      if (!options.execute && ops.length) {
        console.log(chalk.yellow('\nDry run — re-run with --execute to apply.'));
      } else if (options.execute) {
        console.log(chalk.green('\n✅ Mirror complete.'));
      }
      analytics.track(options.execute ? 'mirror' : 'mirror_dry_run', true);
    }, { writable: true }));
}

module.exports = registerMirrorCommand;

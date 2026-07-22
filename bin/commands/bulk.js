'use strict';

const chalk = require('chalk');
const inquirer = require('inquirer');
const { resolveTargets } = require('../../lib/bulk/resolve');
const { renderPlan } = require('../../lib/bulk/plan');
const { runWithConcurrency } = require('../../lib/bulk/run');
const { formatApiError } = require('../../lib/errors');

const parseConcurrency = (raw) => {
  const n = parseInt(raw, 10);
  return Number.isNaN(n) || n < 1 ? 4 : n;
};

// Print one line per failure, translated into an actionable message.
const reportFailures = (failures) => {
  for (const f of failures) {
    const { message, hint } = formatApiError(f.error);
    const label = f.item?.title ? `"${f.item.title}" (${f.item.id})` : JSON.stringify(f.item);
    console.error(chalk.red(`  ✗ ${label}: ${message}`));
    if (hint) console.error(chalk.gray(`      ${hint}`));
  }
};

function registerBulkCommands(program, { withClient }) {
  const bulk = program
    .command('bulk')
    .description('Bulk operations over many pages/folders — dry-run by default, --execute to apply');

  // ---- bulk move -------------------------------------------------------------
  bulk
    .command('move')
    .description('Move many pages/folders under a new parent (folders + cross-space supported)')
    .requiredOption('--to <parentIdOrUrl>', 'Destination parent id or URL')
    .option('--ids <list>', 'Comma/space/newline separated ids or URLs')
    .option('--ids-file <file>', 'File containing ids/URLs (one per line)')
    .option('--from-search <cql>', 'Select items to move by a CQL query')
    .option('-p, --position <position>', 'Placement under the parent: append | before | after', 'append')
    .option('-c, --concurrency <n>', 'Number of parallel moves', '4')
    .option('--execute', 'Actually perform the moves (default is a dry-run preview)')
    .addHelpText('after', `
Examples:
  # Preview moving two items under a new parent (no changes made):
  $ confluence bulk move --ids 111,222 --to 999

  # Apply it:
  $ confluence bulk move --ids 111,222 --to 999 --execute

  # Move everything matching a CQL query:
  $ confluence bulk move --from-search 'space = DOCS and title ~ "draft*"' --to 999 --execute

Sources are mutually exclusive: pick exactly one of --ids, --ids-file, --from-search.`)
    .action(withClient('bulk_move', async ({ client, analytics, wantsJson, emitJson }, options) => {
      const items = await resolveTargets(client, options);
      const concurrency = parseConcurrency(options.concurrency);
      const entries = items.map((i) => ({
        action: 'move',
        target: `"${i.title}" (${i.id})`,
        detail: `→ under ${options.to} (${options.position})`,
      }));

      if (!options.execute) {
        if (wantsJson()) {
          emitJson({ dryRun: true, count: items.length, to: options.to, position: options.position, items });
        } else {
          console.log(renderPlan(entries, { header: 'Move plan' }));
          if (items.length) console.log(chalk.yellow('\nDry run — re-run with --execute to apply.'));
        }
        analytics.track('bulk_move_dry_run', true);
        return;
      }

      const { failures } = await runWithConcurrency(
        items,
        (i) => client.moveContent(i.id, options.to, options.position),
        {
          concurrency,
          onProgress: wantsJson() ? null : ({ completed, total }) =>
            process.stdout.write(`\r  moved ${completed}/${total}`),
        }
      );
      if (!wantsJson()) process.stdout.write('\n');

      const moved = items.length - failures.length;
      if (wantsJson()) {
        emitJson({ executed: true, moved, failed: failures.length });
      } else {
        console.log(chalk.green(`✅ Moved ${moved}/${items.length} under ${options.to}.`));
        if (failures.length) {
          console.log(chalk.red(`${failures.length} failed:`));
          reportFailures(failures);
        }
      }
      analytics.track('bulk_move', failures.length === 0);
      if (failures.length) process.exitCode = 1;
    }, { writable: true }));

  // ---- bulk delete -----------------------------------------------------------
  bulk
    .command('delete')
    .description('Delete many pages/folders (to trash) — dry-run by default')
    .option('--ids <list>', 'Comma/space/newline separated ids or URLs')
    .option('--ids-file <file>', 'File containing ids/URLs (one per line)')
    .option('--from-search <cql>', 'Select items to delete by a CQL query')
    .option('--subtree <idOrUrl>', 'Delete a page/folder AND all of its descendants')
    .option('-c, --concurrency <n>', 'Number of parallel deletes', '4')
    .option('--execute', 'Actually delete (default is a dry-run preview)')
    .option('-y, --yes', 'Skip the confirmation prompt (required with --execute in --json mode)')
    .addHelpText('after', `
Examples:
  # Preview deleting a whole subtree (no changes made):
  $ confluence bulk delete --subtree 123456

  # Apply it, without the interactive prompt:
  $ confluence bulk delete --subtree 123456 --execute --yes

Deletion goes to trash (recoverable). Sources are mutually exclusive.`)
    .action(withClient('bulk_delete', async ({ client, analytics, wantsJson, emitJson }, options) => {
      const jsonMode = wantsJson();

      // --subtree deletes a whole tree. Deleting a container does NOT cascade to
      // child folders (they get re-parented), so we enumerate every descendant
      // (folders included) and delete them explicitly, DEEPEST-FIRST, so a child
      // is always gone before its parent. --ids/--ids-file/--from-search delete
      // each supplied item individually (as given).
      const subtreeMode = Boolean(options.subtree);
      let items;
      let root = null;
      if (subtreeMode) {
        root = await client.getPageInfo(options.subtree);
        const descendants = await client.getDescendants(root.id);
        const deepestFirst = [...descendants].sort((a, b) => (b.depth || 0) - (a.depth || 0));
        items = [
          ...deepestFirst.map((d) => ({ id: d.id, title: d.title, type: d.type })),
          { id: root.id, title: root.title, type: root.type || 'page', depth: 0 },
        ];
      } else {
        items = await resolveTargets(client, options);
      }

      const entries = items.map((i) => ({ action: 'delete', target: `"${i.title}" (${i.id})` }));

      if (!options.execute) {
        if (jsonMode) {
          emitJson({ dryRun: true, subtree: subtreeMode, count: items.length, items });
        } else {
          console.log(renderPlan(entries, { header: 'Delete plan' }));
          console.log(chalk.yellow(`\n⚠ Dry run — re-run with --execute to delete ${items.length} item(s) to trash.`));
        }
        analytics.track('bulk_delete_dry_run', true);
        return;
      }

      if (!options.yes) {
        if (jsonMode) {
          throw new Error('Refusing to delete without confirmation in --json mode. Pass --yes to proceed.');
        }
        console.log(renderPlan(entries, { header: 'Delete plan' }));
        const { confirmed } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirmed',
          default: false,
          message: chalk.red(`Delete ${items.length} item(s) to trash? This cannot be undone with Ctrl-Z.`),
        }]);
        if (!confirmed) {
          console.log(chalk.yellow('Cancelled.'));
          analytics.track('bulk_delete_cancel', true);
          return;
        }
      }

      // Subtree deletion must be sequential + deepest-first; parallelism could
      // delete a parent before its child. Individual sources can run in parallel.
      const concurrency = subtreeMode ? 1 : parseConcurrency(options.concurrency);
      const { failures } = await runWithConcurrency(
        items,
        (i) => client.deletePage(i.id),
        {
          concurrency,
          onProgress: jsonMode ? null : ({ completed, total }) =>
            process.stdout.write(`\r  deleted ${completed}/${total}`),
        }
      );
      if (!jsonMode) process.stdout.write('\n');

      const deleted = items.length - failures.length;

      if (jsonMode) {
        emitJson({ executed: true, subtree: subtreeMode, deleted, failed: failures.length });
      } else {
        console.log(chalk.green(`✅ Deleted ${deleted}/${items.length} to trash.`));
        if (failures.length) {
          console.log(chalk.red(`${failures.length} failed:`));
          reportFailures(failures);
        }
      }
      analytics.track('bulk_delete', failures.length === 0);
      if (failures.length) process.exitCode = 1;
    }, { writable: true }));
}

module.exports = registerBulkCommands;

'use strict';

// A plan entry describes one intended operation in human terms.
// { action: 'move'|'create'|'update'|'delete'|'skip', target: string, detail?: string }

/** Count entries by action, preserving first-seen order. */
function summarize(entries) {
  const counts = {};
  for (const e of entries) {
    const action = (e.action || 'unknown').toLowerCase();
    counts[action] = (counts[action] || 0) + 1;
  }
  return counts;
}

/**
 * Render a terraform-style, deterministic (no color) preview of a plan. This is
 * what `--dry-run` prints and what an agent reads before approving `--execute`.
 * @param {{action:string,target:string,detail?:string}[]} entries
 * @param {{ header?: string }} [opts]
 * @returns {string}
 */
function renderPlan(entries, opts = {}) {
  const header = opts.header || 'Plan';
  if (!entries.length) {
    return `${header}: no operations — nothing to do.`;
  }

  const lines = [`${header}: ${entries.length} operation${entries.length === 1 ? '' : 's'}`];
  for (const e of entries) {
    const action = String(e.action || '?').toUpperCase().padEnd(7);
    const detail = e.detail ? `  ${e.detail}` : '';
    lines.push(`  ${action} ${e.target}${detail}`);
  }

  const counts = summarize(entries);
  const summary = Object.entries(counts)
    .map(([action, n]) => `${n} ${action}`)
    .join(', ');
  lines.push('', `Summary: ${summary}`);
  return lines.join('\n');
}

module.exports = { renderPlan, summarize };

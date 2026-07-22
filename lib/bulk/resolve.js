'use strict';

const fs = require('fs');

/** Split a comma/whitespace/newline separated list of ids (or URLs). */
function parseIdList(raw) {
  return String(raw || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve the set of target items a bulk command should act on, from exactly one
 * source. Returns `[{ id, title, type }]`.
 *
 * @param {object} client
 * @param {{ ids?: string, idsFile?: string, fromSearch?: string }} sources
 */
async function resolveTargets(client, sources) {
  const { ids, idsFile, fromSearch } = sources;
  const chosen = [
    ['--ids', ids],
    ['--ids-file', idsFile],
    ['--from-search', fromSearch],
  ].filter(([, v]) => v);

  if (chosen.length === 0) {
    throw new Error('No source given. Use exactly one of --ids, --ids-file, or --from-search.');
  }
  if (chosen.length > 1) {
    throw new Error(
      `Provide only one source, not ${chosen.map(([f]) => f).join(' + ')}.`
    );
  }

  if (fromSearch) {
    const results = await client.search(fromSearch, 1000, true);
    return results.map((r) => ({ id: String(r.id), title: r.title, type: r.type || 'page' }));
  }

  const idList = ids ? parseIdList(ids) : parseIdList(fs.readFileSync(idsFile, 'utf8'));
  if (idList.length === 0) {
    throw new Error('No ids found in the given source.');
  }

  const items = [];
  for (const idOrUrl of idList) {
    const info = await client.getPageInfo(idOrUrl);
    items.push({ id: info.id, title: info.title, type: info.type || 'page' });
  }
  return items;
}

module.exports = { resolveTargets, parseIdList };

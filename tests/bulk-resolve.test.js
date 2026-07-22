const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveTargets, parseIdList } = require('../lib/bulk/resolve');

describe('parseIdList', () => {
  test('splits on commas, whitespace and newlines', () => {
    expect(parseIdList('1, 2\n3\t4  5')).toEqual(['1', '2', '3', '4', '5']);
  });
  test('drops blanks', () => {
    expect(parseIdList(' , ,\n')).toEqual([]);
  });
});

describe('resolveTargets', () => {
  const client = {
    getPageInfo: jest.fn(),
    search: jest.fn(),
  };

  beforeEach(() => {
    client.getPageInfo.mockReset();
    client.search.mockReset();
  });

  test('rejects when no source is given', async () => {
    await expect(resolveTargets(client, {})).rejects.toThrow(/exactly one of/);
  });

  test('rejects when more than one source is given', async () => {
    await expect(resolveTargets(client, { ids: '1', fromSearch: 'x' }))
      .rejects.toThrow(/only one source/);
  });

  test('resolves --ids via getPageInfo, preserving order', async () => {
    client.getPageInfo.mockImplementation(async (id) => ({ id, title: `T${id}`, type: 'page' }));
    const out = await resolveTargets(client, { ids: '10, 20' });
    expect(out).toEqual([
      { id: '10', title: 'T10', type: 'page' },
      { id: '20', title: 'T20', type: 'page' },
    ]);
  });

  test('resolves --from-search via client.search (raw CQL)', async () => {
    client.search.mockResolvedValue([
      { id: '1', title: 'A', type: 'folder' },
      { id: '2', title: 'B' },
    ]);
    const out = await resolveTargets(client, { fromSearch: 'space = AT' });
    expect(client.search).toHaveBeenCalledWith('space = AT', 1000, true);
    expect(out).toEqual([
      { id: '1', title: 'A', type: 'folder' },
      { id: '2', title: 'B', type: 'page' },
    ]);
  });

  test('resolves --ids-file from disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-ids-'));
    const file = path.join(dir, 'ids.txt');
    fs.writeFileSync(file, '100\n200\n');
    client.getPageInfo.mockImplementation(async (id) => ({ id, title: `T${id}`, type: 'page' }));

    const out = await resolveTargets(client, { idsFile: file });
    expect(out.map((x) => x.id)).toEqual(['100', '200']);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('rejects an empty id source', async () => {
    await expect(resolveTargets(client, { ids: '  ' })).rejects.toThrow(/No source given|No ids found/);
  });
});

const ConfluenceClient = require('../lib/confluence-client');

describe('getDescendants (folder-aware, via CQL ancestor)', () => {
  test('queries CQL "ancestor = <id>" and normalizes results', async () => {
    const client = new ConfluenceClient({ domain: 'test.atlassian.net', token: 't' });
    jest.spyOn(client, 'search').mockResolvedValue([
      { id: '2', title: 'A folder', type: 'folder' },
      { id: '3', title: 'A page' }, // type defaults to 'page'
    ]);

    const out = await client.getDescendants('1');

    expect(client.search).toHaveBeenCalledWith('ancestor = 1', 1000, true);
    expect(out).toEqual([
      { id: '2', title: 'A folder', type: 'folder' },
      { id: '3', title: 'A page', type: 'page' },
    ]);
  });
});

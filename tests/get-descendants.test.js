const ConfluenceClient = require('../lib/confluence-client');
const MockAdapter = require('axios-mock-adapter');

const newClient = () => new ConfluenceClient({ domain: 'test.atlassian.net', token: 't' });

describe('getChildrenAllTypes (immediately consistent, folders + pages)', () => {
  test('merges folder and page children from the child endpoint', async () => {
    const client = newClient();
    const mock = new MockAdapter(client.client);
    mock.onGet('/content/1/child').reply(200, {
      folder: { results: [{ id: '2', title: 'F', type: 'folder' }] },
      page: { results: [{ id: '3', title: 'P', type: 'page' }] },
    });

    const out = await client.getChildrenAllTypes('1');
    expect(out).toEqual([
      { id: '2', title: 'F', type: 'folder' },
      { id: '3', title: 'P', type: 'page' },
    ]);
    mock.restore();
  });
});

describe('getDescendants (recursive walk, depth-tagged)', () => {
  test('collects all descendants with depth, folders before pages', async () => {
    const client = newClient();
    const mock = new MockAdapter(client.client);
    // 1 → folder 2 → page 4 ; 1 → page 3
    mock.onGet('/content/1/child').reply(200, {
      folder: { results: [{ id: '2', title: 'F', type: 'folder' }] },
      page: { results: [{ id: '3', title: 'P', type: 'page' }] },
    });
    mock.onGet('/content/2/child').reply(200, {
      folder: { results: [] },
      page: { results: [{ id: '4', title: 'Nested', type: 'page' }] },
    });
    mock.onGet('/content/3/child').reply(200, { folder: { results: [] }, page: { results: [] } });
    mock.onGet('/content/4/child').reply(200, { folder: { results: [] }, page: { results: [] } });

    const out = await client.getDescendants('1');
    expect(out).toEqual([
      { id: '2', title: 'F', type: 'folder', depth: 1 },
      { id: '4', title: 'Nested', type: 'page', depth: 2 },
      { id: '3', title: 'P', type: 'page', depth: 1 },
    ]);
    mock.restore();
  });
});

describe('findChildByTitle (via child endpoint)', () => {
  test('returns the matching child or null', async () => {
    const client = newClient();
    const mock = new MockAdapter(client.client);
    mock.onGet('/content/1/child').reply(200, {
      folder: { results: [{ id: '2', title: 'guide', type: 'folder' }] },
      page: { results: [] },
    });

    expect(await client.findChildByTitle('1', 'guide')).toEqual({ id: '2', title: 'guide', type: 'folder' });
    expect(await client.findChildByTitle('1', 'missing')).toBeNull();
    mock.restore();
  });
});

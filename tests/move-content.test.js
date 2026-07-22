const ConfluenceClient = require('../lib/confluence-client');
const MockAdapter = require('axios-mock-adapter');

// moveContent() uses the dedicated Confluence "move" endpoint
// (PUT /content/{id}/move/{position}/{targetParentId}). Unlike the legacy
// updatePage-based movePage(), it works for folders and across spaces and never
// re-writes the content body.
describe('moveContent (clean move endpoint)', () => {
  let client;

  beforeEach(() => {
    client = new ConfluenceClient({ domain: 'test.atlassian.net', token: 'test-token' });
  });

  test('moves by id via PUT /content/{id}/move/append/{parent}', async () => {
    const mock = new MockAdapter(client.client);
    let calledUrl = null;
    mock.onPut('/content/123/move/append/456').reply((config) => {
      calledUrl = config.url;
      return [200, { pageId: '123' }];
    });

    const result = await client.moveContent('123', '456');

    expect(calledUrl).toBe('/content/123/move/append/456');
    expect(result).toEqual({
      id: '123',
      targetParentId: '456',
      position: 'append',
      data: { pageId: '123' },
    });
    mock.restore();
  });

  test('supports before and after positions', async () => {
    const mock = new MockAdapter(client.client);
    mock.onPut('/content/1/move/before/2').reply(200, { pageId: '1' });
    mock.onPut('/content/1/move/after/2').reply(200, { pageId: '1' });

    expect((await client.moveContent('1', '2', 'before')).position).toBe('before');
    expect((await client.moveContent('1', '2', 'after')).position).toBe('after');
    mock.restore();
  });

  test('rejects an invalid position without making any HTTP request', async () => {
    const mock = new MockAdapter(client.client);
    mock.onAny().reply(() => { throw new Error('no HTTP request should be made'); });

    await expect(client.moveContent('1', '2', 'sideways')).rejects.toThrow(/Invalid move position/i);
    expect(mock.history.put).toHaveLength(0);
    mock.restore();
  });

  test('resolves page URLs for both id and parent (folder/cross-space safe: no GET of body)', async () => {
    const mock = new MockAdapter(client.client);
    const pageUrl = 'https://test.atlassian.net/wiki/viewpage.action?pageId=777';
    const parentUrl = 'https://test.atlassian.net/wiki/viewpage.action?pageId=888';
    mock.onPut('/content/777/move/append/888').reply(200, { pageId: '777' });

    const result = await client.moveContent(pageUrl, parentUrl);

    expect(result.id).toBe('777');
    expect(result.targetParentId).toBe('888');
    // The body of the moved content is never fetched — that is what makes this
    // safe for folders (which have no body) and macro-heavy pages.
    expect(mock.history.get || []).toHaveLength(0);
    mock.restore();
  });
});

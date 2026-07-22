const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanLocalTree, mirrorNodes, titleFromName } = require('../lib/bulk/mirror');

function makeTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-mirror-'));
  fs.writeFileSync(path.join(dir, 'index.md'), '# Home');
  fs.mkdirSync(path.join(dir, 'getting-started'));
  fs.writeFileSync(path.join(dir, 'getting-started', 'install.md'), '# Install');
  fs.writeFileSync(path.join(dir, '.hidden'), 'ignore me');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not markdown');
  return dir;
}

describe('titleFromName', () => {
  test('drops .md and tidies separators', () => {
    expect(titleFromName('getting-started.md')).toBe('getting started');
    expect(titleFromName('API_Reference')).toBe('API Reference');
  });
});

describe('scanLocalTree', () => {
  test('folders → folder nodes, .md → page nodes; ignores dotfiles + non-md', () => {
    const dir = makeTree();
    try {
      const tree = scanLocalTree(dir);
      const kinds = tree.map((n) => `${n.kind}:${n.title}`);
      expect(kinds).toContain('page:index');
      expect(kinds).toContain('folder:getting started');
      expect(kinds.find((k) => k.includes('hidden'))).toBeUndefined();
      expect(kinds.find((k) => k.includes('notes'))).toBeUndefined();

      const folder = tree.find((n) => n.kind === 'folder');
      expect(folder.children.map((c) => c.title)).toEqual(['install']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('mirrorNodes', () => {
  const makeClient = () => ({
    findContentByTitleInSpace: jest.fn().mockResolvedValue(null),
    findChildByTitle: jest.fn().mockResolvedValue(null),
    createPage: jest.fn().mockResolvedValue({ id: 'F1' }),
    createChildPage: jest.fn().mockResolvedValue({ id: 'P1' }),
    updatePage: jest.fn().mockResolvedValue({}),
  });

  const tree = [
    { kind: 'folder', title: 'guide', path: '/x/guide', children: [
      { kind: 'page', title: 'install', path: '/x/guide/install.md' },
    ] },
    { kind: 'page', title: 'home', path: '/x/home.md' },
  ];

  test('dry-run makes no write calls and plans creates', async () => {
    const client = makeClient();
    const ops = [];
    await mirrorNodes(client, tree, {
      spaceKey: 'DOCS', parentId: null, execute: false, ops, readFile: () => '# body',
    });

    expect(client.createPage).not.toHaveBeenCalled();
    expect(client.createChildPage).not.toHaveBeenCalled();
    expect(ops).toEqual([
      { action: 'create', target: 'folder "guide"' },
      { action: 'create', target: '"install"' },
      { action: 'create', target: '"home"' },
    ]);
  });

  test('execute creates folder then child page under it, and a top-level page', async () => {
    const client = makeClient();
    const ops = [];
    await mirrorNodes(client, tree, {
      spaceKey: 'DOCS', parentId: null, execute: true, ops, readFile: () => '# body',
    });

    // folder created at top level (no parent)
    expect(client.createPage).toHaveBeenCalledWith('guide', 'DOCS', '', 'storage', 'folder');
    // page created under the new folder id F1
    expect(client.createChildPage).toHaveBeenCalledWith('install', 'DOCS', 'F1', '# body', 'markdown', 'page');
    // top-level page created directly in the space
    expect(client.createPage).toHaveBeenCalledWith('home', 'DOCS', '# body', 'markdown', 'page');
  });

  test('idempotent: existing items are updated/skipped, not recreated', async () => {
    const client = makeClient();
    client.findContentByTitleInSpace.mockImplementation(async (space, title) => {
      if (title === 'guide') return { id: 'EXIST-F', title, type: 'folder' };
      if (title === 'home') return { id: 'EXIST-P', title, type: 'page' };
      return null;
    });
    client.findChildByTitle.mockResolvedValue(null); // install not present under guide
    const ops = [];
    await mirrorNodes(client, tree, {
      spaceKey: 'DOCS', parentId: null, execute: true, ops, readFile: () => '# body',
    });

    expect(client.createPage).not.toHaveBeenCalledWith('guide', 'DOCS', '', 'storage', 'folder');
    expect(client.updatePage).toHaveBeenCalledWith('EXIST-P', 'home', '# body', 'markdown');
    // install created under the existing folder EXIST-F
    expect(client.createChildPage).toHaveBeenCalledWith('install', 'DOCS', 'EXIST-F', '# body', 'markdown', 'page');
    expect(ops).toContainEqual({ action: 'skip', target: 'folder "guide"', detail: 'exists' });
    expect(ops).toContainEqual({ action: 'update', target: '"home"' });
  });
});

// Live end-to-end smoke test against a REAL Confluence instance.
//
// Skipped by default. To run it:
//   1. Configure the CLI (confluence init) or set CONFLUENCE_* env vars.
//   2. export CONFLUENCE_TEST_SPACE=<spaceKey you can write to>
//   3. export CONFLUENCE_TEST_PARENT=<id of a page/folder to nest the sandbox under>
//   4. npx jest live-smoke
//
// It creates a throwaway sandbox folder, mirrors a tiny tree into it, moves a
// page, then deletes the whole sandbox — asserting each step. Everything it
// creates is cleaned up in afterAll.

const os = require('os');
const fs = require('fs');
const path = require('path');
const ConfluenceClient = require('../lib/confluence-client');
const { getConfig } = require('../lib/config');
const { scanLocalTree, mirrorNodes } = require('../lib/bulk/mirror');

const PARENT = process.env.CONFLUENCE_TEST_PARENT;
const SPACE = process.env.CONFLUENCE_TEST_SPACE;
const enabled = Boolean(PARENT && SPACE);
const suite = enabled ? describe : describe.skip;

suite('live smoke (mirror → move → delete)', () => {
  jest.setTimeout(120000);

  let client;
  let sandboxId;
  let localDir;
  const tag = `smoke-${Date.now()}`;

  beforeAll(() => {
    client = new ConfluenceClient(getConfig());
    localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-smoke-'));
    fs.mkdirSync(path.join(localDir, `folder-a-${tag}`));
    fs.writeFileSync(path.join(localDir, `home-${tag}.md`), `# Home ${tag}\n`);
    fs.writeFileSync(path.join(localDir, `folder-a-${tag}`, `child-${tag}.md`), `# Child ${tag}\n`);
  });

  afterAll(async () => {
    if (sandboxId) {
      try { await client.deletePage(sandboxId); } catch { /* best effort */ }
    }
    if (localDir) fs.rmSync(localDir, { recursive: true, force: true });
  });

  test('creates a sandbox, mirrors into it, moves a page, then deletes it', async () => {
    // 1. sandbox folder
    const sandbox = await client.createChildPage(`cc-sandbox-${tag}`, SPACE, PARENT, '', 'storage', 'folder');
    sandboxId = String(sandbox.id);
    expect(sandboxId).toMatch(/^\d+$/);

    // 2. mirror (execute)
    const ops = [];
    const failures = [];
    const tree = scanLocalTree(localDir);
    await mirrorNodes(client, tree, { spaceKey: SPACE, parentId: sandboxId, execute: true, ops, failures });
    expect(failures).toHaveLength(0);
    expect(ops.filter((o) => o.action === 'create').length).toBeGreaterThanOrEqual(3);

    // 3. locate the created folder + its child, then move the child to the sandbox root
    const folder = await client.findChildByTitle(sandboxId, `folder a ${tag}`);
    expect(folder).toBeTruthy();
    const child = await client.findChildByTitle(folder.id, `child ${tag}`);
    expect(child).toBeTruthy();

    const moved = await client.moveContent(child.id, sandboxId, 'append');
    expect(moved.id).toBe(String(child.id));

    // ancestors are immediately consistent (unlike CQL): confirm the reparent
    const info = await client.getPageInfo(child.id);
    expect(info.parentId).toBe(sandboxId);

    // 4. delete the sandbox (cascades) and confirm it is gone
    await client.deletePage(sandboxId);
    await expect(client.getPageInfo(sandboxId)).rejects.toBeDefined();
    sandboxId = null; // already cleaned
  });
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const { mirrorAction } = require('../bin/commands/mirror');

const makeCtx = (client, json = false) => ({
  client,
  analytics: { track: jest.fn() },
  wantsJson: () => json,
  emitJson: jest.fn(),
});

const makeLocalTree = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-mirroraction-'));
  fs.writeFileSync(path.join(dir, 'home.md'), '# Home');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'child.md'), '# Child');
  return dir;
};

const makeClient = () => ({
  findContentByTitleInSpace: jest.fn().mockResolvedValue(null),
  findChildByTitle: jest.fn().mockResolvedValue(null),
  createPage: jest.fn().mockResolvedValue({ id: 'F1' }),
  createChildPage: jest.fn().mockResolvedValue({ id: 'P1' }),
  updatePage: jest.fn().mockResolvedValue({}),
});

describe('mirrorAction', () => {
  let dir; let prevExit;
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    dir = makeLocalTree();
    prevExit = process.exitCode;
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
    process.exitCode = prevExit;
  });

  test('rejects a missing directory', async () => {
    await expect(mirrorAction(makeCtx(makeClient()), '/no/such/dir', 'DOCS', {}))
      .rejects.toThrow(/not found or not a directory/);
  });

  test('rejects a path that is a file, not a directory', async () => {
    const file = path.join(dir, 'home.md');
    await expect(mirrorAction(makeCtx(makeClient()), file, 'DOCS', {}))
      .rejects.toThrow(/not found or not a directory/);
  });

  test('dry-run makes no writes and reports a plan', async () => {
    const c = makeClient();
    const ctx = makeCtx(c);
    await mirrorAction(ctx, dir, 'DOCS', {});
    expect(c.createPage).not.toHaveBeenCalled();
    expect(ctx.analytics.track).toHaveBeenCalledWith('mirror_dry_run', true);
  });

  test('execute creates the tree', async () => {
    const c = makeClient();
    const ctx = makeCtx(c);
    await mirrorAction(ctx, dir, 'DOCS', { execute: true });
    expect(c.createPage).toHaveBeenCalledWith('sub', 'DOCS', '', 'storage', 'folder');
    expect(c.createChildPage).toHaveBeenCalledWith('child', 'DOCS', 'F1', '# Child', 'markdown', 'page');
    expect(ctx.analytics.track).toHaveBeenCalledWith('mirror', true);
  });

  test('a failure sets exit code 1 and is reported', async () => {
    const c = makeClient();
    c.createPage.mockRejectedValue(new Error('A folder exists with the same title in this space'));
    const ctx = makeCtx(c);
    await mirrorAction(ctx, dir, 'DOCS', { execute: true });
    expect(process.exitCode).toBe(1);
    expect(ctx.analytics.track).toHaveBeenCalledWith('mirror', false);
  });

  test('json mode emits counts, operations and failures', async () => {
    const c = makeClient();
    const ctx = makeCtx(c, true);
    await mirrorAction(ctx, dir, 'DOCS', { execute: true });
    expect(ctx.emitJson).toHaveBeenCalledWith(expect.objectContaining({
      executed: true,
      spaceKey: 'DOCS',
      counts: expect.any(Object),
      operations: expect.any(Array),
    }));
  });

  test('json mode maps a failure into a structured entry and exits 1', async () => {
    const c = makeClient();
    c.createPage.mockRejectedValue(new Error('A folder exists with the same title in this space'));
    const ctx = makeCtx(c, true);
    await mirrorAction(ctx, dir, 'DOCS', { execute: true });
    const payload = ctx.emitJson.mock.calls[0][0];
    expect(payload.failed).toBeGreaterThanOrEqual(1);
    expect(payload.failures[0]).toEqual(expect.objectContaining({
      title: expect.any(String),
      message: expect.any(String),
      hint: expect.any(String),
      exitCode: expect.any(Number),
    }));
    expect(process.exitCode).toBe(1);
  });
});

jest.mock('inquirer');
const inquirer = require('inquirer');
const { bulkMoveAction, bulkDeleteAction, parseConcurrency } = require('../bin/commands/bulk');

const makeCtx = (client, json = false) => ({
  client,
  analytics: { track: jest.fn() },
  wantsJson: () => json,
  emitJson: jest.fn(),
});

describe('parseConcurrency', () => {
  test('defaults to 4 for bad values, keeps valid ones', () => {
    expect(parseConcurrency('8')).toBe(8);
    expect(parseConcurrency('nope')).toBe(4);
    expect(parseConcurrency('0')).toBe(4);
    expect(parseConcurrency(undefined)).toBe(4);
  });
});

describe('bulkMoveAction', () => {
  let logSpy; let prevExit;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    prevExit = process.exitCode;
  });
  afterEach(() => { jest.restoreAllMocks(); process.exitCode = prevExit; });

  const client = () => ({
    getPageInfo: jest.fn(async (id) => ({ id, title: `T${id}`, type: 'page' })),
    moveContent: jest.fn(async (id) => ({ id })),
  });

  test('dry-run prints a plan and performs no moves', async () => {
    const c = client();
    const ctx = makeCtx(c);
    await bulkMoveAction(ctx, { ids: '1,2', to: '9', position: 'append' });
    expect(c.moveContent).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.flat().join('\n')).toMatch(/Move plan: 2 operations/);
    expect(ctx.analytics.track).toHaveBeenCalledWith('bulk_move_dry_run', true);
  });

  test('execute moves each item and reports success', async () => {
    const c = client();
    const ctx = makeCtx(c);
    await bulkMoveAction(ctx, { ids: '1,2', to: '9', position: 'append', execute: true });
    expect(c.moveContent).toHaveBeenCalledTimes(2);
    expect(c.moveContent).toHaveBeenCalledWith('1', '9', 'append');
    expect(logSpy.mock.calls.flat().join('\n')).toMatch(/Moved 2\/2 under 9/);
    expect(ctx.analytics.track).toHaveBeenCalledWith('bulk_move', true);
  });

  test('execute with a failure reports it and sets exit code 1', async () => {
    const c = client();
    c.moveContent.mockImplementation(async (id) => {
      if (id === '2') throw new Error('boom');
      return { id };
    });
    const ctx = makeCtx(c);
    await bulkMoveAction(ctx, { ids: '1,2', to: '9', position: 'append', execute: true });
    expect(process.exitCode).toBe(1);
    expect(ctx.analytics.track).toHaveBeenCalledWith('bulk_move', false);
  });

  test('json dry-run emits structured data', async () => {
    const c = client();
    const ctx = makeCtx(c, true);
    await bulkMoveAction(ctx, { ids: '1', to: '9', position: 'append' });
    expect(ctx.emitJson).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, count: 1, to: '9' }));
  });

  test('json execute emits moved/failed counts', async () => {
    const c = client();
    c.moveContent.mockImplementation(async (id) => {
      if (id === '2') throw new Error('boom');
      return { id };
    });
    const ctx = makeCtx(c, true);
    await bulkMoveAction(ctx, { ids: '1,2', to: '9', position: 'append', execute: true });
    expect(ctx.emitJson).toHaveBeenCalledWith({ executed: true, moved: 1, failed: 1 });
    expect(process.exitCode).toBe(1);
  });
});

describe('bulkDeleteAction', () => {
  let logSpy; let prevExit;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    inquirer.prompt.mockReset();
    prevExit = process.exitCode;
  });
  afterEach(() => { jest.restoreAllMocks(); process.exitCode = prevExit; });

  const client = () => ({
    getPageInfo: jest.fn(async (id) => ({ id, title: `root${id}`, type: 'folder' })),
    getDescendants: jest.fn(async () => [
      { id: 'c1', title: 'leaf', type: 'page', depth: 2 },
      { id: 'f1', title: 'folder', type: 'folder', depth: 1 },
    ]),
    deletePage: jest.fn(async (id) => ({ id })),
  });

  test('subtree dry-run lists all descendants + root, deletes nothing', async () => {
    const c = client();
    const ctx = makeCtx(c);
    await bulkDeleteAction(ctx, { subtree: '100' });
    expect(c.deletePage).not.toHaveBeenCalled();
    const out = logSpy.mock.calls.flat().join('\n');
    expect(out).toMatch(/Delete plan: 3 operations/);
    expect(ctx.analytics.track).toHaveBeenCalledWith('bulk_delete_dry_run', true);
  });

  test('subtree execute deletes deepest-first then root', async () => {
    const c = client();
    const ctx = makeCtx(c);
    await bulkDeleteAction(ctx, { subtree: '100', execute: true, yes: true });
    const order = c.deletePage.mock.calls.map((call) => call[0]);
    expect(order).toEqual(['c1', 'f1', '100']); // depth 2, then 1, then root
    expect(ctx.analytics.track).toHaveBeenCalledWith('bulk_delete', true);
  });

  test('json execute without --yes refuses', async () => {
    const ctx = makeCtx(client(), true);
    await expect(bulkDeleteAction(ctx, { subtree: '100', execute: true }))
      .rejects.toThrow(/Refusing to delete without confirmation/);
  });

  test('interactive decline cancels', async () => {
    inquirer.prompt.mockResolvedValue({ confirmed: false });
    const c = client();
    const ctx = makeCtx(c);
    await bulkDeleteAction(ctx, { subtree: '100', execute: true });
    expect(c.deletePage).not.toHaveBeenCalled();
    expect(ctx.analytics.track).toHaveBeenCalledWith('bulk_delete_cancel', true);
  });

  test('id source deletes each supplied id', async () => {
    const c = client();
    c.getPageInfo = jest.fn(async (id) => ({ id, title: `T${id}`, type: 'page' }));
    const ctx = makeCtx(c);
    await bulkDeleteAction(ctx, { ids: 'a,b', execute: true, yes: true });
    const order = c.deletePage.mock.calls.map((call) => call[0]).sort();
    expect(order).toEqual(['a', 'b']);
  });

  test('json execute emits deleted/failed and reports a failure', async () => {
    const c = client();
    c.deletePage.mockImplementation(async (id) => {
      if (id === 'f1') throw new Error('nope');
      return { id };
    });
    const ctx = makeCtx(c, true);
    await bulkDeleteAction(ctx, { subtree: '100', execute: true, yes: true });
    expect(ctx.emitJson).toHaveBeenCalledWith(expect.objectContaining({ executed: true, subtree: true, failed: 1 }));
    expect(process.exitCode).toBe(1);
  });

  test('json dry-run emits the item list', async () => {
    const ctx = makeCtx(client(), true);
    await bulkDeleteAction(ctx, { subtree: '100' });
    expect(ctx.emitJson).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, subtree: true, count: 3 }));
  });
});

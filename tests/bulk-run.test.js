const { runWithConcurrency } = require('../lib/bulk/run');

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('runWithConcurrency', () => {
  test('returns results in input order', async () => {
    const { results, failures } = await runWithConcurrency([1, 2, 3], async (n) => n * 10);
    expect(results).toEqual([10, 20, 30]);
    expect(failures).toEqual([]);
  });

  test('never exceeds the concurrency limit of in-flight workers', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await runWithConcurrency(items, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await tick(5);
      inFlight--;
    }, { concurrency: 3 });

    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  test('collects failures without aborting the rest of the batch', async () => {
    const items = [1, 2, 3, 4];
    const { results, failures } = await runWithConcurrency(items, async (n) => {
      if (n % 2 === 0) throw new Error(`boom ${n}`);
      return n;
    }, { concurrency: 2 });

    expect(results[0]).toBe(1);
    expect(results[2]).toBe(3);
    expect(results[1]).toBeUndefined();
    expect(failures.map((f) => f.item).sort()).toEqual([2, 4]);
    expect(failures[0].error).toBeInstanceOf(Error);
  });

  test('reports progress for every item', async () => {
    const seen = [];
    await runWithConcurrency([1, 2, 3], async (n) => n, {
      onProgress: (p) => seen.push(p.completed),
    });
    expect(seen.sort()).toEqual([1, 2, 3]);
  });

  test('handles an empty item list', async () => {
    const { results, failures } = await runWithConcurrency([], async (n) => n);
    expect(results).toEqual([]);
    expect(failures).toEqual([]);
  });
});

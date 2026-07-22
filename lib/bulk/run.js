'use strict';

/**
 * Run an async `worker` over `items` with a bounded number of concurrent
 * in-flight calls. A worker that throws does NOT abort the batch: its failure
 * is collected and the remaining items still run. Results keep input order.
 *
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} worker
 * @param {{ concurrency?: number, onProgress?: (p:{completed:number,total:number,item:T}) => void }} [opts]
 * @returns {Promise<{ results: (R|undefined)[], failures: {item:T,index:number,error:Error}[] }>}
 */
async function runWithConcurrency(items, worker, opts = {}) {
  const concurrency = Math.max(1, opts.concurrency || 4);
  const onProgress = opts.onProgress;
  const total = items.length;
  const results = new Array(total);
  const failures = [];
  let cursor = 0;
  let completed = 0;

  const lanes = Array.from({ length: Math.min(concurrency, total || 1) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= total) return;
      const item = items[index];
      try {
        results[index] = await worker(item, index);
      } catch (error) {
        failures.push({ item, index, error });
        results[index] = undefined;
      } finally {
        completed++;
        if (onProgress) onProgress({ completed, total, item });
      }
    }
  });

  await Promise.all(lanes);
  return { results, failures };
}

module.exports = { runWithConcurrency };

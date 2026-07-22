const { renderPlan, summarize } = require('../lib/bulk/plan');

describe('renderPlan', () => {
  test('renders a clear message when there is nothing to do', () => {
    expect(renderPlan([])).toBe('Plan: no operations — nothing to do.');
    expect(renderPlan([], { header: 'Move plan' }))
      .toBe('Move plan: no operations — nothing to do.');
  });

  test('lists each operation and a per-action summary', () => {
    const out = renderPlan([
      { action: 'move', target: '"Getting Started" (123)', detail: '→ under 456' },
      { action: 'create', target: 'folder "Telecom"', detail: 'under 789' },
      { action: 'delete', target: '"Old" (999)' },
    ]);

    expect(out).toContain('Plan: 3 operations');
    expect(out).toContain('MOVE    "Getting Started" (123)  → under 456');
    expect(out).toContain('CREATE  folder "Telecom"  under 789');
    expect(out).toContain('DELETE  "Old" (999)');
    expect(out).toContain('Summary: 1 move, 1 create, 1 delete');
  });

  test('uses singular wording for a single operation', () => {
    expect(renderPlan([{ action: 'delete', target: 'x' }])).toContain('Plan: 1 operation');
  });
});

describe('summarize', () => {
  test('counts by action', () => {
    expect(summarize([
      { action: 'move' }, { action: 'move' }, { action: 'skip' },
    ])).toEqual({ move: 2, skip: 1 });
  });
});

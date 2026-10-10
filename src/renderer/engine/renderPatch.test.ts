import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// Deep import past the package's exports map: this is the file the Chalkline patch edits.
import { routeScene } from '../../../node_modules/@eraserlabs/render/dist/browser/route.js';

const dist = 'node_modules/@eraserlabs/render/dist/browser';

describe('@eraserlabs/render patch (patches/@eraserlabs__render@0.2.0.patch)', () => {
  it('bounds the router repair by default and lets run() pass a budget to every routing pass', () => {
    const route = readFileSync(`${dist}/route.js`, 'utf8');
    const index = readFileSync(`${dist}/index.js`, 'utf8');
    expect(route).toContain('const REPAIR_TIME_BUDGET_MS = 100;');
    expect(route).not.toContain('Number.POSITIVE_INFINITY');
    expect(index).toContain('const { entities, connections, repairTimeBudgetMs } = request;');
    expect(index.match(/xternalText, repairTimeBudgetMs\)/g)).toHaveLength(3);
  });

  it('routes with an explicit budget', () => {
    const box = (id: string, x: number) => ({ id, tag: 'Shape', x, y: 0, width: 80, height: 40, props: {} });
    const layout = routeScene(
      [box('a', 0), box('b', 300)] as never,
      [{ id: 'c', tag: 'Relationship', props: { from: 'a', to: 'b' } }] as never,
      new Map(),
      new Map(),
      0,
    );
    expect(layout.connections.c?.points).toEqual([
      [80, 20],
      [300, 20],
    ]);
  });
});

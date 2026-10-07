import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { launch } from './launch';

const root = 'third_party/eraser-diagrams/fixtures';
const corpus = readdirSync(`${root}/corpus`).filter((f) => f.endsWith('.json'));
const TOL = 2;

test('every corpus fixture matches its macOS golden boxes within ±2px', async () => {
  test.skip(process.platform !== 'darwin', 'goldens are darwin-only');
  const { app, page } = await launch();
  await page.waitForFunction(() => (window as any).__dg);
  const failures: string[] = [];
  const times: number[] = [];
  for (const file of corpus) {
    const doc = JSON.parse(readFileSync(`${root}/corpus/${file}`, 'utf8'));
    const golden = JSON.parse(
      readFileSync(`${root}/__goldens__/corpus/${file.replace('.json', '-darwin.json')}`, 'utf8'),
    );
    const out = await page.evaluate(async (d) => {
      const r = await (window as any).__dg.render(d);
      return r.ok ? { ok: true, boxes: r.boxes, ms: r.ms } : { ok: false, errors: r.errors };
    }, doc);
    if (!out.ok) {
      failures.push(`${file}: ${JSON.stringify(out.errors).slice(0, 200)}`);
      continue;
    }
    times.push(out.ms);
    for (const g of golden.entities as any[]) {
      const b = out.boxes[g.id];
      const off = !b
        ? 'missing'
        : ['x', 'y', 'width', 'height']
            .filter((k) => Math.abs(b[k] - g[k]) > TOL)
            .map((k) => `${k} ${b[k]} vs ${g[k]}`);
      if (off === 'missing' || off.length) failures.push(`${file}#${g.id}: ${off}`);
    }
  }
  console.log(`render ms per fixture: ${times.join(',')}`);
  await app.close();
  expect(failures).toEqual([]);
});

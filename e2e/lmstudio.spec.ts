// Real-model acceptance. Skipped unless LM Studio answers on :1234.
// RUNS=10 pnpm exec playwright test e2e/lmstudio.spec.ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch } from './launch';

const URL = process.env.DG_LLM_BASE_URL ?? 'http://127.0.0.1:1234/v1';
const PROMPT = 'AWS serverless API: API Gateway, Lambda, DynamoDB and S3 inside a VPC';
const WANT = ['aws-api-gateway', 'aws-lambda', 'aws-dynamodb', 'aws-simple-storage-service'];

test('LM Studio: AWS serverless prompt is valid, rendered, overlap-free, with correct icons', async () => {
  const up = await fetch(`${URL}/models`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok)
    .catch(() => false);
  test.skip(!up, 'LM Studio is not running');
  const runs = Number(process.env.RUNS ?? 10);
  test.setTimeout(runs * 180_000);
  const dir = mkdtempSync(join(tmpdir(), 'dg-lms-'));
  const { app, page } = await launch({
    DG_LLM_BASE_URL: URL,
    DG_USER_DATA: join(dir, 'ud'),
    DG_SAVE_DIR: dir,
  });
  await expect(page.locator('select[aria-label="Model"] option').first()).not.toHaveText('No model', {
    timeout: 10_000,
  });
  const report: string[] = [];
  let pass = 0;
  for (let i = 0; i < runs; i++) {
    await page.evaluate(() =>
      (window as any).__dg.doc.getState().load({ entities: [], connections: [] }, null),
    );
    await page.getByTestId('ai-prompt').fill(PROMPT);
    const t0 = Date.now();
    await page.getByTestId('ai-run').click();
    await expect(page.getByTestId('ai-outcome')).toBeVisible({ timeout: 170_000 });
    const ms = Date.now() - t0;
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const dg = (window as any).__dg;
      const doc = dg.doc.getState().doc;
      const ui = dg.ui.getState();
      const icons = doc.entities.flatMap((e: any) => [e.icon, e.title?.icon]).filter(Boolean);
      return {
        outcome: document.querySelector('[data-testid="ai-outcome"]')!.textContent,
        entities: doc.entities.length,
        rendered:
          !!ui.render && ui.errors.length === 0 && doc.entities.every((e: any) => ui.render.painted[e.id]),
        quality: ui.render ? dg.checkLayout(doc, ui.render.painted) : null,
        unknownIcons: ui.warnings.filter((w: any) => w.code === 'W_UNKNOWN_ICON').map((w: any) => w.message),
        icons,
        grouped: doc.entities.some((e: any) => e.tag === 'Group'),
      };
    });
    const missing = WANT.filter((w) => !r.icons.includes(w));
    const ok =
      r.rendered &&
      r.entities >= 5 &&
      r.quality &&
      !r.quality.overlaps.length &&
      !r.quality.outside.length &&
      !r.unknownIcons.length &&
      !missing.length &&
      r.grouped;
    if (ok) pass++;
    report.push(
      `run ${i + 1}: ${ok ? 'PASS' : 'FAIL'} ${ms} ms, ${r.entities} entities, overlaps=${r.quality?.overlaps.length} outside=${r.quality?.outside.length} unknownIcons=${r.unknownIcons.length} missing=[${missing}] group=${r.grouped} :: ${r.outcome?.slice(0, 80)}`,
    );
    if (i === 0) {
      await page.keyboard.press('Shift+Digit1');
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(dir, 'run1.png') });
    }
  }
  // A real natural-language edit on the last diagram: existing nodes keep their places.
  const before = await page.evaluate(() => (window as any).__dg.doc.getState().doc);
  await page.getByTestId('ai-prompt').fill('Add an Amazon SQS queue that the Lambda sends messages to');
  await page.getByTestId('ai-run').click();
  await expect(page.getByTestId('ai-outcome')).toBeVisible({ timeout: 170_000 });
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => {
    const dg = (window as any).__dg;
    const ui = dg.ui.getState();
    const doc = dg.doc.getState().doc;
    return {
      doc,
      quality: dg.checkLayout(doc, ui.render.painted),
      text: document.querySelector('[data-testid="ai-outcome"]')!.textContent,
    };
  });
  const kept = before.entities.every((e: any) => {
    const n = after.doc.entities.find((x: any) => x.id === e.id);
    return !n || (n.x === e.x && n.y === e.y) || e.tag === 'Group';
  });
  const added = after.doc.entities.length > before.entities.length;
  report.push(
    `edit: ${added && kept && !after.quality.overlaps.length && !after.quality.outside.length ? 'PASS' : 'FAIL'} added=${added} kept=${kept} overlaps=${after.quality.overlaps.length} outside=${after.quality.outside.length} :: ${after.text?.slice(0, 80)}`,
  );
  await page.keyboard.press('Shift+Digit1');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(dir, 'edit.png') });
  writeFileSync(join(dir, 'report.txt'), report.join('\n'));
  process.stderr.write(`LMS ${dir}\n${report.join('\n')}\nLMS pass ${pass}/${runs}\n`);
  await app.close();
  expect(pass).toBeGreaterThanOrEqual(Math.ceil(runs * 0.8));
  expect(report.at(-1)).toMatch(/^edit: PASS/);
});

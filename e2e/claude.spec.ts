// Real Claude Code CLI acceptance. Uses the installed `claude` and your Claude login (costs usage),
// so it only runs when asked: DG_CLAUDE_E2E=1 pnpm exec playwright test e2e/claude.spec.ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { launch } from './launch';

const GENERATE =
  'Transactional email pipeline on AWS. Calling services publish to an SQS outbound queue. A worker Lambda ' +
  'claims each message, checks a DynamoDB suppression table, renders the template and sends through SendGrid. ' +
  'Failed messages go to an outbound DLQ that alerts Slack through CloudWatch. SendGrid posts delivery events ' +
  'to an API Gateway webhook, which enqueues them on an inbound SQS queue; an ingest Lambda verifies the ' +
  'signature and writes EmailEvents and EmailMessages tables in DynamoDB. Amplitude also receives the events.';
const EDITS = [
  'Add a Redis cache that the worker Lambda reads templates from.',
  'Rename SendGrid to SendGrid (primary).',
];

type Doc = { entities: any[]; connections: any[] };
const state = (page: Page) =>
  page.evaluate(() => {
    const dg = (window as any).__dg;
    const ui = dg.ui.getState();
    const doc = dg.doc.getState().doc;
    return {
      doc,
      errors: ui.errors.length,
      quality: dg.checkLayout(doc, ui.render.painted),
      outcome: document.querySelector('[data-testid="ai-outcome"]')?.textContent ?? '',
    };
  });

/** What an edit must not touch: every old element keeps its id, tag, parent, position and text; every old line stays. */
function damage(before: Doc, after: Doc, renamed?: string): string[] {
  const out: string[] = [];
  const text = (e: any) => JSON.stringify(e.texts ?? e.title?.text ?? e.text ?? e.label ?? null);
  for (const e of before.entities) {
    const n = after.entities.find((x) => x.id === e.id);
    if (!n) out.push(`${e.id} removed`);
    else {
      if (n.tag !== e.tag) out.push(`${e.id} tag ${e.tag}→${n.tag}`);
      if ((n.containerId ?? null) !== (e.containerId ?? null)) out.push(`${e.id} moved to ${n.containerId}`);
      // Containers may grow to fit a new child; everything else stays exactly where it was.
      if (e.tag !== 'Group' && (n.x !== e.x || n.y !== e.y))
        out.push(`${e.id} moved ${e.x},${e.y}→${n.x},${n.y}`);
      if (e.id !== renamed && text(n) !== text(e)) out.push(`${e.id} text changed`);
    }
  }
  for (const c of before.connections) {
    if (!after.connections.some((x) => x.from === c.from && x.to === c.to))
      out.push(`line ${c.from}→${c.to} removed`);
  }
  return out;
}

test('Claude Code CLI: generates a complex diagram and edits it without damaging it', async () => {
  test.skip(!process.env.DG_CLAUDE_E2E, 'set DG_CLAUDE_E2E=1 to run against the real claude CLI');
  test.setTimeout(900_000);
  const dir = mkdtempSync(join(tmpdir(), 'dg-claude-e2e-'));
  const { app, page } = await launch({
    DG_LLM_PROVIDER: 'claude-code',
    ...(process.env.DG_LLM_MODEL ? { DG_LLM_MODEL: process.env.DG_LLM_MODEL } : {}),
    DG_USER_DATA: join(dir, 'ud'),
  });
  const report: string[] = [];
  const shot = async (name: string) => {
    await page.getByText('Fit', { exact: true }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(dir, `${name}.png`) });
  };
  const ask = async (prompt: string) => {
    await page.getByTestId('ai-prompt').fill(prompt);
    const t0 = Date.now();
    await page.getByTestId('ai-run').click();
    await expect(page.getByTestId('ai-outcome')).toBeVisible({ timeout: 400_000 });
    await page.waitForTimeout(800);
    return Date.now() - t0;
  };

  let ms = await ask(GENERATE);
  let s = await state(page);
  const groups = s.doc.entities.filter((e: any) => e.tag === 'Group').length;
  const genOk =
    !s.errors &&
    s.doc.entities.length >= 12 &&
    groups >= 2 &&
    !s.quality.overlaps.length &&
    !s.quality.outside.length;
  report.push(
    `generate: ${genOk ? 'PASS' : 'FAIL'} ${ms} ms, ${s.doc.entities.length} entities, ${groups} groups, ${s.doc.connections.length} lines, overlaps=${s.quality.overlaps.length} outside=${s.quality.outside.length} :: ${s.outcome.slice(0, 120)}`,
  );
  await shot('generate');

  for (const [i, prompt] of EDITS.entries()) {
    const before = s.doc as Doc;
    ms = await ask(prompt);
    s = await state(page);
    const after = s.doc as Doc;
    const renamed =
      i === 1
        ? before.entities.find((e) => /sendgrid/i.test(JSON.stringify(e.texts ?? e.title)))?.id
        : undefined;
    const harm = damage(before, after, renamed);
    const changed =
      i === 0
        ? after.entities.length > before.entities.length
        : JSON.stringify(after.entities.find((e) => e.id === renamed)).includes('primary');
    const ok =
      !s.errors && changed && !harm.length && !s.quality.overlaps.length && !s.quality.outside.length;
    report.push(
      `edit ${i + 1}: ${ok ? 'PASS' : 'FAIL'} ${ms} ms, changed=${changed} damage=[${harm.join('; ')}] overlaps=${s.quality.overlaps.length} outside=${s.quality.outside.length} :: ${s.outcome.slice(0, 120)}`,
    );
    await shot(`edit${i + 1}`);
  }
  writeFileSync(join(dir, 'report.txt'), report.join('\n'));
  writeFileSync(join(dir, 'final.json'), JSON.stringify(s.doc, null, 2));
  process.stderr.write(`CLAUDE ${dir}\n${report.join('\n')}\n`);
  await app.close();
  for (const line of report) expect(line).toMatch(/: PASS/);
});

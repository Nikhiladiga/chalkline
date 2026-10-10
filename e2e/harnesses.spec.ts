import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch } from './launch';

test('Settings discovers harnesses and the Codex dropdown loads and refreshes available models', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dg-harnesses-'));
  for (const name of ['codex', 'claude'])
    writeFileSync(join(dir, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const catalog = join(dir, 'models.json');
  writeFileSync(catalog, JSON.stringify(['codex-model-a', 'codex-model-b']));
  writeFileSync(
    join(dir, 'codex'),
    `#!/usr/bin/env node
require('readline').createInterface({input: process.stdin}).on('line', line => {
  const req = JSON.parse(line);
  if (req.method === 'initialize') process.stdout.write(JSON.stringify({id: req.id, result: {}}) + '\\n');
  if (req.method === 'model/list') process.stdout.write(JSON.stringify({id: req.id, result: {data: JSON.parse(require('fs').readFileSync(${JSON.stringify(catalog)}, 'utf8')).map(model => ({model})), nextCursor: null}}) + '\\n');
});
`,
    { mode: 0o755 },
  );
  const { app, page } = await launch({
    DG_USER_DATA: join(dir, 'ud'),
    PATH: [dir, process.env.PATH].join(delimiter),
  });
  try {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('radio', { name: 'Installed CLI', exact: true }).click();
    const harness = page.getByRole('radiogroup', { name: 'Harness' });
    const codex = harness.getByRole('radio', { name: 'Codex CLI', exact: true });
    await expect(codex).toHaveAccessibleDescription(/Installed/);
    await expect(
      harness.getByRole('radio', { name: 'Claude Code CLI', exact: true }),
    ).toHaveAccessibleDescription(/Installed/);
    await codex.click();
    await expect(page.getByLabel(/^API key/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText('Codex CLI found.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Save settings' }).click();
    const models = page.getByLabel('Model', { exact: true });
    await expect(models.locator('option', { hasText: 'codex-model-a' })).toHaveCount(1);
    await models.selectOption('codex-model-b');
    writeFileSync(catalog, JSON.stringify(['codex-model-b', 'new-codex-model']));
    await page.getByRole('button', { name: 'Refresh models' }).click();
    await expect(models.locator('option', { hasText: 'new-codex-model' })).toHaveCount(1);
    await expect(models.locator('option', { hasText: 'codex-model-a' })).toHaveCount(0);
    await expect(models).toHaveValue('codex-model-b');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Codex CLI', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

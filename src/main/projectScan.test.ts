import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { scanProject } from './projectScan';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'chalkline-scan-'));
  roots.push(root);
  return root;
}
async function file(root: string, path: string, text: string | Buffer) {
  const full = join(root, path);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, text);
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('traces source evidence, applies nested ignores and never includes credentials, binaries or symlinks', async () => {
  const root = await fixture();
  await file(root, 'package.json', '{"dependencies":{"express":"4","pg":"8"}}');
  await file(
    root,
    'src/server.ts',
    "import express from 'express';\nimport { db } from './db';\napp.get('/users', () => db.query('select id from users'));\n",
  );
  await file(
    root,
    'src/db.ts',
    "import { Pool } from 'pg';\nconst password = 'private-value';\nconst url = 'postgres://admin:hunter2@db:5432/app';\n",
  );
  await file(root, '.gitignore', 'ignored/\n*.local.ts\n');
  await file(root, 'ignored/code.ts', 'hidden-root-ignore');
  await file(root, 'src/hidden.local.ts', 'hidden-pattern');
  await file(root, 'src/.gitignore', 'private.ts\n!keep.local.ts\n');
  await file(root, 'src/keep.local.ts', 'export const includedByNestedRule = true;');
  await file(root, 'src/private.ts', 'hidden-nested-ignore');
  for (const name of ['.env', '.env.example', 'credentials.json', 'node_modules/lib/a.ts', 'dist/a.js'])
    await file(root, name, 'never-send-this');
  for (const name of ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md'])
    await file(root, name, 'agent-instruction-marker');
  await file(root, 'blob.ts', Buffer.from([0, 1, 0, 2]));
  const outside = await fixture();
  await file(outside, 'outside.ts', 'symlink-secret');
  await symlink(join(outside, 'outside.ts'), join(root, 'link.ts'));
  await symlink(outside, join(root, 'linked-folder'));
  const before = await readFile(join(root, 'src/db.ts'), 'utf8');
  const scan = await scanProject(root, { maxChars: 16000 });
  expect(scan.filesRead).toBe(4);
  expect(scan.context).toContain('includedByNestedRule');
  expect(scan.context).toContain('src/server.ts');
  expect(scan.context).toContain("3: app.get('/users'");
  expect(scan.context).toContain('express');
  expect(scan.context).toContain('[REDACTED]');
  for (const hidden of [
    'private-value',
    'hunter2',
    'never-send-this',
    'hidden-root-ignore',
    'hidden-pattern',
    'hidden-nested-ignore',
    'symlink-secret',
    'agent-instruction-marker',
  ])
    expect(scan.context).not.toContain(hidden);
  expect(await readFile(join(root, 'src/db.ts'), 'utf8')).toBe(before);
  expect((await scanProject(root, { maxChars: 16000 })).context).toBe(scan.context);
});

it('fails closed for oversized ignore rules and skips unsafe nested ignore scopes', async () => {
  const root = await fixture();
  await file(root, '.gitignore', `${'# padding\n'.repeat(4000)}private-config.json\n`);
  await file(root, 'private-config.json', '{"private":"must-stay-ignored"}');
  await expect(scanProject(root, { maxChars: 8000 })).rejects.toThrow(/ignore rules/i);
  await file(root, '.gitignore', '');
  await file(root, 'nested/.gitignore', `${'# padding\n'.repeat(4000)}private.ts\n`);
  await file(root, 'nested/private.ts', 'unsafe-nested-marker');
  const scan = await scanProject(root, { maxChars: 8000 });
  expect(scan.context).not.toContain('unsafe-nested-marker');
  expect(scan.limited).toBe(true);
  expect(scan.warnings.join(' ')).toMatch(/ignore rules/i);
});

it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'marks unreadable directories as partial coverage',
  async () => {
    const root = await fixture();
    await file(root, 'main.ts', 'export const application = true;');
    await file(root, 'unreadable/code.ts', 'inaccessible-module');
    await chmod(join(root, 'unreadable'), 0);
    try {
      const scan = await scanProject(root, { maxChars: 8000 });
      expect(scan.limited).toBe(true);
      expect(scan.context).toContain('PARTIAL');
      expect(scan.warnings.join(' ')).toMatch(/unreadable/i);
    } finally {
      await chmod(join(root, 'unreadable'), 0o700);
    }
  },
);

it('keeps context bounded, covers separate modules and discloses omissions', async () => {
  const root = await fixture();
  for (const module of ['frontend', 'backend', 'worker'])
    for (let i = 0; i < 12; i++)
      await file(
        root,
        `${module}/src/main${i}.ts`,
        `import service from 'service-${module}-${i}';\n${'app.get("/route", () => service.fetch());\n'.repeat(70)}`,
      );
  const scan = await scanProject(root, { maxChars: 4000 });
  expect(scan.context.length).toBeLessThanOrEqual(4000);
  expect(scan.filesRead).toBe(36);
  expect(scan.filesIncluded).toBeLessThan(scan.filesRead);
  expect(scan.limited).toBe(true);
  expect(scan.context).toContain('frontend/');
  expect(scan.context).toContain('backend/');
  expect(scan.context).toContain('worker/');
  expect(scan.warnings.join(' ')).toMatch(/context|budget/i);
});

it('stops cancelled scans and rejects invalid/empty source folders', async () => {
  const root = await fixture();
  const signal = AbortSignal.abort();
  await expect(scanProject(root, { maxChars: 8000, signal })).rejects.toMatchObject({ name: 'AbortError' });
  await expect(scanProject(root, { maxChars: 8000 })).rejects.toThrow(/source|eligible/i);
  await file(root, 'not-folder.ts', 'export const value = 1;');
  await expect(scanProject(join(root, 'not-folder.ts'), { maxChars: 8000 })).rejects.toThrow(
    /folder|directory/i,
  );
});

it('excludes oversized files and includes deployment and non-JavaScript evidence', async () => {
  const root = await fixture();
  await file(root, 'main.py', 'from fastapi import FastAPI\napp = FastAPI()\n');
  await file(root, 'infra/main.tf', 'resource "aws_lambda_function" "api" {\n  runtime = "python3.12"\n}\n');
  await file(root, 'compose.yaml', 'services:\n  postgres:\n    image: postgres:16\n');
  await file(root, 'huge.ts', 'a'.repeat(300000));
  const scan = await scanProject(root, { maxChars: 16000 });
  expect(scan.context).toContain('aws_lambda_function');
  expect(scan.context).toContain('FastAPI');
  expect(scan.context).toContain('postgres:16');
  expect(scan.filesRead).toBe(3);
  expect(scan.warnings.join(' ')).toMatch(/large|size/i);
});

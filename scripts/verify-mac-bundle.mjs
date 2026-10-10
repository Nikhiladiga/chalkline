import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from '@playwright/test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const bundle = resolve(process.argv[2] ?? join(root, 'dist/mac-arm64', `${pkg.productName}.app`));
const contents = join(bundle, 'Contents');
const plist = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', join(contents, 'Info.plist')], { encoding: 'utf8' }));
for (const key of ['CFBundleName', 'CFBundleDisplayName', 'CFBundleExecutable'])
  if (plist[key] !== pkg.productName) throw new Error(`${key} does not match ${pkg.productName}.`);
if (plist.CFBundleShortVersionString !== pkg.version || plist.CFBundleIdentifier !== 'dev.chalkline.app')
  throw new Error('Bundle identity/version does not match the release.');
const icon = readFileSync(join(contents, 'Resources', plist.CFBundleIconFile));
if (icon.toString('ascii', 0, 4) !== 'icns') throw new Error('Missing packaged application icon.');
execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
const dir = mkdtempSync(join(tmpdir(), 'chalkline-package-'));
const env = { ...process.env, PATH: '/usr/bin:/bin', DG_TEST: '1', DG_USER_DATA: join(dir, 'ud'),
  DG_LLM_PROVIDER: 'codex', DG_LLM_MODEL: 'default', DG_SAVE_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: join(contents, 'MacOS', plist.CFBundleExecutable), env });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__dg);
  await page.getByText(pkg.productName, { exact: true }).first().waitFor();
  const native = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, name: app.getName() }));
  if (!native.packaged || native.name !== pkg.productName) throw new Error('Wrong native app name.');
  const models = await page.evaluate(() => window.api.invoke('llm:models'));
  await page.evaluate(async () => {
    const dg = window.__dg;
    await window.api.invoke('settings:set', { hostedIcons: false });
    dg.actions.loadText(JSON.stringify({ entities: [
      { tag: 'Shape', id: 'api', x: 40, y: 40, texts: [{ text: 'API' }] },
      { tag: 'Shape', id: 'db', x: 340, y: 40, texts: [{ text: 'Database' }] },
    ], connections: [{ from: 'api', to: 'db' }] }), null);
  });
  await page.waitForFunction(() => window.__dg.ui.getState().render?.boxes.db);
  const errors = await page.evaluate(() => window.__dg.ui.getState().errors);
  if (errors.length) throw new Error(JSON.stringify(errors));
  await page.evaluate(async () => { await window.__dg.actions.save(); await window.__dg.actions.exportPng(1, false); await window.__dg.actions.exportSvg(); });
  for (const name of ['diagram.json', 'diagram.png', 'diagram.svg'])
    if (!readFileSync(join(dir, name)).length) throw new Error(`Empty ${name}.`);
  console.log(JSON.stringify({ ...native, bundleId: plist.CFBundleIdentifier, version: pkg.version,
    icon: plist.CFBundleIconFile, iconBytes: icon.length, minimumMacOS: plist.LSMinimumSystemVersion,
    models, renderErrors: errors.length, savePngSvg: 'passed' }, null, 2));
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}

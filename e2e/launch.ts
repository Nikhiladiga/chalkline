import { type ElectronApplication, _electron as electron, type Page } from '@playwright/test';

export async function launch(
  env: Record<string, string> = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const base = { ...process.env } as Record<string, string>;
  // VS Code terminals export this; it turns Electron into plain Node.
  delete base.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env: { ...base, DG_TEST: '1', ...env } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

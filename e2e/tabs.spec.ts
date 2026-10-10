import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launch } from './launch';

// Multi-tab behaviour. Every test runs in test mode, where all motion is 0 ms.
const DOC = {
  entities: [
    { tag: 'Shape', id: 'web', x: 40, y: 40, width: 140, height: 60, texts: [{ text: 'Web' }] },
    { tag: 'Shape', id: 'api', x: 300, y: 40, width: 140, height: 60, texts: [{ text: 'API' }] },
  ],
  connections: [{ from: 'web', to: 'api' }],
};
const SOLO = {
  entities: [{ tag: 'Shape', id: 'solo', x: 40, y: 40, width: 140, height: 60, texts: [{ text: 'Solo' }] }],
  connections: [],
};
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
let app: ElectronApplication | undefined;
let dir: string | undefined;

test.afterEach(async () => {
  await app?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  app = undefined;
  dir = undefined;
});

async function open(env: Record<string, string> = {}): Promise<Page> {
  dir = mkdtempSync(join(tmpdir(), 'dg-tabs-'));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hostedIcons: false }));
  const launched = await launch({ DG_USER_DATA: dir, DG_LLM_BASE_URL: 'http://127.0.0.1:1/v1', ...env });
  app = launched.app;
  const page = launched.page;
  await page.waitForFunction(() => (window as any).__dg);
  return page;
}

const strip = (page: Page) => page.getByRole('tablist', { name: 'Open diagrams' });
const tabs = (page: Page) => strip(page).getByRole('tab');
const activeTab = (page: Page) => strip(page).getByRole('tab', { selected: true });
const newTabButton = (page: Page) => page.getByRole('button', { name: 'New tab' });
/** Load a document into the tab on screen, like Open would. */
const load = (page: Page, doc: unknown, path: string | null = null) =>
  page.evaluate(({ d, p }) => (window as any).__dg.actions.loadText(JSON.stringify(d), p), {
    d: doc,
    p: path,
  });
const docIn = (page: Page, i: number) =>
  page.evaluate((n) => (window as any).__dg.tabs.getState().tabs[n].doc, i);
const ids = (doc: any): string[] => doc.entities.map((e: any) => e.id);
const closeAt = async (page: Page, i: number) => {
  await page.locator('.doc-tab').nth(i).hover();
  await page.locator('.doc-tab').nth(i).locator('.tab-close').click();
};

test('the strip shows each document as a tab titled by its file name', async () => {
  const page = await open();
  await expect(tabs(page)).toHaveText(['Untitled']);
  await load(page, DOC, '/tmp/Payments Flow.json');
  await expect(activeTab(page)).toHaveText('Payments Flow');
  await expect(activeTab(page)).toHaveAttribute('title', '/tmp/Payments Flow.json');
  await newTabButton(page).click();
  await expect(tabs(page)).toHaveText(['Payments Flow', 'Untitled']);
  await expect(activeTab(page)).toHaveText('Untitled');
  // The active tab carries the lavender --line bar.
  expect(
    await page.locator('.doc-tab[data-active]').evaluate((el) => getComputedStyle(el).boxShadow),
  ).toContain('rgb(117, 129, 238)');
  await page.evaluate((d) => (window as any).__dg.doc.getState().commit(d), SOLO);
  await expect(activeTab(page)).toContainText('edited');
  await expect(activeTab(page).locator('.dirty-dot')).toBeVisible();
  // Tabs and + are no-drag; empty strip space still drags the window.
  for (const sel of ['.tab-new', '.doc-tab', '.tab-main', '.tab-close'])
    expect(
      await page
        .locator(sel)
        .first()
        .evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region')),
    ).toBe('no-drag');
  expect(
    await page
      .locator('.tabstrip')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region')),
  ).toBe('drag');
  if (process.platform === 'darwin') {
    // The traffic lights keep their inset.
    expect((await tabs(page).first().boundingBox())!.x).toBeGreaterThanOrEqual(84);
  }
});

test('each tab keeps its own diagram, history, selection and view', async () => {
  const page = await open();
  await load(page, DOC);
  await expect(page.locator('.hit')).toHaveCount(2);
  await page.locator('.hit[data-id="api"]').click();
  await expect(page.getByTestId('inspector')).toContainText('api');
  await page.evaluate(() => (window as any).__dg.ui.getState().set({ zoom: 0.5, pan: { x: 10, y: 20 } }));
  await newTabButton(page).click();
  await expect(page.locator('.hit')).toHaveCount(0);
  await expect(page.getByText('Select an element to edit it.')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__dg.ui.getState().zoom)).toBe(1);
  await load(page, SOLO);
  await expect(page.locator('.hit')).toHaveCount(1);
  await page.locator('.hit[data-id="solo"]').click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.hit')).toHaveCount(0);
  await page.locator('.canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${mod}+z`);
  await expect(page.locator('.hit')).toHaveCount(1);
  await tabs(page).first().click();
  await expect(page.locator('.hit')).toHaveCount(2);
  await expect(page.getByTestId('inspector')).toContainText('api');
  expect(
    await page.evaluate(() => {
      const u = (window as any).__dg.ui.getState();
      return { zoom: u.zoom, pan: u.pan };
    }),
  ).toEqual({ zoom: 0.5, pan: { x: 10, y: 20 } });
  await page.keyboard.press(`${mod}+z`); // nothing to undo in this tab; tab 2's history must not leak
  expect(ids(await docIn(page, 0))).toEqual(['web', 'api']);
  expect(ids(await docIn(page, 1))).toEqual(['solo']);
});

test('switching tabs mid-drag cancels the drag in its own tab', async () => {
  const page = await open();
  await load(page, DOC);
  await newTabButton(page).click();
  await tabs(page).first().click();
  await expect(page.locator('.hit')).toHaveCount(2);
  const box = (await page.locator('.hit[data-id="web"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 150, { steps: 5 });
  await page.evaluate(() => {
    const dg = (window as any).__dg;
    dg.actions.switchTab(dg.tabs.getState().tabs[1].id);
  });
  await page.mouse.move(box.x + 260, box.y + 200, { steps: 3 });
  await page.mouse.up();
  expect(await docIn(page, 1)).toEqual({ entities: [], connections: [] });
  expect(await docIn(page, 0)).toEqual(DOC);
  expect(await page.evaluate(() => (window as any).__dg.tabs.getState().tabs[0].past.length)).toBe(0);
});

test('the code editor and its own undo stay with their tab', async () => {
  const page = await open();
  await load(page, DOC);
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+A`);
  await page.keyboard.insertText('{"entities": [');
  await expect(page.locator('.draft-bar')).toBeVisible();
  await newTabButton(page).click();
  await expect(page.locator('.cm-content')).toContainText('"entities": []');
  await expect(page.locator('.draft-bar')).toBeHidden();
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+z`); // CodeMirror's own undo must not bring back tab 1's text
  await expect(page.locator('.cm-content')).toContainText('"entities": []');
  expect(await page.evaluate(() => (window as any).__dg.doc.getState().codeDraft)).toBeNull();
  await tabs(page).first().click();
  await expect(page.locator('.cm-content')).toHaveText('{"entities": [');
  await expect(page.locator('.draft-bar')).toBeVisible();
});

test('closing a dirty tab asks first, and closing the last tab leaves a fresh Untitled', async () => {
  const page = await open();
  await load(page, DOC, '/tmp/keep.json');
  await page.evaluate(() => (window as any).__dg.doc.setState({ dirty: true }));
  await newTabButton(page).click();
  let message = '';
  page.once('dialog', (d) => {
    message = d.message();
    void d.dismiss();
  });
  await closeAt(page, 0);
  expect(message).toBe('Discard unsaved changes to “keep”?');
  await expect(tabs(page)).toHaveText(['keep — edited', 'Untitled']);
  page.once('dialog', (d) => void d.accept());
  await closeAt(page, 0);
  await expect(tabs(page)).toHaveText(['Untitled']);
  const before = await page.evaluate(() => (window as any).__dg.tabs.getState().activeId);
  await tabs(page).first().click({ button: 'middle' });
  await expect(tabs(page)).toHaveText(['Untitled']);
  expect(await page.evaluate(() => (window as any).__dg.tabs.getState().activeId)).not.toBe(before);
  expect(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

test('titles show in full while there is room', async () => {
  const page = await open();
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 800));
  await load(page, DOC, '/tmp/Payments Flow.json');
  await newTabButton(page).click();
  await load(page, DOC, '/tmp/Auth Service.json');
  await newTabButton(page).click();
  await expect(tabs(page)).toHaveText(['Payments Flow', 'Auth Service', 'Untitled']);
  const cut = await page
    .locator('.tab-title')
    .evaluateAll((els) => els.map((el) => el.scrollWidth > el.clientWidth));
  expect(cut).toEqual([false, false, false]);
  // After a click switch, focus stays on the clicked tab.
  await tabs(page).first().click();
  await expect(tabs(page).first()).toBeFocused();
});

test('many tabs scroll the strip and never push the toolbar or canvas off-screen', async () => {
  const page = await open();
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1100, 700));
  for (let i = 0; i < 11; i++) await newTabButton(page).click();
  await expect(tabs(page)).toHaveCount(12);
  const m = await page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const tabsEl = document.querySelector('.tabs') as HTMLElement;
    return {
      w: window.innerWidth,
      settings: r('[aria-label="Settings"]').right,
      canvas: r('.canvas').right,
      scrolls: tabsEl.scrollWidth > tabsEl.clientWidth,
    };
  });
  expect(m.settings).toBeLessThanOrEqual(m.w);
  expect(m.canvas).toBeLessThanOrEqual(m.w);
  expect(m.scrolls).toBe(true);
});

/** Mock OpenAI-compatible LLM that answers after `ms` (default: DOC plus a "db" shape), so a run is still going when the test acts. */
async function slowLlm(ms = 1500, reply?: string): Promise<{ url: string; close: () => void }> {
  const text =
    reply ??
    JSON.stringify({
      ...DOC,
      entities: [...DOC.entities, { tag: 'Shape', id: 'db', x: 560, y: 40, texts: [{ text: 'DB' }] }],
    });
  const server = createServer((req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    req.resume();
    req.on('end', () =>
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`);
      }, ms),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    close: () => server.close(),
  };
}
/** Every tab has its own AI panel; only the visible one counts. */
const shown = (page: Page, testId: string) => page.locator(`[data-testid="${testId}"]:visible`);
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop', exact: true });
const spinnerAt = (page: Page, i: number) => page.locator('.doc-tab').nth(i).locator('.spinner');
const startAi = async (page: Page, prompt = 'add a database') => {
  await shown(page, 'ai-prompt').fill(prompt);
  await shown(page, 'ai-run').click();
  await expect(stopButton(page)).toBeVisible();
};

// Review Focus 1
test('an AI result lands in the tab that started it, not the tab on screen', async () => {
  const llm = await slowLlm();
  try {
    const page = await open({ DG_LLM_BASE_URL: llm.url, DG_LLM_MODEL: 'mock' });
    await load(page, DOC);
    await startAi(page);
    await expect(page.locator('.stage-line:visible')).toHaveCount(1);
    await newTabButton(page).click();
    await load(page, SOLO);
    await expect(spinnerAt(page, 0)).toBeVisible();
    // Tab 2 shows its own AI panel: empty prompt, idle, no progress line from tab 1's run.
    await expect(shown(page, 'ai-prompt')).toHaveValue('');
    await expect(stopButton(page)).toBeHidden();
    await expect(page.locator('.stage-line:visible')).toHaveCount(0);
    await expect.poll(async () => ids(await docIn(page, 0)), { timeout: 15_000 }).toContain('db');
    expect(ids(await docIn(page, 1))).toEqual(['solo']);
    await expect(spinnerAt(page, 0)).toHaveCount(0);
    await expect(shown(page, 'ai-outcome')).toHaveCount(0);
    // The canvas shows this tab's diagram, not the background run's last measure.
    await expect(page.locator('#eraser-scene [data-mdp-id="solo"]')).toHaveCount(1);
    await expect(page.locator('#eraser-scene [data-mdp-id="db"]')).toHaveCount(0);
    await tabs(page).first().click();
    await expect(shown(page, 'ai-outcome')).toContainText('Diagram updated');
    await expect(page.locator('.hit[data-id="db"]')).toBeVisible();
    await shown(page, 'ai-outcome').getByRole('button', { name: 'Undo AI change' }).click();
    expect(ids(await docIn(page, 0))).toEqual(['web', 'api']);
    expect(ids(await docIn(page, 1))).toEqual(['solo']);
  } finally {
    llm.close();
  }
});

test('a changed background tab confirms by name, and the result still lands in that tab', async () => {
  const llm = await slowLlm(2000);
  try {
    const page = await open({ DG_LLM_BASE_URL: llm.url, DG_LLM_MODEL: 'mock' });
    await load(page, DOC);
    await startAi(page);
    // Edit tab 1 while its run is going, then move to tab 2 before the result arrives.
    await page.evaluate(() => {
      const s = (window as any).__dg.doc.getState();
      s.commit({ ...s.doc, entities: s.doc.entities.map((e: any) => ({ ...e, x: e.x + 10 })) });
    });
    await newTabButton(page).click();
    await load(page, SOLO);
    const message = new Promise<string>((resolve) =>
      page.once('dialog', (d) => {
        resolve(d.message());
        void d.accept();
      }),
    );
    expect(await message).toBe(
      'In “Untitled”: The diagram or code changed. Replace it with the AI result? Diagram changes stay in undo history; any code draft will be discarded.',
    );
    await expect.poll(async () => ids(await docIn(page, 0))).toContain('db');
    expect(ids(await docIn(page, 1))).toEqual(['solo']);
    await expect(page.locator('#eraser-scene [data-mdp-id="db"]')).toHaveCount(0);
  } finally {
    llm.close();
  }
});

test('Stop still stops a run after switching away and back, and leaves the other tab running', async () => {
  const llm = await slowLlm(4000);
  try {
    const page = await open({ DG_LLM_BASE_URL: llm.url, DG_LLM_MODEL: 'mock' });
    await load(page, DOC);
    await startAi(page);
    await newTabButton(page).click();
    await expect(stopButton(page)).toBeHidden();
    await load(page, DOC);
    await startAi(page);
    await tabs(page).first().click();
    await stopButton(page).click();
    await expect(shown(page, 'ai-outcome')).toContainText('Stopped.');
    await expect(spinnerAt(page, 0)).toHaveCount(0);
    await expect(spinnerAt(page, 1)).toBeVisible();
    expect(ids(await docIn(page, 0))).toEqual(['web', 'api']);
    await expect.poll(async () => ids(await docIn(page, 1)), { timeout: 15_000 }).toContain('db');
    expect(ids(await docIn(page, 0))).toEqual(['web', 'api']);
  } finally {
    llm.close();
  }
});

test('closing a tab with a running AI asks, stops the run, and nothing lands elsewhere', async () => {
  const llm = await slowLlm(2000);
  try {
    const page = await open({ DG_LLM_BASE_URL: llm.url, DG_LLM_MODEL: 'mock' });
    await load(page, DOC);
    await newTabButton(page).click();
    await load(page, DOC);
    await startAi(page);
    let message = '';
    page.once('dialog', (d) => {
      message = d.message();
      void d.dismiss();
    });
    await closeAt(page, 1);
    expect(message).toBe('An AI run is still going in “Untitled 2”. Stop it and close the tab?');
    await expect(tabs(page)).toHaveCount(2);
    await expect(stopButton(page)).toBeVisible();
    page.once('dialog', (d) => {
      message = d.message();
      void d.accept();
    });
    await closeAt(page, 1);
    await expect(tabs(page)).toHaveCount(1);
    await page.waitForTimeout(3000);
    expect(ids(await docIn(page, 0))).toEqual(['web', 'api']);
  } finally {
    llm.close();
  }
});

test('an invalid AI draft becomes the code draft of the tab that asked for it', async () => {
  const llm = await slowLlm(800, '{ not valid json');
  try {
    const page = await open({ DG_LLM_BASE_URL: llm.url, DG_LLM_MODEL: 'mock' });
    await load(page, DOC);
    await startAi(page);
    await newTabButton(page).click();
    await page.getByRole('tab', { name: 'Code', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__dg.tabs.getState().tabs[0].codeDraft), {
        timeout: 15_000,
      })
      .toBe('{ not valid json');
    await expect(spinnerAt(page, 0)).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__dg.doc.getState().codeDraft)).toBeNull();
    await expect(page.locator('.draft-bar')).toBeHidden();
    await expect(page.locator('.cm-content')).toContainText('"entities": []');
    await tabs(page).first().click();
    await expect(page.locator('.draft-bar')).toBeVisible();
    await expect(page.locator('.cm-content')).toHaveText('{ not valid json');
  } finally {
    llm.close();
  }
});

test('Open focuses a file that is already open, even through a symlink, and replaces an untouched Untitled', async () => {
  const page = await open();
  const file = join(dir!, 'Orders.json');
  writeFileSync(file, JSON.stringify(DOC));
  symlinkSync(file, join(dir!, 'alias.json'));
  const pick = (path: string) =>
    app!.evaluate(({ dialog }, p) => {
      (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, path);
  const openFile = () => page.evaluate(() => (window as any).__dg.actions.openFile());
  await shown(page, 'ai-prompt').fill('stale prompt'); // typed into the untouched Untitled, which Open reuses
  await pick(file);
  await openFile();
  await expect(tabs(page)).toHaveText(['Orders']); // the untouched Untitled was replaced
  await expect(page.locator('.hit')).toHaveCount(2); // the opened diagram renders in the reused tab
  await expect(shown(page, 'ai-prompt')).toHaveValue(''); // its AI inputs are fresh
  await newTabButton(page).click();
  await openFile();
  await expect(tabs(page)).toHaveText(['Orders', 'Untitled']);
  await expect(activeTab(page)).toHaveText('Orders');
  await tabs(page).nth(1).click();
  await pick(join(dir!, 'alias.json'));
  await openFile();
  await expect(tabs(page)).toHaveCount(2);
  await expect(activeTab(page)).toHaveText('Orders');
  // An edited Untitled is never replaced: the file opens beside it.
  await tabs(page).nth(1).click();
  await page.evaluate(() =>
    (window as any).__dg.doc
      .getState()
      .commit({ entities: [{ tag: 'Shape', id: 'mine', x: 0, y: 0 }], connections: [] }),
  );
  const other = join(dir!, 'Billing.json');
  writeFileSync(other, JSON.stringify(SOLO));
  await pick(other);
  await openFile();
  await expect(tabs(page)).toHaveCount(3);
  await expect(activeTab(page)).toHaveText('Billing');
  expect(ids(await docIn(page, 1))).toEqual(['mine']);
});

test('Open and loadText never replace the document of a busy tab', async () => {
  const page = await open();
  await load(page, DOC);
  await page.evaluate(() =>
    (window as any).__dg.tabs.setState((s: any) => ({
      tabs: s.tabs.map((t: any) => ({ ...t, busy: true })),
    })),
  );
  await load(page, SOLO);
  await expect(tabs(page)).toHaveCount(2);
  expect(ids(await docIn(page, 0))).toEqual(['web', 'api']);
  expect(ids(await docIn(page, 1))).toEqual(['solo']);
  // openInTab on a busy, otherwise untouched tab also opens beside it.
  await page.evaluate(() => (window as any).__dg.actions.closeTab());
  await page.evaluate(() => {
    const dg = (window as any).__dg;
    dg.tabs.setState((s: any) => ({ tabs: s.tabs.map((t: any) => ({ ...t, busy: false })) }));
    dg.actions.loadText('{"entities":[],"connections":[]}', null);
    dg.tabs.setState((s: any) => ({ tabs: s.tabs.map((t: any) => ({ ...t, busy: true })) }));
    dg.actions.openInTab(JSON.stringify({ entities: [], connections: [] }), '/tmp/x.json', 'k');
  });
  await expect(tabs(page)).toHaveCount(2);
});

test('keyboard switches tabs, also from a text field, but not while Settings is open', async () => {
  const page = await open();
  for (const doc of [DOC, SOLO]) {
    await newTabButton(page).click();
    await load(page, doc);
  }
  const at = () =>
    page.evaluate(() => {
      const s = (window as any).__dg.tabs.getState();
      return s.tabs.findIndex((t: any) => t.id === s.activeId);
    });
  await page.locator('.canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+Tab');
  expect(await at()).toBe(0); // wraps
  await page.keyboard.press('Control+Shift+Tab');
  expect(await at()).toBe(2);
  await page.keyboard.press(`${mod}+1`);
  expect(await at()).toBe(0);
  await page.keyboard.press(`${mod}+9`);
  expect(await at()).toBe(2);
  await page.keyboard.press(`${mod}+5`); // there is no fifth tab
  expect(await at()).toBe(2);
  if (process.platform === 'darwin') {
    await page.keyboard.press('Meta+Shift+BracketLeft');
    expect(await at()).toBe(1);
    await page.keyboard.press('Meta+Shift+BracketRight');
    expect(await at()).toBe(2);
  }
  await page.keyboard.press(`${mod}+2`);
  expect(await at()).toBe(1);
  await page.locator('[data-testid="ai-prompt"]:visible').click();
  await page.keyboard.type('a1[');
  await page.keyboard.press(`${mod}+1`);
  expect(await at()).toBe(0);
  await page.keyboard.press(`${mod}+2`);
  await expect(page.locator('[data-testid="ai-prompt"]:visible')).toHaveValue('a1[');
  await page.keyboard.press(`${mod}+Comma`);
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Control+Tab');
  expect(await at()).toBe(1); // Settings is a modal: tab keys do nothing
});

test('the icon picker keeps the tab it was opened in, even if a menu action arrives', async () => {
  const page = await open();
  await load(page, {
    entities: [{ tag: 'Icon', id: 'node', x: 100, y: 100, icon: 'server' }],
    connections: [],
  });
  await newTabButton(page).click();
  await tabs(page).nth(0).click();
  await page.evaluate(() =>
    (window as any).__dg.doc.getState().select({ entities: ['node'], connections: [] }),
  );
  await page.getByTestId('inspector').getByRole('button', { name: 'server', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Choose an icon' });
  await expect(modal).toBeVisible();
  for (const id of ['next-tab', 'prev-tab', 'new-tab', 'close-tab', 'new'])
    await app!.evaluate(({ Menu }, i) => Menu.getApplicationMenu()!.getMenuItemById(i)!.click(), id);
  await page.keyboard.press('Control+Tab');
  await expect(tabs(page)).toHaveCount(2);
  await expect(activeTab(page)).toHaveText('Untitled');
  await modal.getByRole('textbox').fill('lambda');
  await modal.locator('.icon-cell').first().click();
  expect((await docIn(page, 0)).entities[0].icon).not.toBe('server');
  expect(await docIn(page, 1)).toEqual({ entities: [], connections: [] });
});

test('the menu has New Tab, Close Tab and tab switching; closing the last tab keeps the window', async () => {
  const page = await open();
  const item = (id: string) =>
    app!.evaluate(({ Menu }, i) => {
      const m = Menu.getApplicationMenu()!.getMenuItemById(i)!;
      return { label: m.label, accelerator: m.accelerator ?? null };
    }, id);
  const click = (id: string) =>
    app!.evaluate(({ Menu }, i) => {
      Menu.getApplicationMenu()!.getMenuItemById(i)!.click();
    }, id);
  expect(await item('new-tab')).toEqual({ label: 'New Tab', accelerator: 'CmdOrCtrl+T' });
  expect(await item('close-tab')).toEqual({ label: 'Close Tab', accelerator: 'CmdOrCtrl+W' });
  expect(await item('next-tab')).toEqual({ label: 'Next Tab', accelerator: 'Ctrl+Tab' });
  expect(await item('prev-tab')).toEqual({ label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab' });
  if (process.platform === 'darwin')
    expect(await item('close-window')).toEqual({ label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W' });
  await click('new-tab');
  await click('new');
  await expect(tabs(page)).toHaveText(['Untitled', 'Untitled 2', 'Untitled 3']);
  await click('prev-tab');
  await expect(activeTab(page)).toHaveText('Untitled 2');
  await click('next-tab');
  await expect(activeTab(page)).toHaveText('Untitled 3');
  for (let i = 0; i < 3; i++) await click('close-tab');
  await expect(tabs(page)).toHaveText(['Untitled']);
  expect(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

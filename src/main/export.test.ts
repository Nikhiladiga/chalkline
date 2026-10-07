import { ipcMain } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { renderPng } from './export';

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Window {
    webContents = Object.assign(new EventEmitter(), {
      send: vi.fn(),
      debugger: {
        attach: vi.fn(),
        detach: vi.fn(),
        sendCommand: vi.fn().mockResolvedValue({ data: 'cG5n' }),
      },
    });
    destroy = vi.fn();
  }
  return { BrowserWindow: Window, ipcMain: new EventEmitter(), ClipboardItem: class {}, clipboard: {} };
});
vi.mock('./files', () => ({ askSavePath: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  ipcMain.removeAllListeners();
});

it('removes the export-ready subscription when rendering times out', async () => {
  vi.useFakeTimers();
  let win: any;
  const result = renderPng(
    (w) => {
      win = w;
    },
    {},
    {},
    1,
    false,
    'dark',
  );
  const rejected = expect(result).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(60_000);
  await rejected;
  expect(ipcMain.listenerCount('export:ready')).toBe(0);
  expect(win.webContents.listenerCount('did-finish-load')).toBe(0);
  expect(win.destroy).toHaveBeenCalledOnce();
});

it('rejects a failed export page load immediately and releases subscriptions and its timer', async () => {
  vi.useFakeTimers();
  let win: any;
  const result = renderPng(
    (w) => {
      win = w;
      win.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND');
    },
    {},
    {},
    1,
    false,
    'dark',
  );
  const outcome = result.catch((error) => error);
  expect(vi.getTimerCount()).toBe(0);
  await expect(outcome).resolves.toMatchObject({ message: expect.stringContaining('ERR_FILE_NOT_FOUND') });
  expect(ipcMain.listenerCount('export:ready')).toBe(0);
  expect(win.webContents.listenerCount('did-finish-load')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('captures a successful export and removes all render subscriptions', async () => {
  let win: any;
  const png = await renderPng(
    (w) => {
      win = w;
      win.webContents.emit('did-finish-load');
      ipcMain.emit('export:ready', { sender: win.webContents }, { width: 100, height: 80 });
    },
    {},
    {},
    1,
    false,
    'dark',
  );
  expect(png.toString()).toBe('png');
  expect(ipcMain.listenerCount('export:ready')).toBe(0);
  expect(win.webContents.listenerCount('did-fail-load')).toBe(0);
  expect(win.destroy).toHaveBeenCalledOnce();
});

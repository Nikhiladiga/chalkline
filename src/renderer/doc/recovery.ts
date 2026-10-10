import type { OpenedFile } from '../../shared/ipc';
import { docFromJson } from '../ai/parse';
import { type Tab, type TabInit, useTabs } from './store';

export interface RecoveredTab {
  doc: unknown;
  codeDraft: string | null;
  filePath: string | null;
  dirty: boolean;
}

/** `userData/recovery.json`: every open tab with content, in strip order, and the active one. Never `busy`. */
export interface Recovery {
  recoveryVersion: 2;
  active: number;
  tabs: RecoveredTab[];
}

const hasContent = (t: Tab) =>
  t.dirty ||
  t.filePath !== null ||
  t.codeDraft !== null ||
  t.doc.entities.length > 0 ||
  t.doc.connections.length > 0;

/** The recovery file for these tabs, or null when nothing is unsaved (the file should be cleared). */
export function toRecovery(tabs: Tab[], activeId: string): string | null {
  if (!tabs.some((t) => t.dirty)) return null;
  const kept = tabs.filter(hasContent);
  const recovery: Recovery = {
    recoveryVersion: 2,
    active: Math.max(
      0,
      kept.findIndex((t) => t.id === activeId),
    ),
    tabs: kept.map(({ doc, codeDraft, filePath, dirty }) => ({ doc, codeDraft, filePath, dirty })),
  };
  return JSON.stringify(recovery);
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const isObject = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object';

/**
 * Read any recovery file this app ever wrote: v2, v1 (one document and its code draft) or a bare
 * document. A corrupt file, a non-object or an unknown (future) version holds nothing to restore.
 */
export function fromRecovery(text: string): Recovery {
  const none: Recovery = { recoveryVersion: 2, active: 0, tabs: [] };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return none;
  }
  if (!isObject(value)) return none;
  const version = value.recoveryVersion;
  if (version === 2) {
    if (!Array.isArray(value.tabs)) return none;
    const tabs: RecoveredTab[] = value.tabs.filter(isObject).map((t) => ({
      doc: t.doc,
      codeDraft: str(t.codeDraft),
      filePath: str(t.filePath),
      dirty: t.dirty !== false,
    }));
    const active = Number.isInteger(value.active)
      ? Math.min(Math.max(value.active, 0), Math.max(tabs.length - 1, 0))
      : 0;
    return { recoveryVersion: 2, active, tabs };
  }
  if (version !== undefined && version !== 1) return none;
  const v1 = version === 1;
  return {
    recoveryVersion: 2,
    active: 0,
    tabs: [
      {
        doc: v1 ? value.doc : value,
        codeDraft: v1 ? str(value.codeDraft) : null,
        filePath: null,
        dirty: true,
      },
    ],
  };
}

/**
 * A recovered snapshot as a new tab: always an edited Untitled (no path), so its first save asks where.
 * Never drops a tab: an unreadable document comes back as a code draft.
 */
export function restoredTab(t: RecoveredTab): TabInit {
  const base = { filePath: null, dirty: true, view: null };
  try {
    return { ...base, doc: docFromJson(t.doc), codeDraft: t.codeDraft };
  } catch {
    return { ...base, codeDraft: t.codeDraft ?? JSON.stringify(t.doc, null, 2) ?? '' };
  }
}

/**
 * Every entry as a new tab, in order. A clean file tab reloads its file from disk through `read`
 * (main's `file:reopen`: null unless the user once chose that file in a dialog). If that gives
 * nothing (unknown, moved, deleted, no longer a diagram) its snapshot comes back instead and the
 * path is listed in `missing`.
 */
export async function restoredTabs(
  r: Recovery,
  read: (path: string) => Promise<OpenedFile | null>,
): Promise<{ tabs: TabInit[]; missing: string[] }> {
  const missing: string[] = []; // by tab index, so the list keeps tab order whatever finishes first
  const tabs = await Promise.all(
    r.tabs.map(async (t, i): Promise<TabInit> => {
      if (t.dirty || t.filePath === null) return restoredTab(t);
      try {
        const f = await read(t.filePath);
        if (!f) throw new Error('not reopened');
        const doc = docFromJson(JSON.parse(f.content));
        return { doc, codeDraft: null, filePath: f.path, fileKey: f.key, dirty: false, view: null };
      } catch {
        missing[i] = t.filePath;
        return restoredTab(t);
      }
    }),
  );
  return { tabs, missing: missing.filter(() => true) };
}

/**
 * Keep the recovery file in step with the tabs: `delay` ms after the last change, write it; once
 * nothing is unsaved, clear it at once (a save or discard followed by quit leaves no crash file).
 * Starts as "nothing written", so a clean start never deletes a crash file before the restore prompt
 * is answered. Returns the unsubscribe function.
 */
export function watchRecovery(
  io: { write(text: string): Promise<unknown>; clear(): Promise<unknown> },
  onError: (e: unknown) => void,
  delay = 2000,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: string | null | undefined = null; // undefined: the last write failed, so retry on the next change
  const flush = () => {
    const s = useTabs.getState();
    const text = toRecovery(s.tabs, s.activeId);
    if (text === last) return;
    last = text;
    void (text === null ? io.clear() : io.write(text)).catch((e) => {
      last = undefined;
      onError(e);
    });
  };
  const off = useTabs.subscribe((s, p) => {
    if (s.tabs === p.tabs && s.activeId === p.activeId) return;
    clearTimeout(timer);
    if (!s.tabs.some((t) => t.dirty)) return flush();
    // Unsaved work exists (e.g. restored tabs), so the file may need clearing even before the first write.
    if (last === null) last = undefined;
    timer = setTimeout(flush, delay);
  });
  return () => {
    off();
    clearTimeout(timer);
  };
}

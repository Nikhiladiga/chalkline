import { create } from 'zustand';
import type { PublicSettings } from '../../shared/ipc';
import { ipcMessage } from './actions';

interface AiSettings {
  settings: PublicSettings | null;
  models: string[];
  connError: string | null;
  loading: boolean;
}

/** Provider settings and model list, shared by every tab's AI panel (settings are global). */
export const useAiSettings = create<AiSettings>(() => ({
  settings: null,
  models: [],
  connError: null,
  loading: false,
}));

let request = 0;

/** Reload settings and the model list; only the newest request may write. */
export async function refreshModels(): Promise<void> {
  const mine = ++request;
  const set = useAiSettings.setState;
  set({ loading: true });
  try {
    const s: PublicSettings = await window.api.invoke('settings:get');
    if (mine !== request) return;
    set({ settings: s });
    const list: string[] = await window.api.invoke('llm:models');
    if (mine !== request) return;
    set({ models: list, connError: null });
    if (!s.model && list[0]) set({ settings: await window.api.invoke('settings:set', { model: list[0] }) });
  } catch (e) {
    if (mine === request) set({ models: [], connError: ipcMessage(e) });
  } finally {
    if (mine === request) set({ loading: false });
  }
}

export async function saveAiSettings(patch: { model?: string; deepScan?: boolean }): Promise<void> {
  useAiSettings.setState({ settings: await window.api.invoke('settings:set', patch) });
}

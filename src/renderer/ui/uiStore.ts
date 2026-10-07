import type { ConnectionGeometry } from '@eraserlabs/render';
import { create } from 'zustand';
import type { Theme } from '../engine/theme';
import type { Box, Issue } from '../engine/types';

/** The last good render, in doc coordinates. */
export interface RenderInfo {
  boxes: Record<string, Box>;
  painted: Record<string, Box>;
  connections: Record<string, ConnectionGeometry>;
  connectionIds: string[];
  origin: { x: number; y: number };
  size: { width: number; height: number };
  bounds: Box;
  ms: number;
  scene: HTMLElement;
  measured: unknown;
}

interface UiState {
  render: RenderInfo | null;
  errors: Issue[];
  warnings: Issue[];
  zoom: number;
  pan: { x: number; y: number };
  /** Text shown in the code pane instead of the document (an AI draft that failed validation). */
  draft: string | null;
  showCode: boolean;
  leftMode: 'icons' | 'code';
  showAi: boolean;
  settingsOpen: boolean;
  iconPick: ((name: string) => void) | null;
  toast: string | null;
  fitRequest: number;
  /** Bump to re-render the current document. */
  renderTick: number;
  theme: Theme;
  set(patch: Partial<UiState>): void;
}

export const useUi = create<UiState>((set) => ({
  render: null,
  errors: [],
  warnings: [],
  zoom: 1,
  pan: { x: 40, y: 40 },
  draft: null,
  showCode: true,
  leftMode: 'icons',
  showAi: true,
  settingsOpen: false,
  iconPick: null,
  toast: null,
  fitRequest: 0,
  renderTick: 0,
  theme: 'dark',
  set: (patch) => set(patch),
}));

export const requestFit = () => useUi.setState((s) => ({ fitRequest: s.fitRequest + 1 }));
export const toast = (msg: string) => {
  useUi.setState({ toast: msg });
  setTimeout(() => useUi.getState().toast === msg && useUi.setState({ toast: null }), 3500);
};

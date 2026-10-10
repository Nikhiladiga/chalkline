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
  /** Fit once the next render of the (just changed) document lands, not the stale one. */
  fitPending: boolean;
  /** Bump to re-render the current document. */
  renderTick: number;
  theme: Theme;
  /** Stage transform eases for this kind of programmatic view change; null for 1:1 wheel/drag. */
  ease: 'pane' | 'view' | null;
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
  fitPending: false,
  renderTick: 0,
  theme: 'dark',
  ease: null,
  set: (patch) => set(patch),
}));

let easeTimer: ReturnType<typeof setTimeout> | undefined;
/** Animate the next pan/zoom change. Use only for buttons, shortcuts and pane toggles, never wheel or drag. */
export function easeView(kind: 'pane' | 'view'): void {
  clearTimeout(easeTimer);
  useUi.setState({ ease: kind });
  // ponytail: fixed 320 ms ≥ --dur-slow; read the token if durations change.
  easeTimer = setTimeout(() => useUi.setState({ ease: null }), 320);
}

/**
 * The one way to open or close a side pane. The left pane moves the board's left edge, so pan shifts
 * by the same amount, with the same easing as the column, and the diagram stays put on screen.
 */
export function setPane(side: 'left' | 'right', open: boolean): void {
  const ui = useUi.getState();
  if (side === 'right') {
    ui.set({ showAi: open });
    return;
  }
  if (ui.showCode === open) return;
  const ws = document.querySelector('.workspace');
  const css = ws ? getComputedStyle(ws) : null;
  const delta =
    (css
      ? Number.parseFloat(css.getPropertyValue('--code-open')) -
        Number.parseFloat(css.getPropertyValue('--rail'))
      : 0) || 0;
  easeView('pane');
  ui.set({ showCode: open, pan: { x: ui.pan.x + (open ? -delta : delta), y: ui.pan.y } });
}

export const requestFitAfterRender = () => useUi.setState({ fitPending: true });
export const requestFit = () => {
  easeView('view');
  useUi.setState((s) => ({ fitRequest: s.fitRequest + 1 }));
};
export const toast = (msg: string) => {
  useUi.setState({ toast: msg });
  setTimeout(() => useUi.getState().toast === msg && useUi.setState({ toast: null }), 3500);
};

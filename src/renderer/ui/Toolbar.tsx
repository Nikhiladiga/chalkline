import { useEffect, useRef, useState } from 'react';
import { useDoc } from '../doc/store';
import { autoLayoutAll, exportHtml, exportJson, exportPng, exportSvg } from './actions';
import {
  IconExport,
  IconLayout,
  IconMoon,
  IconRedo,
  IconSettings,
  IconSparkle,
  IconSun,
  IconUndo,
} from './icons';
import { useUi } from './uiStore';

const isMac = navigator.userAgent.includes('Mac');

/** The app icon's glyph without its tile: a chalk box, a snapped line, a lavender box. */
function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="9.5" height="9.5" rx="2.6" fill="none" stroke="#f3f1ea" strokeWidth="2.2" />
      <path
        d="M11.5 6.75h0.4a1.1 1.1 0 0 1 1.1 1.1v9.3a1.1 1.1 0 0 0 1.1 1.1h0.4"
        fill="none"
        stroke="#f3f1ea"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <rect x="14.2" y="13.2" width="8.3" height="8.3" rx="2.3" fill="#7581ee" />
    </svg>
  );
}
const mod = isMac ? '⌘' : 'Ctrl+';

/** A button that opens a dropdown; closes on outside click or Escape. */
function Menu({
  label,
  icon,
  children,
  testId,
}: {
  label: string;
  icon: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button
        type="button"
        className={`btn${open ? ' on' : ''}`}
        onClick={() => setOpen(!open)}
        data-testid={testId}
        aria-expanded={open}
      >
        {icon}
        {label}
      </button>
      {open && <div className="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function Toolbar() {
  const filePath = useDoc((s) => s.filePath);
  const dirty = useDoc((s) => s.dirty);
  const canUndo = useDoc((s) => s.past.length > 0);
  const canRedo = useDoc((s) => s.future.length > 0);
  const showAi = useUi((s) => s.showAi);
  const set = useUi((s) => s.set);
  const theme = useUi((s) => s.theme);
  const [transparent, setTransparent] = useState(false);
  const name = filePath?.split(/[\\/]/).pop() ?? 'Untitled';

  return (
    <header className={`toolbar${isMac ? ' mac' : ''}`}>
      <div className="brand">
        <BrandMark />
        Open Eraser
      </div>
      <span className="file-name" title={filePath ?? undefined}>
        {name}
        {dirty && <span className="dot"> — edited</span>}
      </span>
      <div className="sep" />
      <button
        type="button"
        className="btn icon"
        title={`Undo (${mod}Z)`}
        aria-label="Undo"
        disabled={!canUndo}
        onClick={() => useDoc.getState().undo()}
      >
        <IconUndo />
      </button>
      <button
        type="button"
        className="btn icon"
        title={`Redo (${mod}⇧Z)`}
        aria-label="Redo"
        disabled={!canRedo}
        onClick={() => useDoc.getState().redo()}
      >
        <IconRedo />
      </button>
      <button
        type="button"
        className="btn"
        title="Lay out the whole diagram again"
        onClick={() => void autoLayoutAll()}
      >
        <IconLayout />
        Auto-layout
      </button>
      <div className="spacer" />
      <Menu label="Export" icon={<IconExport />} testId="export-menu">
        {(close) => {
          const run = (fn: () => unknown) => () => {
            close();
            fn();
          };
          return (
            <>
              <button
                type="button"
                className="menu-item"
                data-testid="export-png-2x"
                onClick={run(() => exportPng(2, transparent))}
              >
                PNG (2x)<span className="kbd">{mod}E</span>
              </button>
              <button type="button" className="menu-item" onClick={run(() => exportPng(1, transparent))}>
                PNG (1x)
              </button>
              <button
                type="button"
                className="menu-item"
                data-testid="export-svg"
                onClick={run(() => exportSvg(!transparent))}
              >
                SVG<span className="kbd">{mod}⇧E</span>
              </button>
              <button type="button" className="menu-item" onClick={run(exportHtml)}>
                HTML page
              </button>
              <button type="button" className="menu-item" onClick={run(exportJson)}>
                Measured JSON
              </button>
              <div className="menu-sep" />
              <button
                type="button"
                className="menu-item"
                onClick={run(() => exportPng(2, transparent, true))}
              >
                Copy PNG to clipboard
              </button>
              <label className="menu-check">
                <input
                  type="checkbox"
                  checked={transparent}
                  onChange={(e) => setTransparent(e.target.checked)}
                />
                Transparent background
              </label>
            </>
          );
        }}
      </Menu>
      <button
        type="button"
        className="btn icon"
        data-testid="theme-toggle"
        title={theme === 'dark' ? 'Switch the diagram to light' : 'Switch the diagram to dark'}
        aria-label="Toggle diagram theme"
        onClick={async () => {
          const next = theme === 'dark' ? 'light' : 'dark';
          set({ theme: next });
          await window.api.invoke('settings:set', { theme: next });
        }}
      >
        {theme === 'dark' ? <IconMoon /> : <IconSun />}
      </button>
      <button
        type="button"
        className={`btn${showAi ? ' on' : ''}`}
        onClick={() => set({ showAi: !showAi })}
        aria-label="Toggle AI panel"
      >
        <IconSparkle />
        AI
      </button>
      <button
        type="button"
        className="btn icon"
        title="Settings"
        aria-label="Settings"
        onClick={() => set({ settingsOpen: true })}
      >
        <IconSettings />
      </button>
    </header>
  );
}

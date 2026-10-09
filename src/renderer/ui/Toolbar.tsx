import { useState } from 'react';
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
import { Menu } from './Menu';
import { isMac, mod } from './platform';
import { useUi } from './uiStore';

/** The app icon's glyph without its tile: a chalk box, a snapped line, a lavender box. */
function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="2"
        y="2"
        width="9.5"
        height="9.5"
        rx="2.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <path
        d="M11.5 6.75h0.4a1.1 1.1 0 0 1 1.1 1.1v9.3a1.1 1.1 0 0 0 1.1 1.1h0.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <rect x="14.2" y="13.2" width="8.3" height="8.3" rx="2.3" fill="#7581ee" />
    </svg>
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
        Chalkline
      </div>
      <span className="file-name" title={filePath ?? undefined}>
        <span className="file-title">{name}</span>
        {dirty && (
          <span className="dirty-dot">
            <span className="sr-only"> — edited</span>
          </span>
        )}
      </span>
      <div className="sep" />
      <button
        type="button"
        className="btn icon"
        data-tip="Undo"
        data-kbd={`${mod}Z`}
        aria-label="Undo"
        disabled={!canUndo}
        onClick={() => useDoc.getState().undo()}
      >
        <IconUndo />
      </button>
      <button
        type="button"
        className="btn icon"
        data-tip="Redo"
        data-kbd={`${mod}⇧Z`}
        aria-label="Redo"
        disabled={!canRedo}
        onClick={() => useDoc.getState().redo()}
      >
        <IconRedo />
      </button>
      <div className="sep" />
      <button
        type="button"
        className="btn"
        data-tip="Lay out the whole diagram again"
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
                role="menuitem"
                className="menu-item"
                data-testid="export-png-2x"
                onClick={run(() => exportPng(2, transparent))}
              >
                PNG (2x)<span className="kbd">{mod}E</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={run(() => exportPng(1, transparent))}
              >
                PNG (1x)
              </button>
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                data-testid="export-svg"
                onClick={run(() => exportSvg(!transparent))}
              >
                SVG<span className="kbd">{mod}⇧E</span>
              </button>
              <button type="button" role="menuitem" className="menu-item" onClick={run(exportHtml)}>
                HTML page
              </button>
              <button type="button" role="menuitem" className="menu-item" onClick={run(exportJson)}>
                Measured JSON
              </button>
              <hr className="menu-sep" />
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={run(() => exportPng(2, transparent, true))}
              >
                Copy PNG to clipboard
              </button>
              <label className="menu-check">
                <input
                  type="checkbox"
                  role="menuitemcheckbox"
                  aria-checked={transparent}
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
        data-tip={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        aria-label="Toggle light and dark theme"
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
        className="btn"
        aria-pressed={showAi}
        onClick={() => set({ showAi: !showAi })}
        aria-label="Toggle AI panel"
      >
        <IconSparkle />
        AI
      </button>
      <button
        type="button"
        className="btn icon"
        data-tip="Settings"
        aria-label="Settings"
        onClick={() => set({ settingsOpen: true })}
      >
        <IconSettings />
      </button>
    </header>
  );
}

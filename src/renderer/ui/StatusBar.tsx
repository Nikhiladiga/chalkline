import { useDoc } from '../doc/store';
import { Menu } from './Menu';
import { isMac, mod } from './platform';
import { useUi } from './uiStore';

// Labels must never be exactly "Fit": three e2e specs click getByText('Fit', { exact: true }).
const SHORTCUTS: [string, string][] = [
  ['Undo', `${mod}Z`],
  ['Redo', `${mod}⇧Z`],
  ['Copy / cut / paste', `${mod}C / ${mod}X / ${mod}V`],
  ['Duplicate selection', `${mod}D`],
  ['Drop a copy while dragging', isMac ? '⌥-drag' : 'Alt-drag'],
  ['Drag without snapping', `${mod}-drag`],
  ['Move along one axis', isMac ? '⇧-drag' : 'Shift-drag'],
  ['Reconnect a line', 'Drag its end handle'],
  ['Select all', `${mod}A`],
  ['Delete selection', '⌫'],
  ['Nudge selection (Shift for 10px)', 'Arrow keys'],
  ['Fit diagram to view', '⇧1'],
  ['Toggle the left pane', '['],
  ['Toggle the details pane', ']'],
  ['Open settings', `${mod},`],
  ['New tab', `${mod}T`],
  ['Close tab', `${mod}W`],
  ['Next / previous tab', isMac ? '⌃Tab / ⌃⇧Tab' : 'Ctrl+Tab / Ctrl+Shift+Tab'],
  ['Go to tab 1–8 / last tab', `${mod}1–8 / ${mod}9`],
  ['Generate or apply from the prompt', `${mod}↵`],
  ['Pan', 'Space-drag'],
  ['Zoom', `${mod}-scroll`],
  ['Edit text', 'Double-click'],
  ['Show shortcuts', '?'],
];

export function StatusBar() {
  const r = useUi((s) => s.render);
  const errors = useUi((s) => s.errors);
  const warnings = useUi((s) => s.warnings);
  const count = useDoc((s) => s.doc.entities.length);
  return (
    <footer className="status">
      <span className={errors.length ? 'bad' : 'ok'}>
        {errors.length ? `${errors.length} error${errors.length > 1 ? 's' : ''}` : 'Valid'}
        {warnings.length ? `, ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : ''}
      </span>
      <span>
        {count} element{count === 1 ? '' : 's'}
      </span>
      {r && <span>Rendered in {r.ms} ms</span>}
      <span className="grow" />
      <Menu label="Shortcuts" testId="shortcuts-menu" chevron={false}>
        {() =>
          SHORTCUTS.map(([what, keys]) => (
            <button
              key={what}
              type="button"
              role="menuitem"
              aria-disabled="true"
              tabIndex={-1}
              className="menu-item static"
            >
              {what}
              <span className="kbd">{keys}</span>
            </button>
          ))
        }
      </Menu>
    </footer>
  );
}

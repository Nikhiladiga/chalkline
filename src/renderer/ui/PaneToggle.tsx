import { IconPanelLeft, IconPanelRight } from './icons';
import { setPane, useUi } from './uiStore';

/** Collapse or expand a side pane (see `setPane`). */
export function togglePane(side: 'left' | 'right'): void {
  const ui = useUi.getState();
  setPane(side, !(side === 'left' ? ui.showCode : ui.showAi));
}

export function PaneToggle({ side, open }: { side: 'left' | 'right'; open: boolean }) {
  const mode = useUi((s) => s.leftMode);
  const name = side === 'left' ? `${mode} pane` : 'details pane';
  const Icon = side === 'left' ? IconPanelLeft : IconPanelRight;
  const label = `${open ? 'Hide' : 'Show'} ${name}`;
  return (
    <button
      type="button"
      className={open ? 'btn icon' : 'rail'}
      data-tip={open ? label : undefined}
      data-kbd={open ? (side === 'left' ? '[' : ']') : undefined}
      aria-keyshortcuts={open ? (side === 'left' ? '[' : ']') : undefined}
      aria-label={label}
      data-testid={`toggle-${side}`}
      onClick={() => togglePane(side)}
    >
      <Icon />
      {!open && <span>{side === 'left' ? (mode === 'icons' ? 'Icons' : 'Code') : 'Details'}</span>}
    </button>
  );
}

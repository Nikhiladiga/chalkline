import { IconPanelLeft, IconPanelRight } from './icons';
import { easeView, useUi } from './uiStore';

/**
 * Collapse or expand a side pane. The left pane moves the board's left edge, so pan shifts by the
 * same amount, with the same easing as the column, and the diagram stays put on screen.
 */
export function togglePane(side: 'left' | 'right'): void {
  const ui = useUi.getState();
  if (side === 'right') {
    ui.set({ showAi: !ui.showAi });
    return;
  }
  const ws = document.querySelector('.workspace');
  const css = ws ? getComputedStyle(ws) : null;
  const delta =
    (css
      ? Number.parseFloat(css.getPropertyValue('--code-open')) -
        Number.parseFloat(css.getPropertyValue('--rail'))
      : 0) || 0;
  easeView('pane');
  ui.set({ showCode: !ui.showCode, pan: { x: ui.pan.x + (ui.showCode ? delta : -delta), y: ui.pan.y } });
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
      aria-label={label}
      data-testid={`toggle-${side}`}
      onClick={() => togglePane(side)}
    >
      <Icon />
      {!open && <span>{side === 'left' ? (mode === 'icons' ? 'Icons' : 'Code') : 'Details'}</span>}
    </button>
  );
}

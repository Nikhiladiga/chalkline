import { IconPanelLeft, IconPanelRight } from './icons';
import { useUi } from './uiStore';

export function PaneToggle({ side, open }: { side: 'left' | 'right'; open: boolean }) {
  const mode = useUi((s) => s.leftMode);
  const key = side === 'left' ? 'showCode' : 'showAi';
  const name = side === 'left' ? `${mode} pane` : 'details pane';
  const Icon = side === 'left' ? IconPanelLeft : IconPanelRight;
  const label = `${open ? 'Hide' : 'Show'} ${name}`;
  return (
    <button
      type="button"
      className={open ? 'btn icon' : 'rail'}
      title={label}
      aria-label={label}
      data-testid={`toggle-${side}`}
      onClick={() => useUi.getState().set({ [key]: !open })}
    >
      <Icon />
      {!open && <span>{side === 'left' ? (mode === 'icons' ? 'Icons' : 'Code') : 'Details'}</span>}
    </button>
  );
}

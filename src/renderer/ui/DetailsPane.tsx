import { useTabs } from '../doc/store';
import { AiPanel } from './AiPanel';
import { Inspector } from './Inspector';
import { PaneToggle } from './PaneToggle';
import { useUi } from './uiStore';

/**
 * The right pane. It stays mounted when collapsed, so the AI panel keeps its prompt and running job.
 * The inspector scrolls on its own and the AI composer stays pinned at the bottom.
 */
export function DetailsPane() {
  const activeId = useTabs((s) => s.activeId);
  const open = useUi((s) => s.showAi);
  return (
    <aside className="pane right" aria-label="Inspector and AI">
      <div className="pane-head" hidden={!open}>
        Details
        <span className="spacer" />
        {open && <PaneToggle side="right" open />}
      </div>
      <div className="pane-body details" hidden={!open}>
        <div className="details-scroll">
          <Inspector key={activeId} />
        </div>
        <div className="composer">
          <AiPanel />
        </div>
      </div>
      {!open && <PaneToggle side="right" open={false} />}
    </aside>
  );
}

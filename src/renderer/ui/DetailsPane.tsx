import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTabs } from '../doc/store';
import { AiPanel } from './AiPanel';
import { refreshModels } from './aiSettings';
import { Inspector } from './Inspector';
import { PaneToggle } from './PaneToggle';
import { useUi } from './uiStore';

/**
 * The right pane. It stays mounted when collapsed, so every tab's AI panel keeps its prompt and running
 * job; only the active tab's panel shows. The inspector scrolls on its own and the composer stays pinned.
 */
export function DetailsPane() {
  const open = useUi((s) => s.showAi);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const ids = useTabs(useShallow((s) => s.tabs.map((t) => t.id)));
  const activeId = useTabs((s) => s.activeId);
  // One model list for every tab: load it on start and again whenever Settings closes.
  useEffect(() => {
    if (!settingsOpen) void refreshModels();
  }, [settingsOpen]);
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
          {ids.map((id) => (
            <AiPanel key={id} tabId={id} visible={id === activeId} />
          ))}
        </div>
      </div>
      {!open && <PaneToggle side="right" open={false} />}
    </aside>
  );
}

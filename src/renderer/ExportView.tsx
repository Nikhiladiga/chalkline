import { render } from './engine/engine';
import { applyTheme, groundOf, type Theme } from './engine/theme';
import { SHEET_PAD } from './engine/types';

/** Hidden export window: render the requested document at natural size at the page origin. */
export function startExportView(): void {
  document.body.style.margin = '0';
  document.documentElement.style.colorScheme = 'light';
  window.api.on(
    'export:render',
    async ({ doc, transparent, theme }: { doc: any; transparent: boolean; theme: Theme }) => {
      document.body.style.background = transparent ? 'transparent' : groundOf(theme);
      document.documentElement.style.background = transparent ? 'transparent' : groundOf(theme);
      try {
        const r = await render(applyTheme(doc, theme));
        if (!r.ok) return window.api.exportReady({ error: r.errors[0]?.message ?? 'render failed' });
        r.scene.style.position = 'absolute';
        r.scene.style.left = `${SHEET_PAD - r.bounds.x}px`;
        r.scene.style.top = `${SHEET_PAD - r.bounds.y}px`;
        await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
        window.api.exportReady({
          width: r.bounds.width + 2 * SHEET_PAD,
          height: r.bounds.height + 2 * SHEET_PAD,
        });
      } catch (e) {
        window.api.exportReady({ error: (e as Error).message });
      }
    },
  );
}

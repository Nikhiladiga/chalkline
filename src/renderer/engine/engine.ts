// Side effect: attaches window.__eraser (the in-page render pipeline).
import '@eraserlabs/render/browser';
import { buildRenderPageSetup } from '@eraserlabs/diagram-templates';
import { stockNormalizers } from '@eraserlabs/diagram-templates/normalizers';
import { normalizeFetchedIcon } from '@eraserlabs/diagram-templates/svg-transforms';
import type { ConnectionGeometry } from '@eraserlabs/render';
import { buildFontsHead, createResolver, type Resolver } from '@eraserlabs/resolve';
import inter from '@fonts/Inter.var.woff2?inline';
import mono from '@fonts/JetBrainsMono-Regular.woff2?inline';
import shantell from '@fonts/ShantellSans.var.woff2?inline';
import { routeAnchors } from './anchors';
import { diagramLibrary } from './library';
import { type MeasuredDoc, toDiagramJson } from './measured';
import { monoToCurrentColor } from './theme';
import type { Box, Doc, Issue } from './types';

export interface RenderOk {
  ok: true;
  /** The live `#eraser-scene` element; callers move it where they want it shown. */
  scene: HTMLElement;
  boxes: Record<string, Box>;
  /** Doc-space box of everything each entity paints: its box plus text that spills out of it,
   *  e.g. an icon's caption. Use it for overlap checks and layout. */
  painted: Record<string, Box>;
  connections: Record<string, ConnectionGeometry>;
  /** Doc coordinates of the scene element's top-left corner. */
  origin: { x: number; y: number };
  size: { width: number; height: number };
  /** Painted extent in scene-local px: the scene box grown by text that spills out of its box
   *  (e.g. a caption word with no spaces). x/y may be negative. Use it to size sheets and exports. */
  bounds: Box;
  measured: MeasuredDoc;
  /** Resolved connection ids in document order. */
  connectionIds: string[];
  warnings: Issue[];
  ms: number;
}
export interface RenderFail {
  ok: false;
  errors: Issue[];
  warnings: Issue[];
  stale?: boolean;
}

const ICON_NAME = /^[a-z0-9][a-z0-9-]*$/;

async function loadIcon(name: string): Promise<string> {
  if (!ICON_NAME.test(name)) throw new Error(`invalid icon name "${name}"`);
  const res = await fetch(`icons://i/${name}.svg`);
  if (!res.ok) throw new Error(`icon "${name}": HTTP ${res.status}`);
  return monoToCurrentColor(normalizeFetchedIcon(await res.text(), name));
}

let resolverPromise: Promise<Resolver> | undefined;
export function getResolver(): Promise<Resolver> {
  resolverPromise ??= createResolver({
    library: diagramLibrary,
    normalizers: stockNormalizers,
    iconLoader: loadIcon,
    onUnknownIcon: 'placeholder',
  });
  return resolverPromise;
}

/** Font CSS with the woff2 bytes inlined, so serialized exports are self-contained. */
export const fontConfig = {
  roles: { rough: 'ShantellSans', clean: 'Inter', mono: 'JetBrainsMono' },
  fallbacks: { rough: 'sans-serif', clean: 'sans-serif', mono: 'monospace' },
  faces: [
    { kind: 'url' as const, family: 'ShantellSans', url: shantell, format: 'woff2', weight: '300 800' },
    { kind: 'url' as const, family: 'Inter', url: inter, format: 'woff2', weight: '100 900' },
    { kind: 'url' as const, family: 'JetBrainsMono', url: mono, format: 'woff2' },
  ],
};

let ready: Promise<void> | undefined;
function setup(): Promise<void> {
  ready ??= (async () => {
    const resolver = await getResolver();
    window.__eraser.setup(buildRenderPageSetup(resolver.library));
    await window.__eraser.registerFonts({
      css: buildFontsHead(fontConfig),
      faces: [],
      urlFaces: fontConfig.faces.map((f) => ({ family: f.family })),
    });
  })();
  return ready;
}

export async function validate(doc: unknown): Promise<{ ok: boolean; errors: Issue[]; warnings: Issue[] }> {
  return (await getResolver()).validate(doc);
}

export async function tagSchema(tag: string): Promise<any> {
  return (await getResolver()).tagSchema(tag);
}

/**
 * Time budget (ms) for the corridor router's repair search, on every render. Upstream hard-codes Infinity,
 * which cost 0.5–4 s per render on large diagrams; our pnpm patch of @eraserlabs/render makes it a run()
 * option. At 50 ms the drag-perf fixture renders in ~140 ms with routes as clean as unbounded ones (see
 * e2e/drag-perf.spec.ts, which also guards it). A calibration knob, not a constant of nature.
 */
export const REPAIR_BUDGET_MS = 50;

// run() owns one global #eraser-scene, so renders must not overlap: chain them, and let only the
// newest queued request actually run.
let chain: Promise<unknown> = Promise.resolve();
let seq = 0;

/** `repairTimeBudgetMs` overrides REPAIR_BUDGET_MS (tests draw an unbounded reference with Infinity). */
export function render(doc: Doc, opts: { repairTimeBudgetMs?: number } = {}): Promise<RenderOk | RenderFail> {
  const repairTimeBudgetMs = opts.repairTimeBudgetMs ?? REPAIR_BUDGET_MS;
  const mine = ++seq;
  const job = chain.then(async (): Promise<RenderOk | RenderFail> => {
    if (mine !== seq) return { ok: false, errors: [], warnings: [], stale: true };
    const t0 = performance.now();
    await setup();
    const resolver = await getResolver();
    const r = await resolver.resolve(doc);
    if (!r.ok) return { ok: false, errors: r.errors, warnings: r.warnings };
    let run = await window.__eraser.run({
      entities: r.entities ?? [],
      connections: r.connections ?? [],
      icons: r.icons ?? {},
      repairTimeBudgetMs,
    });
    const anchored = routeAnchors(r.entities ?? [], r.connections ?? [], run.layout);
    if (anchored !== r.connections && anchored.some((c) => c.props.fromPort && c.props.toPort)) {
      run = await window.__eraser.run({
        entities: r.entities ?? [],
        connections: anchored,
        icons: r.icons ?? {},
        repairTimeBudgetMs,
      });
    }
    const scene = document.getElementById('eraser-scene')!;
    const boxes = run.layout.boxes;
    // apply.ts positions wrappers at box - sceneOrigin; read the origin back from any entity.
    let origin = { x: 0, y: 0 };
    for (const w of scene.querySelectorAll<HTMLElement>('[data-mdp-id]')) {
      const b = boxes[w.dataset.mdpId!];
      if (b && w.style.left) {
        origin = { x: b.x - parseFloat(w.style.left), y: b.y - parseFloat(w.style.top) };
        break;
      }
    }
    return {
      ok: true,
      scene,
      boxes,
      painted: paintedBoxes(scene, boxes, origin),
      connections: run.layout.connections,
      origin,
      size: { width: parseFloat(scene.style.width), height: parseFloat(scene.style.height) },
      bounds: paintedBounds(scene),
      measured: toDiagramJson(r.authored ?? [], run.layout),
      connectionIds: (r.connections ?? []).map((c) => c.id),
      warnings: r.warnings,
      ms: Math.round(performance.now() - t0),
    };
  });
  chain = job.catch(() => undefined);
  return job;
}

/** Each entity's box united with the rects of the text inside its wrapper, in doc coordinates. */
function paintedBoxes(
  scene: HTMLElement,
  boxes: Record<string, Box>,
  origin: { x: number; y: number },
): Record<string, Box> {
  const base = scene.getBoundingClientRect();
  // The scene may sit under the canvas zoom transform: convert screen px back to scene px.
  const k = base.width / (parseFloat(scene.style.width) || base.width) || 1;
  const out: Record<string, Box> = { ...boxes };
  const range = document.createRange();
  for (const w of scene.querySelectorAll<HTMLElement>('[data-mdp-id]')) {
    const id = w.dataset.mdpId!;
    const b = boxes[id];
    if (!b) continue;
    let [l, t, r, btm] = [b.x, b.y, b.x + b.width, b.y + b.height];
    const walk = document.createTreeWalker(w, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      // Skip text that belongs to a nested entity (it gets its own footprint).
      if ((walk.currentNode.parentElement?.closest('[data-mdp-id]') as HTMLElement | null) !== w) continue;
      range.selectNodeContents(walk.currentNode);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      const x = (rect.left - base.left) / k + origin.x;
      const y = (rect.top - base.top) / k + origin.y;
      l = Math.min(l, x);
      t = Math.min(t, y);
      r = Math.max(r, x + rect.width / k);
      btm = Math.max(btm, y + rect.height / k);
    }
    out[id] = {
      x: Math.floor(l),
      y: Math.floor(t),
      width: Math.ceil(r - Math.floor(l)),
      height: Math.ceil(btm - Math.floor(t)),
    };
  }
  return out;
}

/** Scene box united with every text run's rendered rect (measured before any CSS transform). */
function paintedBounds(scene: HTMLElement): Box {
  const base = scene.getBoundingClientRect();
  let [l, t, r, b] = [0, 0, base.width, base.height];
  const range = document.createRange();
  const walk = document.createTreeWalker(scene, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) {
    range.selectNodeContents(walk.currentNode);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) continue;
    l = Math.min(l, rect.left - base.left);
    t = Math.min(t, rect.top - base.top);
    r = Math.max(r, rect.right - base.left);
    b = Math.max(b, rect.bottom - base.top);
  }
  return {
    x: Math.floor(l),
    y: Math.floor(t),
    width: Math.ceil(r - Math.floor(l)),
    height: Math.ceil(b - Math.floor(t)),
  };
}

export function serialize(): { scene: string; css: string } {
  return window.__eraser.serialize();
}

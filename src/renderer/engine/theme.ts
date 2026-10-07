import type { Doc, Entity } from './types';

export type Theme = 'dark' | 'light';

/** Eraser-like dark canvas. */
export const DARK = {
  ground: '#161618',
  surface: '#1f2023',
  border: '#4b4d52',
  ink: '#ececec',
  line: '#d4d4d4',
};

/** Palette token → dark [body, border, title chip]: same hue, low luminance. */
export const TINTS: Record<string, [string, string, string]> = {
  blue: ['#121c2e', '#3d6bb3', '#1d3157'],
  green: ['#10221a', '#3f9a63', '#183a29'],
  purple: ['#1d1630', '#8b6cf0', '#2f2450'],
  red: ['#2a1416', '#d9534f', '#45201f'],
  orange: ['#2a1c10', '#e08a3c', '#47301a'],
  yellow: ['#28230f', '#d4b13c', '#433a17'],
};

type Run = { text: string; color?: string; typeface?: string };
/** Eraser's hand-drawn face (Shantell Sans), the eraser.io look. */
const ROUGH = 'rough';
// Tags whose schema takes an element-level typeface (others take it per run or on the title).
const TYPEFACE_TAGS = new Set([
  'Icon',
  'Textbox',
  'Activity',
  'Event',
  'Gateway',
  'Divider',
  'DatabaseTable',
]);
const SURFACE_TAGS = new Set(['Shape', 'Activity', 'Event', 'Gateway']);
const CONTAINERS = new Set(['Group', 'Lane', 'Pool']);
const INK_TAGS = new Set(['Icon', 'Textbox']);
const SHADOWED = new Set(['Shape', 'Group', 'Lane', 'Pool', 'DatabaseTable']);

/** Runs without their own color get the theme ink. */
const inkRuns = (runs: unknown): Run[] | undefined =>
  Array.isArray(runs) ? runs.map((r: Run) => (r.color ? r : { ...r, color: DARK.ink })) : undefined;
const roughRuns = (runs: unknown): Run[] | undefined =>
  Array.isArray(runs) ? runs.map((r: Run) => (r.typeface ? r : { ...r, typeface: ROUGH })) : undefined;

function darkEntity(e: Entity): Entity {
  const out: Entity = { ...e };
  // The stock hard #e8e8e8 offset shadow reads as a glitch on a dark ground.
  if (SHADOWED.has(e.tag) && e.styleMode === undefined) out.styleMode = 'plain';
  if (INK_TAGS.has(e.tag) && e.color === undefined) {
    out.color = DARK.ink;
    const runs = inkRuns(e.texts);
    if (runs) out.texts = runs;
  }
  const tint = typeof e.color === 'string' ? TINTS[e.color] : undefined;
  // A color outside the palette (gray, black, #888…) keeps a dark body and moves to the border.
  const edge = tint?.[1] ?? (typeof e.color === 'string' ? e.color : DARK.border);
  const darkBody = e.bgColor === undefined;
  if (SURFACE_TAGS.has(e.tag) && darkBody) {
    out.bgColor = tint?.[0] ?? DARK.surface;
    out.borderColor ??= edge;
    const runs = inkRuns(e.texts);
    if (runs) out.texts = runs;
  }
  if (CONTAINERS.has(e.tag) && darkBody) {
    out.bgColor = tint?.[0] ?? DARK.ground;
    out.borderColor ??= edge;
    if (e.title && typeof e.title === 'object') {
      const t = e.title as Record<string, unknown>;
      out.title = { ...t, color: t.color ?? DARK.ink, bgColor: t.bgColor ?? tint?.[2] ?? DARK.surface };
    }
  }
  if (e.tag === 'Divider' && e.color === undefined) out.color = DARK.border;
  if (TYPEFACE_TAGS.has(e.tag)) out.typeface ??= ROUGH;
  const runs = roughRuns(out.texts);
  if (runs) out.texts = runs;
  if (out.title && typeof out.title === 'object') {
    const t = out.title as Record<string, unknown>;
    out.title = { ...t, typeface: t.typeface ?? ROUGH };
  }
  return out;
}

/**
 * Render-time theming: fill in theme colors only where the author left them unset, so the
 * stored document stays theme-free and authored colors always win. Light = the stock look.
 */
export function applyTheme(doc: Doc, theme: Theme): Doc {
  if (theme === 'light') return doc;
  return {
    ...doc,
    entities: doc.entities.map(darkEntity),
    connections: doc.connections.map((c) => ({
      ...c,
      color: c.color ?? DARK.line,
      typeface: c.typeface ?? ROUGH,
    })),
  };
}

export const groundOf = (theme: Theme) => (theme === 'dark' ? DARK.ground : '#ffffff');

const PAINT = /\b(?:fill|stroke)\s*[=:]\s*["']?\s*([^"';>\s]+)/gi;
const BLACK = /^(?:black|#000|#000000|#000000ff|#111|#111111|#222|#222222|#231f20|#242424)$/i;
const NEUTRAL = /^(?:none|currentcolor|transparent|inherit)$/i;

/**
 * One-color logos (no paint at all, or only black) are recolored to currentColor so the glyph
 * follows the theme ink: white on the dark canvas, near-black on light. Colored logos stay as-is.
 */
export function monoToCurrentColor(svg: string): string {
  const paints = [...svg.matchAll(PAINT)].map((m) => m[1]!);
  if (!paints.every((p) => BLACK.test(p) || NEUTRAL.test(p))) return svg;
  const out = svg.replace(PAINT, (m, p: string) => (BLACK.test(p) ? m.replace(p, 'currentColor') : m));
  return /<svg\b[^>]*\sfill\s*=/i.test(out) ? out : out.replace(/<svg\b/i, '<svg fill="currentColor"');
}

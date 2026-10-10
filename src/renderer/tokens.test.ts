import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// WCAG 2.2 floors for the chrome tokens: text 4.5:1; focus/state lines and status marks 3:1.
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function tokens(theme: 'dark' | 'light'): Record<string, string> {
  const body = new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const SURFACES = ['canvas', 's1', 's2', 's3', 's4', 'board'];

describe.each(['dark', 'light'] as const)('%s theme tokens', (theme) => {
  const t = tokens(theme);
  const hex = (name: string) => {
    const v = t[name];
    if (!v || !/^#[0-9a-f]{6}$/i.test(v))
      throw new Error(`--${name} must be a 6-digit hex in the ${theme} block, got ${v}`);
    return v;
  };
  const pairs: [string, string[], number][] = [
    ['ink', SURFACES, 4.5],
    ['ink-muted', SURFACES, 4.5],
    ['ink-subtle', SURFACES, 4.5],
    ['ink-tertiary', ['s1', 's2'], 4.5], // gutter and placeholders only
    ['syn-prop', ['s1'], 4.5],
    ['syn-num', ['s1'], 4.5],
    ['syn-punct', ['s1'], 4.5],
    ['line', SURFACES, 3], // focus ring, selection, chalk line
    ['success', ['canvas', 's1', 's2'], 3],
    ['danger', ['canvas', 's1', 's2', 's4'], 3],
  ];
  it.each(pairs)('--%s on %j', (fg, bgs, floor) => {
    for (const bg of bgs)
      expect(contrast(hex(fg), hex(bg)), `--${fg} on --${bg}`).toBeGreaterThanOrEqual(floor);
  });
  it.each(['accent', 'accent-hover', 'accent-press'])('white text on --%s', (bg) => {
    expect(contrast('#ffffff', hex(bg))).toBeGreaterThanOrEqual(4.5);
  });
});

// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { toSvg } from './svg';
import { SHEET_PAD } from './types';

const scene =
  '<div id="eraser-scene" style="width:200px;height:100px"><div data-mdp-id="a">A &amp; B<br><img src="data:x"></div><svg viewBox="0 0 10 10"><path d="M0 0"/></svg></div>';

describe('toSvg', () => {
  const out = toSvg(
    { scene, css: '@font-face{font-family:Inter;src:url(data:font/woff2;base64,AAA)}' },
    { x: 0, y: 0, width: 200, height: 100 },
  );

  it('is well-formed XML sized to the scene plus a margin on every side', () => {
    const doc = new DOMParser().parseFromString(out, 'image/svg+xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    const root = doc.documentElement;
    expect(root.getAttribute('width')).toBe(String(200 + 2 * SHEET_PAD));
    expect(root.getAttribute('height')).toBe(String(100 + 2 * SHEET_PAD));
    expect(out).toContain(`left:${SHEET_PAD}px;top:${SHEET_PAD}px`);
  });

  it('wraps the scene as XHTML inside a foreignObject with the styles', () => {
    expect(out).toContain('<foreignObject');
    expect(out).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(out).toContain('data:font/woff2;base64,AAA');
    expect(out).toContain('A &amp; B');
    expect(out).toMatch(/<br\s*\/>/);
  });

  it('shifts the scene right/down when text spills past its top-left edge', () => {
    const svg = toSvg({ scene, css: '' }, { x: -20, y: -5, width: 240, height: 110 });
    expect(svg).toContain(`width="${240 + 2 * SHEET_PAD}"`);
    expect(svg).toContain(`left:${SHEET_PAD + 20}px;top:${SHEET_PAD + 5}px`);
  });

  it('drops HTML comments, which may hold "--" (invalid in XML)', () => {
    const svg = toSvg(
      { scene: '<div><!-- arrow: a -- b --><svg><!-- x--y --><path d="M0 0"/></svg></div>', css: '' },
      { x: 0, y: 0, width: 1, height: 1 },
    );
    expect(svg).not.toContain('<!--');
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  });

  it('can add a white background', () => {
    expect(toSvg({ scene, css: '' }, { x: 0, y: 0, width: 1, height: 1 }, '#161618')).toContain(
      'fill="#161618"',
    );
  });
});

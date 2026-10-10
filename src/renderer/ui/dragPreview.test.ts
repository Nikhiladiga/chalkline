// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Doc } from '../engine/types';
import { clearPreview, type PreviewTarget, showPreview } from './dragPreview';

const doc: Doc = {
  entities: [
    { tag: 'Icon', id: 'a', x: 0, y: 0 },
    { tag: 'Icon', id: 'b', x: 200, y: 0 },
    { tag: 'Icon', id: 'c', x: 400, y: 0 },
  ],
  connections: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ],
};
let t: PreviewTarget;
beforeEach(() => {
  document.body.innerHTML = `
    <div id="eraser-scene">
      <div data-mdp-id="a"></div><div data-mdp-id="b"></div><div data-mdp-id="c"></div>
      <div data-mdp-id="k1"></div><div data-mdp-id="k2"></div>
    </div>
    <div class="overlay"><div class="hit" data-id="a"></div><div class="hit" data-id="b"></div><div class="hit" data-id="c"></div></div>
    <svg class="preview-svg"></svg>`;
  t = {
    scene: document.getElementById('eraser-scene')!,
    overlay: document.querySelector('.overlay'),
    lines: document.querySelector('svg'),
    doc,
    connectionIds: ['k1', 'k2'],
    geometry: {
      k1: {
        points: [
          [50, 25],
          [200, 25],
        ],
      },
      k2: {
        points: [
          [250, 25],
          [400, 25],
        ],
      },
    },
    zoom: 0.5,
  };
});
const el = (sel: string) => document.querySelector<HTMLElement>(sel)!;

describe('drag preview', () => {
  it('moves the dragged entities and their inner connections, and swaps incident ones for lines', () => {
    showPreview(t, { moving: new Set(['a', 'b']), dx: 10, dy: 5, copy: false });
    for (const sel of ['[data-mdp-id="a"]', '[data-mdp-id="b"]', '[data-mdp-id="k1"]', '.hit[data-id="a"]'])
      expect(el(sel).style.transform).toBe('translate(10px, 5px)');
    expect(el('[data-mdp-id="c"]').style.transform).toBe('');
    expect(el('[data-mdp-id="k2"]').style.visibility).toBe('hidden');
    const line = el('.preview-line');
    expect(line.dataset.connId).toBe('k2');
    expect([line.getAttribute('x1'), line.getAttribute('y1'), line.getAttribute('x2')]).toEqual([
      '260',
      '30',
      '400',
    ]);
    expect(line.getAttribute('stroke-width')).toBe('4');
  });

  it('redraws from scratch and clears completely', () => {
    showPreview(t, { moving: new Set(['a', 'b']), dx: 10, dy: 5, copy: false });
    showPreview(t, { moving: new Set(['c']), dx: 1, dy: 1, copy: false });
    expect(el('[data-mdp-id="a"]').style.transform).toBe('');
    expect(el('[data-mdp-id="k2"]').style.visibility).toBe('hidden');
    expect(document.querySelectorAll('.preview-line')).toHaveLength(1);
    clearPreview(t.scene, t.overlay, t.lines);
    expect(document.querySelectorAll('[data-preview], .preview-line')).toHaveLength(0);
    expect(el('[data-mdp-id="c"]').style.transform).toBe('');
    expect(el('[data-mdp-id="k2"]').style.visibility).toBe('');
  });

  it('copy mode leaves the originals and moves clones that clearing removes', () => {
    showPreview(t, { moving: new Set(['a', 'b']), dx: 30, dy: 0, copy: true });
    const clones = document.querySelectorAll<HTMLElement>('[data-preview-clone]');
    expect(clones).toHaveLength(3); // a, b and the a → b connection
    expect([...clones].every((c) => c.style.transform === 'translate(30px, 0px)' && !c.dataset.mdpId)).toBe(
      true,
    );
    expect(el('[data-mdp-id="a"]').style.transform).toBe('');
    expect(el('.hit[data-id="a"]').style.transform).toBe('');
    expect(el('[data-mdp-id="k2"]').style.visibility).toBe('');
    expect(document.querySelectorAll('.preview-line')).toHaveLength(0);
    clearPreview(t.scene, t.overlay, t.lines);
    expect(document.querySelectorAll('[data-preview-clone]')).toHaveLength(0);
  });
});

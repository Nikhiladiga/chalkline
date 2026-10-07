import { readdirSync, readFileSync } from 'node:fs';
import { stockLibrary } from '@eraserlabs/diagram-templates';
import { stockNormalizers } from '@eraserlabs/diagram-templates/normalizers';
import { createResolver } from '@eraserlabs/resolve';
import { describe, expect, it } from 'vitest';
import { toSplit } from '../ai/parse';
import { applyTheme, DARK, monoToCurrentColor, TINTS } from './theme';
import type { Doc } from './types';

const doc: Doc = {
  entities: [
    { tag: 'Group', id: 'g', x: 0, y: 0, width: 300, height: 200, title: { text: 'VPC' } },
    { tag: 'Icon', id: 'i', x: 20, y: 60, icon: 'user', containerId: 'g', texts: [{ text: 'Users' }] },
    { tag: 'Shape', id: 's', x: 120, y: 60, texts: [{ text: 'API' }, { text: 'detail', color: 'gray' }] },
    { tag: 'Shape', id: 'blue', x: 220, y: 60, color: 'blue', texts: [{ text: 'Blue' }] },
    { tag: 'Textbox', id: 't', x: 0, y: 220, text: 'note' },
  ],
  connections: [
    { from: 'i', to: 's' },
    { from: 's', to: 'blue', color: 'red' },
  ],
};

describe('applyTheme', () => {
  it('light leaves the document untouched', () => {
    expect(applyTheme(doc, 'light')).toBe(doc);
  });

  it('dark fills in ink, surfaces and line color where the author set none', () => {
    const d = applyTheme(doc, 'dark');
    const by = (id: string) => d.entities.find((e) => e.id === id)!;
    expect(by('i').color).toBe(DARK.ink);
    expect((by('i').texts as any[])[0].color).toBe(DARK.ink); // caption, not only the glyph
    expect(by('s')).toMatchObject({ bgColor: DARK.surface, borderColor: DARK.border, styleMode: 'plain' });
    expect((by('s').texts as any[])[0].color).toBe(DARK.ink);
    expect(by('g')).toMatchObject({ borderColor: DARK.border, styleMode: 'plain' });
    expect((by('g').title as any).color).toBe(DARK.ink);
    expect(by('t').color).toBe(DARK.ink);
    expect(d.connections[0]!.color).toBe(DARK.line);
  });

  it('dark keeps everything the author chose', () => {
    const d = applyTheme(doc, 'dark');
    const by = (id: string) => d.entities.find((e) => e.id === id)!;
    expect((by('s').texts as any[])[1].color).toBe('gray');
    expect(by('blue').bgColor).toBe(TINTS.blue![0]); // token keeps its hue, dark body
    const raw = applyTheme(
      { entities: [{ tag: 'Shape', id: 'r', x: 0, y: 0, bgColor: '#ffeeaa' }], connections: [] },
      'dark',
    );
    expect(raw.entities[0]!.bgColor).toBe('#ffeeaa');
    expect(d.connections[1]!.color).toBe('red');
  });

  it('dark maps palette-colored groups and shapes to dark tints of the same hue', () => {
    const d = applyTheme(
      {
        entities: [
          { tag: 'Group', id: 'g', x: 0, y: 0, color: 'blue', title: { text: 'Tier' } },
          { tag: 'Shape', id: 'n', x: 0, y: 0, color: 'orange', texts: [{ text: 'Note' }] },
        ],
        connections: [],
      },
      'dark',
    );
    const [g, n] = d.entities;
    expect(g).toMatchObject({ bgColor: TINTS.blue![0], borderColor: TINTS.blue![1] });
    expect((g!.title as any).color).toBe(DARK.ink);
    expect(n).toMatchObject({ bgColor: TINTS.orange![0], borderColor: TINTS.orange![1] });
    expect((n!.texts as any[])[0].color).toBe(DARK.ink);
  });

  it('dark gives groups and shapes with a non-palette color a dark body, color on the border', () => {
    const d = applyTheme(
      {
        entities: [
          { tag: 'Group', id: 'g', x: 0, y: 0, color: 'gray', title: { text: 'Tier' } },
          { tag: 'Shape', id: 's', x: 0, y: 0, color: '#888888', texts: [{ text: 'x' }] },
        ],
        connections: [],
      },
      'dark',
    );
    const [g, s] = d.entities;
    expect(g).toMatchObject({ bgColor: DARK.ground, borderColor: 'gray' });
    expect(s).toMatchObject({ bgColor: DARK.surface, borderColor: '#888888' });
  });

  it('dark drops the light offset shadow on database tables', () => {
    const d = applyTheme(
      { entities: [{ tag: 'DatabaseTable', id: 't', x: 0, y: 0, label: 'users' }], connections: [] },
      'dark',
    );
    expect(d.entities[0]!.styleMode).toBe('plain');
  });

  it("dark sets Eraser's hand-drawn typeface everywhere the author set none", () => {
    const d = applyTheme(doc, 'dark');
    const by = (id: string) => d.entities.find((e) => e.id === id)!;
    expect(by('i').typeface).toBe('rough');
    expect((by('s').texts as any[])[0].typeface).toBe('rough');
    expect((by('g').title as any).typeface).toBe('rough');
    expect(by('t').typeface).toBe('rough');
    expect(d.connections[0]!.typeface).toBe('rough');
    const mono = applyTheme(
      { entities: [{ tag: 'Textbox', id: 'm', x: 0, y: 0, text: 'x', typeface: 'mono' }], connections: [] },
      'dark',
    );
    expect(mono.entities[0]!.typeface).toBe('mono');
  });

  it('does not mutate the stored document', () => {
    applyTheme(doc, 'dark');
    expect(doc.entities[1]!.color).toBeUndefined();
  });

  it('every themed upstream fixture still validates', async () => {
    const resolver = await createResolver({ library: stockLibrary, normalizers: stockNormalizers });
    const root = 'third_party/eraser-diagrams/fixtures/corpus';
    for (const f of readdirSync(root)) {
      const themed = applyTheme(toSplit(JSON.parse(readFileSync(`${root}/${f}`, 'utf8'))), 'dark');
      const v = await resolver.validate(themed);
      expect(v.errors, f).toEqual([]);
    }
  });
});

describe('monoToCurrentColor', () => {
  it('lets one-color logos (no fill, or black) follow the theme ink', () => {
    const plain = '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>';
    expect(monoToCurrentColor(plain)).toContain('<svg fill="currentColor" viewBox');
    const black = '<svg viewBox="0 0 24 24"><path fill="#000" d="M0 0"/><path fill="black"/></svg>';
    expect(monoToCurrentColor(black)).not.toMatch(/#000|black/);
  });

  it('leaves colored logos and outline icons alone', () => {
    const aws = '<svg viewBox="0 0 24 24"><path fill="#ED7100" d="M0 0"/><path fill="#000"/></svg>';
    expect(monoToCurrentColor(aws)).toBe(aws);
    const outline = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M0 0"/></svg>';
    expect(monoToCurrentColor(outline)).toBe(outline);
  });
});

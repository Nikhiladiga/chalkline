import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { stockLibrary } from '@eraserlabs/diagram-templates';
import { stockNormalizers } from '@eraserlabs/diagram-templates/normalizers';
import { createResolver, type Resolver } from '@eraserlabs/resolve';
import { beforeAll, describe, expect, it } from 'vitest';
import { diagramCompletions } from './completions';

let source: ReturnType<typeof diagramCompletions>;
beforeAll(async () => {
  const r: Resolver = await createResolver({ library: stockLibrary, normalizers: stockNormalizers });
  source = diagramCompletions({
    schemaOf: (tag) => r.tagSchema(tag),
    icons: ['aws-lambda', 'aws-s3', 'postgres', 'redis'],
  });
});

/** Run the source with the cursor at "|". */
function complete(withCursor: string, explicit = true): { result: CompletionResult | null; text: string } {
  const pos = withCursor.indexOf('|');
  const text = withCursor.replace('|', '');
  const state = EditorState.create({ doc: text, selection: { anchor: pos } });
  return { result: source(new CompletionContext(state, pos, explicit)) as CompletionResult | null, text };
}
const labels = (withCursor: string, explicit = true) =>
  complete(withCursor, explicit).result?.options.map((o) => o.label) ?? [];

const doc = (entity: string, connections = '') =>
  `{\n  "entities": [\n    { "tag": "Group", "id": "vpc", "x": 0, "y": 0 },\n    ${entity}\n  ],\n  "connections": [${connections}]\n}`;

describe('code editor completions', () => {
  it('suggests the properties of the element tag under the cursor, minus ones already set', () => {
    const l = labels(doc('{ "tag": "Shape", "id": "a", "x": 0, "y": 0, "|" }'));
    expect(l).toEqual(expect.arrayContaining(['shape', 'color', 'texts', 'icon', 'width']));
    expect(l).not.toContain('id');
    expect(l).not.toContain('washSym'); // derived by the library, never hand-written
    expect(labels(doc('{ "tag": "Icon", "id": "a", "x": 0, "y": 0, "|" }'))).toContain('size');
  });

  it('suggests "tag" first for an element without one', () => {
    expect(labels(doc('{ "|" }'))[0]).toBe('tag');
  });

  it('suggests element tags as values of "tag"', () => {
    const l = labels(doc('{ "tag": "|" }'));
    expect(l).toEqual(expect.arrayContaining(['Shape', 'Icon', 'Group', 'Textbox', 'DatabaseTable']));
    expect(l).not.toContain('Relationship');
  });

  it('suggests enum values, palette colors and booleans', () => {
    expect(labels(doc('{ "tag": "Shape", "id": "a", "x": 0, "y": 0, "shape": "|" }'))).toEqual(
      expect.arrayContaining(['rectangle', 'diamond', 'cylinder']),
    );
    expect(labels(doc('{ "tag": "Shape", "id": "a", "x": 0, "y": 0, "color": "|" }'))).toContain('blue');
  });

  it('suggests icon names for any icon property, nested ones too', () => {
    expect(labels(doc('{ "tag": "Icon", "id": "a", "x": 0, "y": 0, "icon": "|" }'))).toContain('aws-lambda');
    expect(labels(doc('{ "tag": "Group", "id": "g", "x": 0, "y": 0, "title": { "icon": "|" } }'))).toContain(
      'postgres',
    );
  });

  it('suggests keys inside nested objects (texts items, title)', () => {
    expect(labels(doc('{ "tag": "Shape", "id": "a", "x": 0, "y": 0, "texts": [{ "|" }] }'))).toEqual(
      expect.arrayContaining(['text', 'color', 'fontSize']),
    );
  });

  it('suggests container ids for containerId and element ids for from/to', () => {
    expect(labels(doc('{ "tag": "Shape", "id": "a", "x": 0, "y": 0, "containerId": "|" }'))).toEqual(['vpc']);
    const l = labels(doc('{ "tag": "Shape", "id": "api", "x": 0, "y": 0 }', '{ "from": "|" }'));
    expect(l).toEqual(expect.arrayContaining(['vpc', 'api']));
  });

  it('suggests connection properties', () => {
    expect(
      labels(doc('{ "tag": "Shape", "id": "a", "x": 0, "y": 0 }', '{ "from": "a", "to": "vpc", "|" }')),
    ).toEqual(expect.arrayContaining(['label', 'lineStyle', 'endArrowhead']));
  });

  it('offers whole-element templates when typing a word in the entities list', () => {
    const { result } = complete(doc('Ic|'), false);
    const icon = result?.options.find((o) => o.label === 'Icon');
    expect(icon?.type).toBe('class');
    expect(result?.from).toBe(doc('Ic').indexOf('Ic'));
  });

  it('offers a connection template in the connections list', () => {
    expect(labels(doc('{ "tag": "Shape", "id": "a", "x": 0, "y": 0 }', '|'))).toContain('Connection');
  });

  it('matches the text after the opening quote and replaces up to the closing quote', () => {
    const { result, text } = complete(doc('{ "tag": "Sha|" }'));
    expect(text.slice(result!.from, result!.to ?? result!.from)).toBe('Sha"');
    expect(result!.options.find((o) => o.label === 'Shape')!.apply).toBe('Shape"');
  });

  it('stays quiet while typing outside a string or word', () => {
    expect(complete(doc('{ "tag": "Shape", "id": "a", "x": 1| }'), false).result).toBeNull();
  });
});

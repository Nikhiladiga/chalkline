import { stockLibrary } from '@eraserlabs/diagram-templates';
import { stockNormalizers } from '@eraserlabs/diagram-templates/normalizers';
import { createResolver, type Resolver } from '@eraserlabs/resolve';
import { beforeAll, describe, expect, it } from 'vitest';
import aliases from '../../../icons/aliases.json';
import names from '../../../icons/names.json';
import type { Box, Doc } from '../engine/types';
import { fixIcons } from './iconFix';
import { fitContainers, mergePositions, placeNew } from './merge';
import { docFromJson, extractJson, fragmentFromText, toSplit } from './parse';
import { type AiDeps, runAi } from './pipeline';
import { buildMessages, FEW_SHOT, iconSubset, systemPrompt } from './prompt';
import { stripForModel } from './strip';

let resolver: Resolver;
beforeAll(async () => {
  resolver = await createResolver({ library: stockLibrary, normalizers: stockNormalizers });
});
const schemaOf = (tag: string) => resolver.tagSchema(tag) as any;

describe('extractJson', () => {
  it('reads a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('reads a fenced block surrounded by prose', () => {
    expect(extractJson('Here you go:\n```json\n{"a":{"b":[1,2]}}\n```\nEnjoy')).toEqual({ a: { b: [1, 2] } });
  });

  it('ignores <think> reasoning, even when it contains braces', () => {
    expect(extractJson('<think>maybe {"x":0}?</think>\n{"a":2}')).toEqual({ a: 2 });
  });

  it('handles braces inside strings', () => {
    expect(extractJson('{"t":"a } b {"}')).toEqual({ t: 'a } b {' });
  });

  it('throws a readable error on truncated output', () => {
    expect(() => extractJson('{"entities":[{"id":"a"')).toThrow(/incomplete|JSON/i);
  });

  it('throws when there is no object at all', () => {
    expect(() => extractJson('Sorry, I cannot do that.')).toThrow(/JSON/);
  });
});

describe('toSplit', () => {
  it('splits an elements envelope by from/to', () => {
    const d = toSplit({
      elements: [
        { tag: 'Shape', id: 'a', x: 0, y: 0 },
        { from: 'a', to: 'a' },
      ],
    });
    expect(d).toEqual({
      entities: [{ tag: 'Shape', id: 'a', x: 0, y: 0 }],
      connections: [{ from: 'a', to: 'a' }],
    });
  });

  it('fills a missing connections list', () => {
    expect(toSplit({ entities: [] })).toEqual({ entities: [], connections: [] });
  });

  it('moves connections the model put in entities', () => {
    const d = toSplit({ entities: [{ tag: 'Relationship', from: 'a', to: 'b' }], connections: [] });
    expect(d.connections).toHaveLength(1);
    expect(d.entities).toHaveLength(0);
  });
});

describe('stripForModel', () => {
  it('drops schema defaults, the default connection tag and routes', () => {
    const doc: Doc = {
      entities: [
        { tag: 'Shape', id: 'a', x: 0, y: 0, shape: 'rectangle', styleMode: 'shadow', color: 'blue' },
      ],
      connections: [
        { tag: 'Relationship', from: 'a', to: 'a', cornerStyle: 'elbow', points: [], x: 1, y: 2, label: 'x' },
      ],
    };
    expect(stripForModel(doc, schemaOf)).toEqual({
      entities: [{ tag: 'Shape', id: 'a', x: 0, y: 0, color: 'blue' }],
      connections: [{ from: 'a', to: 'a', label: 'x' }],
    });
  });
});

describe('fixIcons', () => {
  const doc = (icon: string): Doc => ({
    entities: [{ tag: 'Icon', id: 'a', x: 0, y: 0, icon }],
    connections: [],
  });

  it('keeps known names', () => {
    expect(fixIcons(doc('aws-lambda'), names, aliases).fixes).toEqual([]);
  });

  it('maps aliases', () => {
    const r = fixIcons(doc('Lambda'), names, aliases);
    expect(r.doc.entities[0]!.icon).toBe('aws-lambda');
    expect(r.fixes).toEqual(['Lambda → aws-lambda']);
  });

  it('fuzzy-matches near misses', () => {
    expect(fixIcons(doc('kubernets'), names, aliases).doc.entities[0]!.icon).toBe('kubernetes');
    expect(fixIcons(doc('aws-dynamo-db'), names, aliases).doc.entities[0]!.icon).toBe('aws-dynamodb');
  });

  it('fixes title icons on groups', () => {
    const d: Doc = {
      entities: [{ tag: 'Group', id: 'g', x: 0, y: 0, title: { text: 'VPC', icon: 'vpc' } }],
      connections: [],
    };
    expect((fixIcons(d, names, aliases).doc.entities[0]!.title as any).icon).toBe('aws-vpc');
  });

  it('leaves hopeless names for the placeholder', () => {
    expect(fixIcons(doc('zzqqxxy'), names, aliases).doc.entities[0]!.icon).toBe('zzqqxxy');
  });
});

describe('fixIcons caption pass', () => {
  const icon = (icon: string, text: string, id = 'a'): Doc => ({
    entities: [{ tag: 'Icon', id, x: 0, y: 0, icon, texts: [{ text }] }],
    connections: [],
  });
  const pick = (d: Doc, keep?: Doc) => fixIcons(d, names, aliases, keep).doc.entities[0]!.icon;

  it('lets a caption that names a product replace a generic pick', () => {
    expect(fixIcons(icon('bell', 'Sentry'), names, aliases)).toMatchObject({
      doc: { entities: [{ icon: 'sentry' }] },
      fixes: ['bell → sentry'],
    });
    expect(pick(icon('alert-triangle', 'Sentry'))).toBe('sentry');
    expect(pick(icon('database', 'Postgres'))).toBe('postgres');
    expect(pick(icon('database', 'PostgreSQL'))).toBe('postgres');
    expect(pick(icon('database', 'Redis'))).toBe('redis');
    expect(pick(icon('zap', 'Kafka'))).toBe('kafka');
  });

  it('never overrides a specific pick, or maps concepts and non-products', () => {
    expect(pick(icon('aws-lambda', 'Node'))).toBe('aws-lambda');
    expect(pick(icon('aws-lambda', 'Sentry'))).toBe('aws-lambda');
    expect(pick(icon('mysql', 'Postgres'))).toBe('mysql');
    expect(pick(icon('github', 'GitLab'))).toBe('github');
    expect(pick(icon('react', 'Node'))).toBe('react');
    expect(pick(icon('settings', 'Cleanup Jobs'))).toBe('settings');
    expect(pick(icon('bell', 'Alert service'))).toBe('bell');
    expect(pick(icon('bell', 'Database'))).toBe('bell');
    expect(pick(icon('database', 'Cache'))).toBe('database');
    expect(pick(icon('bell', 'Sentri'))).toBe('bell');
  });

  it('fixes Group title icons from the title text', () => {
    const d: Doc = {
      entities: [{ tag: 'Group', id: 'g', x: 0, y: 0, title: { text: 'Kafka', icon: 'layers' } }],
      connections: [],
    };
    expect((fixIcons(d, names, aliases).doc.entities[0]!.title as any).icon).toBe('kafka');
  });

  it('leaves icons the user already had in an edit', () => {
    const mine = icon('bell', 'Sentry', 'alerts');
    expect(pick(mine, mine)).toBe('bell');
    expect(pick(icon('bell', 'Sentry', 'alerts'), icon('server', 'Sentry', 'alerts'))).toBe('sentry');
  });
});

describe('fragmentFromText', () => {
  it('accepts a diagram fragment and rejects anything else', () => {
    const frag = { entities: [{ tag: 'Icon', id: 'a', x: 1, y: 2 }], connections: [{ from: 'a', to: 'a' }] };
    expect(fragmentFromText(JSON.stringify(frag))).toEqual(frag);
    for (const text of [
      'hello',
      '[]',
      '{}',
      '{"entities":[]}',
      '{"entities":[{"id":"a","x":0,"y":0}]}',
      'null',
    ])
      expect(fragmentFromText(text)).toBeNull();
  });
});

describe('mergePositions', () => {
  const prev: Doc = { entities: [{ tag: 'Shape', id: 'a', x: 10, y: 10 }], connections: [] };
  const next: Doc = {
    entities: [
      { tag: 'Shape', id: 'a', x: 500, y: 500, color: 'red' },
      { tag: 'Shape', id: 'b', x: 200, y: 10 },
    ],
    connections: [{ from: 'a', to: 'b' }],
  };

  it('keeps existing coordinates and takes everything else from the model', () => {
    const m = mergePositions(prev, next, false);
    expect(m.entities[0]).toEqual({ tag: 'Shape', id: 'a', x: 10, y: 10, color: 'red' });
    expect(m.entities[1]).toMatchObject({ id: 'b', x: 200, y: 10 });
  });

  it('lets the model move things when allowed', () => {
    expect(mergePositions(prev, next, true).entities[0]).toMatchObject({ x: 500, y: 500 });
  });
});

describe('placeNew', () => {
  it('moves the element by the footprint delta, so a caption overhang is kept', () => {
    const doc: Doc = {
      entities: [
        { tag: 'Shape', id: 'a', x: 0, y: 0 },
        { tag: 'Icon', id: 'n', x: 30, y: 10, icon: 'docker' },
      ],
      connections: [{ from: 'a', to: 'n' }],
    };
    // n's footprint starts 20px left of its glyph (caption wider than the icon).
    const boxes: Record<string, Box> = {
      a: { x: 0, y: 0, width: 100, height: 50 },
      n: { x: 10, y: 10, width: 90, height: 80 },
    };
    const n = placeNew(doc, boxes, ['n']).entities[1]!;
    expect(n.x).toBe(100 + 60 + 20); // footprint at right of a + gap, glyph 20px inside it
  });

  it('moves an overlapping new node next to its first connected neighbor', () => {
    const doc: Doc = {
      entities: [
        { tag: 'Shape', id: 'a', x: 0, y: 0 },
        { tag: 'Shape', id: 'n', x: 10, y: 10 },
      ],
      connections: [{ from: 'a', to: 'n' }],
    };
    const boxes: Record<string, Box> = {
      a: { x: 0, y: 0, width: 100, height: 50 },
      n: { x: 10, y: 10, width: 100, height: 50 },
    };
    const out = placeNew(doc, boxes, ['n']);
    const n = out.entities[1]!;
    expect(n.x).toBeGreaterThanOrEqual(160);
    expect(n.y).toBe(0);
  });

  it('steps down until the slot is free', () => {
    const doc: Doc = {
      entities: [
        { tag: 'Shape', id: 'a', x: 0, y: 0 },
        { tag: 'Shape', id: 'b', x: 160, y: 0 },
        { tag: 'Shape', id: 'n', x: 0, y: 0 },
      ],
      connections: [{ from: 'n', to: 'a' }],
    };
    const boxes: Record<string, Box> = {
      a: { x: 0, y: 0, width: 100, height: 50 },
      b: { x: 160, y: 0, width: 100, height: 50 },
      n: { x: 0, y: 0, width: 100, height: 50 },
    };
    const n = placeNew(doc, boxes, ['n']).entities[2]!;
    expect(n.y).toBeGreaterThanOrEqual(90);
  });
});

describe('fitContainers', () => {
  it('grows a nested group and then its parent group, so nothing sticks out', () => {
    const doc: Doc = {
      entities: [
        { tag: 'Group', id: 'outer', x: 0, y: 0, width: 300, height: 200 },
        { tag: 'Group', id: 'inner', x: 20, y: 40, width: 200, height: 120, containerId: 'outer' },
        { tag: 'Shape', id: 'n', x: 260, y: 60, containerId: 'inner' },
      ],
      connections: [],
    };
    const boxes: Record<string, Box> = {
      outer: { x: 0, y: 0, width: 300, height: 200 },
      inner: { x: 20, y: 40, width: 200, height: 120 },
      n: { x: 260, y: 60, width: 100, height: 50 },
    };
    const out = fitContainers(doc, boxes);
    const inner = out.entities[1]!;
    const outer = out.entities[0]!;
    expect(20 + (inner.width as number)).toBeGreaterThanOrEqual(360 + 32);
    expect(outer.width as number).toBeGreaterThanOrEqual(20 + (inner.width as number) + 32);
  });
});

describe('prompt', () => {
  it('every few-shot example is a valid document', async () => {
    for (const ex of FEW_SHOT) {
      const v = await resolver.validate(ex.doc);
      expect(v.errors).toEqual([]);
    }
  });

  it('every few-shot icon exists in the catalog', () => {
    const known = new Set(names);
    for (const ex of FEW_SHOT) {
      for (const e of ex.doc.entities)
        if (typeof e.icon === 'string') expect(known.has(e.icon), e.icon).toBe(true);
    }
  });

  it('picks provider icons from keywords and caps the list', () => {
    const aws = iconSubset('AWS serverless API with Lambda', names);
    expect(aws).toContain('aws-lambda');
    expect(aws).toContain('server');
    expect(aws.length).toBeLessThanOrEqual(300);
    expect(iconSubset('a flowchart for onboarding', names).some((n) => n.startsWith('aws-'))).toBe(false);
  });

  it('uses simple rules and examples for generation', () => {
    const msgs = buildMessages('generate', 'x', { entities: [], connections: [] }, ['server'], schemaOf);
    expect(msgs[0]!.content).toBe(systemPrompt(['server']));
    expect(msgs[0]!.content).toContain('clean and minimal');
    expect(msgs.filter((m) => m.role === 'assistant').map((m) => JSON.parse(m.content))).toEqual(
      FEW_SHOT.map((ex) => ex.doc),
    );
  });

  it('includes the current document in edit mode', () => {
    const current: Doc = { entities: [{ tag: 'Shape', id: 'web', x: 0, y: 0 }], connections: [] };
    const msgs = buildMessages('edit', 'add a cache', current, ['server'], schemaOf);
    const last = msgs.at(-1)!.content;
    expect(last).toContain('"id":"web"');
    expect(last).toContain('add a cache');
    expect(msgs[0]!.content).toBe(systemPrompt(['server']));
  });
});

describe('runAi', () => {
  const good = JSON.stringify({
    entities: [
      { tag: 'Icon', id: 'api', x: 40, y: 40, icon: 'lambda', texts: [{ text: 'API' }] },
      { tag: 'Icon', id: 'db', x: 300, y: 40, icon: 'aws-dynamodb', texts: [{ text: 'DB' }] },
    ],
    connections: [{ from: 'api', to: 'db' }],
  });
  const bad = JSON.stringify({ entities: [{ tag: 'Shap', id: 'a', x: 0, y: 0 }], connections: [] });
  const farApart = async (d: Doc) =>
    Object.fromEntries(d.entities.map((e) => [e.id, { x: e.x, y: e.y, width: 50, height: 50 }]));

  const deps = (replies: string[], extra: Partial<AiDeps> = {}) => {
    const calls: { role: string; content: string }[][] = [];
    const stages: string[] = [];
    const d: AiDeps = {
      chat: async (messages) => {
        calls.push(messages);
        return replies.shift() ?? '';
      },
      validate: (doc) => resolver.validate(doc),
      measure: farApart,
      names,
      aliases,
      schemaOf,
      maxRepairs: 2,
      onStage: (s) => stages.push(s),
      ...extra,
    };
    return { d, calls, stages };
  };

  it("gives a captioned product its own icon, but keeps the user's icon in an edit", async () => {
    const reply = JSON.stringify({
      entities: [{ tag: 'Icon', id: 'errors', x: 40, y: 40, icon: 'bell', texts: [{ text: 'Sentry' }] }],
      connections: [],
    });
    const gen = await runAi(deps([reply]).d, {
      mode: 'generate',
      prompt: 'monitoring',
      current: { entities: [], connections: [] },
      allowMove: true,
    });
    expect(gen.ok && gen.doc.entities[0]!.icon).toBe('sentry');
    expect(gen.ok && gen.fixes).toContain('bell → sentry');
    const current = JSON.parse(reply);
    const edit = await runAi(deps([reply]).d, { mode: 'edit', prompt: 'keep it', current, allowMove: true });
    expect(edit.ok && edit.doc.entities[0]!.icon).toBe('bell');
  });

  it('repairs an invalid reply by sending the issues back', async () => {
    const { d, calls, stages } = deps([bad, good]);
    const r = await runAi(d, {
      mode: 'generate',
      prompt: 'x',
      current: { entities: [], connections: [] },
      allowMove: false,
    });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.at(-1)!.content).toMatch(/E_UNKNOWN_TAG|E_/);
    expect(stages).toContain('repairing 1/2');
  });

  it('applies icon fix-ups and reports them', async () => {
    const { d } = deps([good]);
    const r = await runAi(d, {
      mode: 'generate',
      prompt: 'x',
      current: { entities: [], connections: [] },
      allowMove: false,
    });
    if (!r.ok) throw new Error(r.message);
    expect(r.doc.entities[0]!.icon).toBe('aws-lambda');
    expect(r.fixes).toEqual(['lambda → aws-lambda']);
  });

  it('gives up after maxRepairs and returns the best draft', async () => {
    const { d, calls } = deps([bad, bad, bad, good]);
    const r = await runAi(d, {
      mode: 'generate',
      prompt: 'x',
      current: { entities: [], connections: [] },
      allowMove: false,
    });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(3);
    if (!r.ok) expect(r.draft).toContain('Shap');
  });

  it('asks for JSON again when the reply is not JSON', async () => {
    const { d, calls } = deps(['I think you want a diagram!', good]);
    const r = await runAi(d, {
      mode: 'generate',
      prompt: 'x',
      current: { entities: [], connections: [] },
      allowMove: false,
    });
    expect(r.ok).toBe(true);
    expect(calls[1]!.at(-1)!.content).toMatch(/JSON/);
  });

  it('runs auto-layout when a fresh diagram overlaps', async () => {
    const stacked = async (d: Doc) =>
      Object.fromEntries(d.entities.map((e) => [e.id, { x: 0, y: 0, width: 50, height: 50 }]));
    const { d, stages } = deps([good], { measure: stacked });
    const r = await runAi(d, {
      mode: 'generate',
      prompt: 'x',
      current: { entities: [], connections: [] },
      allowMove: false,
    });
    expect(stages).toContain('layout fallback');
    if (r.ok) expect(r.laidOut).toBe(true);
  });

  // Acceptance run: a deep result's model-picked coordinates are crowded even without overlaps.
  describe('deep auto-layout', () => {
    const icon = (id: string, containerId: string | undefined, x: number, y: number) => ({
      tag: 'Icon',
      id,
      icon: 'server',
      x,
      y,
      ...(containerId ? { containerId } : {}),
      texts: [{ text: id }],
    });
    const group = (id: string, containerId: string | undefined, x: number, w: number) => ({
      tag: 'Group',
      id,
      title: { text: id },
      x,
      y: 40,
      width: w,
      height: 900,
      ...(containerId ? { containerId } : {}),
    });
    const service = JSON.stringify({
      entities: [
        icon('client', undefined, 0, 400),
        group('system', undefined, 180, 1100),
        group('api', 'system', 220, 220),
        icon('upload', 'api', 300, 180),
        icon('progress', 'api', 300, 400),
        group('pipeline', 'system', 520, 300),
        icon('bus', 'pipeline', 580, 300),
        icon('adapter', 'pipeline', 700, 500),
        icon('postgres', 'system', 1000, 200),
        { tag: 'Textbox', id: 'note', x: 0, y: 1000, width: 640, text: 'Sources: src/app.ts:1' },
      ],
      connections: [
        { from: 'client', to: 'upload', label: 'HTTP POST' },
        { from: 'client', to: 'progress', label: 'HTTP GET' },
        { from: 'upload', to: 'bus', label: 'publish' },
        { from: 'bus', to: 'adapter', label: 'on init' },
        { from: 'upload', to: 'postgres', label: 'SQL write' },
        { from: 'adapter', to: 'postgres' },
        { from: 'progress', to: 'postgres', label: 'SQL read' },
      ],
    });
    const original = JSON.parse(service) as Doc;
    const at = (doc: Doc) => doc.entities.map((e) => [e.id, e.x, e.y]);
    // Real footprints: groups at their own size, so nothing is "messy" and only deep forces a layout.
    const measure = async (doc: Doc) =>
      Object.fromEntries(
        doc.entities.map((e) => [e.id, { x: e.x!, y: e.y!, width: e.width ?? 50, height: e.height ?? 50 }]),
      );

    it('lays out a fresh deep diagram and keeps every child inside its group', async () => {
      const { d, stages } = deps([service], { measure });
      const r = await runAi(d, {
        mode: 'generate',
        prompt: 'x',
        current: empty,
        allowMove: false,
        deep: true,
      });
      if (!r.ok) throw new Error(r.message);
      expect(stages).toContain('auto-layout');
      expect(r.laidOut).toBe(false);
      expect(at(r.doc)).not.toEqual(at(original));
      const byId = new Map(r.doc.entities.map((e) => [e.id, e]));
      for (const e of r.doc.entities) {
        expect(e.containerId).toBe(original.entities.find((o) => o.id === e.id)!.containerId);
        const p = e.containerId ? byId.get(e.containerId) : undefined;
        if (!p) continue;
        expect(e.x).toBeGreaterThanOrEqual(p.x!);
        expect(e.y).toBeGreaterThanOrEqual(p.y!);
        expect(e.x).toBeLessThan(p.x! + p.width!);
        expect(e.y).toBeLessThan(p.y! + p.height!);
      }
    });

    it('leaves a non-deep generation and a deep edit where the model put them', async () => {
      const plain = deps([service], { measure });
      const r = await runAi(plain.d, { mode: 'generate', prompt: 'x', current: empty, allowMove: false });
      if (!r.ok) throw new Error(r.message);
      expect(plain.stages).not.toContain('auto-layout');
      expect(at(r.doc)).toEqual(at(original));

      const edit = deps([service], { measure });
      const e = await runAi(edit.d, {
        mode: 'edit',
        prompt: 'update',
        current: original,
        allowMove: true,
        deep: true,
      });
      if (!e.ok) throw new Error(e.message);
      expect(edit.stages).not.toContain('auto-layout');
      expect(at(e.doc)).toEqual(at(original));
    });
  });

  it('keeps existing positions in edit mode', async () => {
    const current: Doc = {
      entities: [{ tag: 'Icon', id: 'api', x: 5, y: 7, icon: 'aws-lambda' }],
      connections: [],
    };
    const { d } = deps([good]);
    const r = await runAi(d, { mode: 'edit', prompt: 'add db', current, allowMove: false });
    if (!r.ok) throw new Error(r.message);
    expect(r.doc.entities[0]).toMatchObject({ id: 'api', x: 5, y: 7 });
  });

  it('treats an empty diagram as an error to repair', async () => {
    const { d, calls } = deps([JSON.stringify({ entities: [], connections: [] }), good]);
    const r = await runAi(d, {
      mode: 'generate',
      prompt: 'x',
      current: { entities: [], connections: [] },
      allowMove: false,
    });
    expect(r.ok).toBe(true);
    expect(calls[1]!.at(-1)!.content).toMatch(/E_EMPTY/);
  });

  it('sends an edit that silently drops most existing elements back for repair', async () => {
    const current: Doc = {
      entities: ['a', 'b', 'c', 'd'].map((id, i) => ({ tag: 'Shape', id, x: i * 200, y: 0 })),
      connections: [],
    };
    const onlyNew = JSON.stringify({
      entities: [{ tag: 'Shape', id: 'cache', x: 0, y: 200 }],
      connections: [],
    });
    const full = JSON.stringify({
      entities: [...current.entities, { tag: 'Shape', id: 'cache', x: 0, y: 200 }],
      connections: [],
    });
    const { d, calls } = deps([onlyNew, full]);
    const r = await runAi(d, { mode: 'edit', prompt: 'add a cache', current, allowMove: false });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.at(-1)!.content).toMatch(/E_DROPPED.*a, b, c, d/s);
    if (!r.ok) throw new Error(r.message);
    expect(r.doc.entities).toHaveLength(5);
  });

  it('allows removals the user asked for', async () => {
    const current: Doc = {
      entities: ['a', 'b'].map((id, i) => ({ tag: 'Shape', id, x: i * 200, y: 0 })),
      connections: [],
    };
    const { d, calls } = deps([JSON.stringify({ entities: [current.entities[0]], connections: [] })]);
    const r = await runAi(d, { mode: 'edit', prompt: 'remove b', current, allowMove: false });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('reports a transport error without throwing', async () => {
    const { d } = deps([], {
      chat: async () => {
        throw new Error("Can't reach LM Studio");
      },
    });
    const r = await runAi(d, {
      mode: 'generate',
      prompt: 'x',
      current: { entities: [], connections: [] },
      allowMove: false,
    });
    expect(r).toMatchObject({ ok: false, message: "Can't reach LM Studio" });
  });

  const empty: Doc = { entities: [], connections: [] };
  const padded = (n: number) =>
    JSON.stringify({
      entities: [{ tag: 'Shap', id: 'a', x: 0, y: 0, note: 'x'.repeat(n) }],
      connections: [],
    });

  it('passes the attempt number so only the first call explores the folder', async () => {
    const attempts: number[] = [];
    const replies = [bad, good];
    const { d } = deps([], {
      chat: async (_m, _s, attempt) => {
        attempts.push(attempt);
        return replies.shift()!;
      },
    });
    await runAi(d, { mode: 'generate', prompt: 'x', current: empty, allowMove: false, deep: true });
    expect(attempts).toEqual([0, 1]);
  });

  it('picks icon sets from the folder preview without sending it to the model', async () => {
    const { d, calls } = deps([good]);
    await runAi(d, {
      mode: 'generate',
      prompt: 'x',
      current: empty,
      allowMove: false,
      deep: true,
      iconHint: 'infra/main.tf: aws lambda handler',
    });
    expect(calls[0]![0]!.content).toContain('aws-lambda');
    expect(calls[0]!.map((m) => m.content).join('\n')).not.toContain('infra/main.tf');
  });

  // Final review Minor 1: Description mode keeps its icon sets even after a folder preview.
  it('ignores the folder preview icon hint outside deep mode', async () => {
    const { d, calls } = deps([good]);
    await runAi(d, {
      mode: 'generate',
      prompt: 'x',
      current: empty,
      allowMove: false,
      iconHint: 'infra/main.tf: aws lambda handler',
    });
    expect(calls[0]![0]!.content).not.toContain('aws-lambda');
  });

  it('accepts a deep rescan that removes obsolete components', async () => {
    const current: Doc = {
      entities: ['a', 'b', 'c', 'd'].map((id, i) => ({ tag: 'Shape', id, x: i * 200, y: 0 })),
      connections: [],
    };
    const onlyNew = JSON.stringify({
      entities: [{ tag: 'Shape', id: 'cache', x: 0, y: 200 }],
      connections: [],
    });
    const { d, calls } = deps([onlyNew]);
    const r = await runAi(d, { mode: 'edit', prompt: 'update', current, allowMove: false, deep: true });
    expect(calls).toHaveLength(1);
    expect(r.ok).toBe(true);
  });

  it('keeps a 30k-char draft whole in the repair transcript', async () => {
    const draft = padded(30_000);
    const { d, calls } = deps([draft, good]);
    await runAi(d, { mode: 'generate', prompt: 'x', current: empty, allowMove: false, deep: true });
    expect(calls[1]!.at(-2)).toEqual({ role: 'assistant', content: draft });
  });

  // Review Focus 4: past the cap the transcript is cut, but the code pane still gets everything.
  it('caps a huge draft in the repair transcript but hands the whole draft to the code pane', async () => {
    const huge = padded(150_000);
    const { d, calls } = deps([huge, huge, huge]);
    const r = await runAi(d, { mode: 'generate', prompt: 'x', current: empty, allowMove: false, deep: true });
    expect(calls[1]!.at(-2)!.content).toHaveLength(100_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.draft!.length).toBeGreaterThan(150_000);
  });
});

describe('docFromJson', () => {
  it('reads a diagram file: split form plus a string title only', () => {
    expect(
      docFromJson({
        title: 'T',
        elements: [
          { tag: 'Shape', id: 'a' },
          { from: 'a', to: 'a' },
        ],
      }),
    ).toEqual({
      title: 'T',
      entities: [{ tag: 'Shape', id: 'a' }],
      connections: [{ from: 'a', to: 'a' }],
    });
    expect(docFromJson({ title: 3, entities: [], connections: [] })).toEqual({
      entities: [],
      connections: [],
    });
    expect(() => docFromJson(5)).toThrow('Not a diagram file.');
    expect(() => docFromJson(null)).toThrow('Not a diagram file.');
  });
});

import { stockLibrary } from '@eraserlabs/diagram-templates';
import { stockNormalizers } from '@eraserlabs/diagram-templates/normalizers';
import { createResolver } from '@eraserlabs/resolve';
import { describe, expect, it } from 'vitest';
import { fieldsFor } from './schemaFields';

const resolver = await createResolver({ library: stockLibrary, normalizers: stockNormalizers });

describe('fieldsFor', () => {
  it('turns Shape enums into select fields with their default', () => {
    const shape = fieldsFor(resolver.tagSchema('Shape'));
    const f = shape.find((x) => x.key === 'shape')!;
    expect(f.kind).toBe('enum');
    expect(f.options).toContain('rectangle');
    expect(f.default).toBe('rectangle');
  });

  it('marks palette/css colors and icon names', () => {
    const shape = fieldsFor(resolver.tagSchema('Shape'));
    expect(shape.find((x) => x.key === 'color')!.kind).toBe('color');
    expect(shape.find((x) => x.key === 'icon')!.kind).toBe('icon');
  });

  it('hides geometry, text slots and derived props', () => {
    const keys = fieldsFor(resolver.tagSchema('Shape')).map((f) => f.key);
    for (const k of [
      'tag',
      'id',
      'x',
      'y',
      'containerId',
      'texts',
      'washUid',
      'geoPath',
      'outline',
      'isContainer',
    ]) {
      expect(keys).not.toContain(k);
    }
  });

  it('covers connection arrowheads and line style', () => {
    const keys = fieldsFor(resolver.tagSchema('Relationship')).map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining(['endArrowhead', 'startArrowhead', 'lineStyle', 'label', 'color']),
    );
    expect(keys).not.toContain('points');
  });
});

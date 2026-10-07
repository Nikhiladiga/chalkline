import { describe, expect, it } from 'vitest';
import { pointerRange } from './pointer';

const text = JSON.stringify(
  { entities: [{ id: 'a' }, { id: 'b', icon: 'aws-lambdaa' }], connections: [] },
  null,
  2,
);

describe('pointerRange', () => {
  it('returns the span of the value at a JSON pointer', () => {
    const r = pointerRange(text, '/entities/1/icon');
    expect(text.slice(r.from, r.to)).toBe('"aws-lambdaa"');
  });

  it('falls back to the nearest existing parent', () => {
    const r = pointerRange(text, '/entities/1/texts/0/text');
    expect(text.slice(r.from, r.to)).toContain('"id": "b"');
  });

  it('handles escaped pointer segments and unparsable text', () => {
    expect(pointerRange('{"a/b":1}', '/a~1b')).toEqual({ from: 7, to: 8 });
    expect(pointerRange('{ broken', '/x')).toEqual({ from: 0, to: 0 });
  });
});

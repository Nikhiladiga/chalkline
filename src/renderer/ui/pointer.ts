import { findNodeAtLocation, type ParseError, parseTree } from 'jsonc-parser';

/** Text span of the value a JSON Pointer names, or of its nearest existing parent. */
export function pointerRange(text: string, pointer: string): { from: number; to: number } {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors);
  if (!root || errors.length) return { from: 0, to: 0 };
  const path = pointer
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
  for (let n = path.length; n >= 0; n--) {
    const node = findNodeAtLocation(root, path.slice(0, n));
    if (node) return { from: node.offset, to: node.offset + node.length };
  }
  return { from: 0, to: 0 };
}

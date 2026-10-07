import type { Doc } from '../engine/types';

const ROUTE_KEYS = ['points', 'labelPlacement', 'x', 'y'];

function dropDefaults(el: Record<string, unknown>, schema: any): void {
  for (const [key, prop] of Object.entries<any>(schema?.properties ?? {})) {
    if (prop && 'default' in prop && key in el && JSON.stringify(el[key]) === JSON.stringify(prop.default))
      delete el[key];
  }
}

/** Compact form for the model: no schema defaults, no default connection tag, no routed geometry. */
export function stripForModel(doc: Doc, schemaOf: (tag: string) => any): Doc {
  const out = structuredClone({ entities: doc.entities, connections: doc.connections });
  for (const e of out.entities) dropDefaults(e, schemaOf(e.tag));
  for (const c of out.connections) {
    dropDefaults(c, schemaOf(c.tag ?? 'Relationship'));
    if (c.tag === 'Relationship') delete c.tag;
    for (const k of ROUTE_KEYS) delete c[k];
  }
  return out;
}

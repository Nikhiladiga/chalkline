import { stockLibrary } from '@eraserlabs/diagram-templates';
import { PORTS } from './ports';

// Relationship keeps its existing wire fields; the app adds precise corner ports.
const relationship = structuredClone(stockLibrary.schemas.Relationship) as {
  properties: Record<string, object>;
};
for (const key of ['fromPort', 'toPort']) relationship.properties[key] = { type: 'string', enum: [...PORTS] };
export const diagramLibrary = {
  ...stockLibrary,
  schemas: { ...stockLibrary.schemas, Relationship: relationship },
};

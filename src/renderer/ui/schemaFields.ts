export interface Field {
  key: string;
  kind: 'enum' | 'string' | 'number' | 'boolean' | 'color' | 'icon';
  options?: string[];
  default?: unknown;
}

const HIDDEN = new Set([
  'tag',
  'id',
  'x',
  'y',
  'containerId',
  'texts',
  'title',
  'points',
  'labelPlacement',
  'fields',
  'entries',
  'from',
  'to',
  'text',
]);
// Props the library derives itself (normalizers) — never authored by hand.
export const DERIVED =
  /^(wash|geo|staticGeo|outline|sizePx|lineWidthPx|isContainer|textInk|corner(TL|TR|BR|BL)$|customBorder)/;

function enumOf(prop: any): string[] | undefined {
  const values =
    prop.enum ?? [...(prop.anyOf ?? []), ...(prop.oneOf ?? [])].flatMap((p: any) => p.enum ?? []);
  const strings = (values as unknown[]).filter((v): v is string => typeof v === 'string');
  return strings.length ? strings : undefined;
}

/** Inspector fields generated from a tag's JSON Schema (simple, hand-authorable props only). */
export function fieldsFor(schema: any): Field[] {
  const out: Field[] = [];
  for (const [key, prop] of Object.entries<any>(schema?.properties ?? {})) {
    if (HIDDEN.has(key) || DERIVED.test(key) || !prop) continue;
    const base = 'default' in prop ? { default: prop.default } : {};
    const options = enumOf(prop);
    if (key === 'icon' || prop['x-icon-name']) out.push({ key, kind: 'icon', ...base });
    else if (prop['x-palette'] || prop['x-css-color']) out.push({ key, kind: 'color', ...base });
    else if (options) out.push({ key, kind: 'enum', options, ...base });
    else if (prop.type === 'number' || prop.type === 'integer') out.push({ key, kind: 'number', ...base });
    else if (prop.type === 'boolean') out.push({ key, kind: 'boolean', ...base });
    else if (prop.type === 'string') out.push({ key, kind: 'string', ...base });
  }
  return out;
}

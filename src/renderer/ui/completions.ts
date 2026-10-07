// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${n:text} is CodeMirror snippet syntax, not a template literal.
import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippet,
  startCompletion,
} from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import {
  findNodeAtLocation,
  getLocation,
  getNodeValue,
  type Node,
  parseTree,
  type Segment,
} from 'jsonc-parser';
import { DERIVED } from './schemaFields';

export interface CompletionDeps {
  schemaOf(tag: string): any;
  icons: string[];
}

const PALETTE = ['blue', 'green', 'purple', 'red', 'orange', 'yellow', 'black', 'white'];
const CONNECTION_TAG = 'Relationship';
const ENTITY_TAGS = [
  'Shape',
  'Icon',
  'Group',
  'Textbox',
  'DatabaseTable',
  'Legend',
  'Divider',
  'Activity',
  'Event',
  'Gateway',
  'Pool',
  'Lane',
];
const CONTAINERS = new Set(['Group', 'Lane', 'Pool']);
// Written by the app or the library, not by hand.
const INTERNAL = new Set(['points', 'labelPlacement', 'tag']);
const FIRST = ['tag', 'id', 'x', 'y', 'containerId', 'texts', 'icon', 'title', 'from', 'to', 'label'];

/** New-element templates. `${n:text}` are tab stops; Tab moves to the next one. */
const TEMPLATES: Record<string, string> = {
  Shape:
    '{\n  "tag": "Shape",\n  "id": "${1:shape}",\n  "x": ${2:40},\n  "y": ${3:40},\n  "width": 140,\n  "height": 60,\n  "texts": [{ "text": "${4:Label}" }]\n}',
  Icon: '{\n  "tag": "Icon",\n  "id": "${1:icon}",\n  "x": ${2:40},\n  "y": ${3:40},\n  "icon": "${4:server}",\n  "texts": [{ "text": "${5:Label}" }]\n}',
  Group:
    '{\n  "tag": "Group",\n  "id": "${1:group}",\n  "x": ${2:40},\n  "y": ${3:40},\n  "width": 320,\n  "height": 220,\n  "title": { "text": "${4:Group}" }\n}',
  Textbox:
    '{\n  "tag": "Textbox",\n  "id": "${1:note}",\n  "x": ${2:40},\n  "y": ${3:40},\n  "text": "${4:Note}"\n}',
  DatabaseTable:
    '{\n  "tag": "DatabaseTable",\n  "id": "${1:table}",\n  "x": ${2:40},\n  "y": ${3:40},\n  "label": "${4:users}",\n  "fields": [{ "name": "id", "type": "uuid", "meta": "PK" }]\n}',
  Legend:
    '{\n  "tag": "Legend",\n  "id": "${1:legend}",\n  "x": ${2:40},\n  "y": ${3:40},\n  "entries": [{ "text": "${4:Service}", "color": "blue" }]\n}',
};
const genericTemplate = (tag: string) =>
  `{\n  "tag": "${tag}",\n  "id": "\${1:${tag.toLowerCase()}}",\n  "x": \${2:40},\n  "y": \${3:40}${
    CONTAINERS.has(tag) ? `,\n  "width": 600,\n  "height": 200,\n  "title": { "text": "\${4:${tag}}" }` : ''
  }${['Activity', 'Event', 'Gateway'].includes(tag) ? `,\n  "texts": [{ "text": "\${4:${tag}}" }]` : ''}\n}`;
const CONNECTION_TEMPLATE = '{ "from": "${1}", "to": "${2}", "label": "${3}" }';

/** Follow a path of keys/indexes down a JSON Schema (inline schemas, no $ref). */
function walk(schema: any, path: Segment[]): any {
  let s = schema;
  for (const seg of path) {
    if (!s) return undefined;
    const variants = [s, ...(s.anyOf ?? []), ...(s.oneOf ?? [])];
    s =
      typeof seg === 'number'
        ? variants.map((v) => (Array.isArray(v.items) ? v.items[0] : v.items)).find(Boolean)
        : variants.map((v) => v.properties?.[seg]).find(Boolean);
  }
  return s;
}

const enumOf = (prop: any): string[] =>
  [prop, ...(prop?.anyOf ?? []), ...(prop?.oneOf ?? [])]
    .flatMap((p) => p?.enum ?? (typeof p?.const === 'string' ? [p.const] : []))
    .filter((v): v is string => typeof v === 'string');
const isBoolean = (prop: any) => prop?.type === 'boolean';

const valueAt = (tree: Node | undefined, path: Segment[]) => {
  const n = tree && findNodeAtLocation(tree, path);
  return n ? getNodeValue(n) : undefined;
};

/** Apply a snippet, then reopen the list when the new value has choices. */
const snippetThen =
  (template: string, reopen: boolean) => (view: EditorView, c: Completion, from: number, to: number) => {
    snippet(template)(view, c, from, to);
    if (reopen) startCompletion(view);
  };

export function diagramCompletions(deps: CompletionDeps) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const text = ctx.state.doc.toString();
    const loc = getLocation(text, ctx.pos);
    const tree = parseTree(text);
    // Inside a string only when an odd number of unescaped quotes precede the cursor on its line.
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = text.slice(line.from, ctx.pos).replace(/\\./g, '');
    const quoted = (before.match(/"/g)?.length ?? 0) % 2 === 1 ? ctx.matchBefore(/"[^"\n]*$/) : null;
    const bare = ctx.matchBefore(/[A-Za-z][\w-]*$/);
    const token = quoted ?? bare;
    if (!token && !ctx.explicit) return null;
    // Inside a string, match from after the opening quote (the quote stays) and swallow the
    // closing quote, so picking replaces the whole string. Outside one, insert both quotes.
    const from = quoted ? quoted.from + 1 : (token?.from ?? ctx.pos);
    const to = quoted && text[ctx.pos] === '"' ? ctx.pos + 1 : ctx.pos;
    const lead = quoted ? '' : '"';
    const path = loc.path;
    const list = path[0] === 'entities' ? 'entities' : path[0] === 'connections' ? 'connections' : null;

    // A new element in the entities/connections array.
    // An empty array reports only its own path, so also check that the cursor is inside it.
    const arr = list && tree ? findNodeAtLocation(tree, [list]) : undefined;
    const inEmpty =
      path.length === 1 && arr?.type === 'array' && ctx.pos > arr.offset && ctx.pos < arr.offset + arr.length;
    const element = (path.length === 2 && typeof path[1] === 'number') || inEmpty;
    if (list && element && !loc.isAtPropertyKey && !quoted) {
      if (list === 'connections')
        return {
          from,
          options: [
            {
              label: 'Connection',
              type: 'class',
              detail: 'line between two ids',
              apply: snippet(CONNECTION_TEMPLATE),
            },
          ],
        };
      return {
        from,
        options: ENTITY_TAGS.map((tag) => ({
          label: tag,
          type: 'class',
          detail: 'new element',
          apply: snippet(TEMPLATES[tag] ?? genericTemplate(tag)),
        })),
        validFor: /^[\w-]*$/,
      };
    }

    // The object being edited and its schema.
    const objPath = path.slice(0, -1);
    let schema: any;
    if (!list) schema = { properties: { entities: { type: 'array' }, connections: { type: 'array' } } };
    else if (typeof path[1] === 'number') {
      const tag = valueAt(tree, [list, path[1], 'tag']);
      const root =
        list === 'entities'
          ? typeof tag === 'string' && ENTITY_TAGS.includes(tag)
            ? deps.schemaOf(tag)
            : undefined
          : deps.schemaOf(typeof tag === 'string' ? tag : CONNECTION_TAG);
      schema =
        list === 'entities' && !root && objPath.length === 2
          ? { properties: { tag: {} } }
          : walk(root, objPath.slice(2));
    }

    if (loc.isAtPropertyKey) {
      const present = new Set(
        (tree && findNodeAtLocation(tree, objPath))?.children?.map((p) => p.children?.[0]?.value as string) ??
          [],
      );
      const props = Object.entries<any>(schema?.properties ?? {}).filter(
        ([k]) => !present.has(k) && !DERIVED.test(k) && !(INTERNAL.has(k) && k !== 'tag'),
      );
      if (!props.length) return null;
      const rank = (k: string) => (FIRST.includes(k) ? FIRST.indexOf(k) : 99);
      return {
        from,
        to,
        options: props.map(([key, prop]) => {
          const choices =
            enumOf(prop).length > 0 || prop['x-icon-name'] || prop['x-palette'] || key === 'tag';
          const k = `${lead}${key}": `;
          const tpl =
            prop.type === 'array'
              ? key === 'texts'
                ? `${k}[{ "text": "\${1}" }]`
                : `${k}[\${1}]`
              : prop.type === 'object' || prop.properties
                ? key === 'title'
                  ? `${k}{ "text": "\${1}" }`
                  : `${k}{ \${1} }`
                : prop.type === 'number' || prop.type === 'integer'
                  ? `${k}\${1:${prop.default ?? 0}}`
                  : isBoolean(prop)
                    ? `${k}\${1:${prop.default ?? true}}`
                    : `${k}"\${1}"`;
          return {
            label: key,
            type: 'property',
            detail: enumOf(prop).slice(0, 4).join(' | ') || prop.type || '',
            boost: 99 - rank(key),
            apply: snippetThen(tpl, Boolean(choices) || ['containerId', 'from', 'to'].includes(key)),
          };
        }),
        validFor: /^[\w-]*$/,
      };
    }

    // A value: the last path segment is its key.
    const key = path.at(-1);
    if (typeof key !== 'string') return null;
    const prop = schema?.properties?.[key];
    const ids = (pred: (e: any) => boolean) =>
      ((valueAt(tree, ['entities']) as any[]) ?? [])
        .filter((e) => e && pred(e) && e.id)
        .map((e) => String(e.id));
    let values: string[] = [];
    let type = 'enum';
    if (key === 'tag') values = list === 'connections' ? ['DatabaseRelationship'] : ENTITY_TAGS;
    else if (key === 'containerId') values = ids((e) => CONTAINERS.has(e.tag));
    else if (list === 'connections' && (key === 'from' || key === 'to')) values = ids(() => true);
    else if (prop?.['x-icon-name']) {
      values = deps.icons;
      type = 'variable';
    } else if (prop?.['x-palette']) values = PALETTE;
    else if (isBoolean(prop)) values = ['true', 'false'];
    else values = enumOf(prop);
    if (!values.length) return null;
    const raw = isBoolean(prop);
    return {
      from,
      to,
      options: values.map((v) => ({ label: v, type, apply: raw ? v : quoted ? `${v}"` : JSON.stringify(v) })),
      validFor: /^[\w\- .]*$/,
    };
  };
}

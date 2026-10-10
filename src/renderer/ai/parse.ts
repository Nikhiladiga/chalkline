import type { Doc } from '../engine/types';

/** Pull the JSON object out of a model reply: tolerates <think> blocks, code fences and prose. */
export function extractJson(text: string): unknown {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*?<\/think>/, '');
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]?.includes('{')) t = fence[1];
  const start = t.indexOf('{');
  if (start < 0) throw new Error('No JSON object found in the model output.');
  let depth = 0;
  let inString = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(t.slice(start, i + 1));
      } catch (e) {
        throw new Error(`Model output is not valid JSON: ${(e as Error).message}`);
      }
    }
  }
  throw new Error('Model output is incomplete JSON (it was cut off).');
}

const isConnection = (el: any) => el && typeof el === 'object' && 'from' in el && 'to' in el;
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Normalize whatever envelope the model produced into the split `{ entities, connections }` form. */
export function toSplit(json: unknown): Doc {
  const j = (json ?? {}) as Record<string, unknown>;
  const all = 'elements' in j ? list(j.elements) : [...list(j.entities), ...list(j.connections)];
  return { entities: all.filter((e) => !isConnection(e)), connections: all.filter(isConnection) };
}

/** A diagram file's JSON as a document: the split form plus its title when it is a string. */
export function docFromJson(json: unknown): Doc {
  if (!json || typeof json !== 'object') throw new Error('Not a diagram file.');
  const doc = toSplit(json);
  const title = (json as { title?: unknown }).title;
  return typeof title === 'string' ? { title, ...doc } : doc;
}

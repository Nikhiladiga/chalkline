import type { Doc } from '../engine/types';

/** Levenshtein distance, bailing out once it exceeds `max`. */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]!);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length]!;
}
const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[\s_.]+/g, '-');

/** Map an icon name onto the catalog: exact → alias → fuzzy. Returns undefined when hopeless. */
export function resolveIcon(
  name: string,
  names: string[],
  aliases: Record<string, string>,
): string | undefined {
  const known = new Set(names);
  if (known.has(name)) return name;
  const s = slug(name);
  if (known.has(s)) return s;
  const alias = aliases[s] ?? aliases[s.replace(/^(aws|gcp|azure)-/, '')];
  if (alias && known.has(alias)) return alias;
  // ponytail: linear scan over ~4k names (~1 ms); index it if the catalog grows 10x.
  const max = Math.max(1, Math.floor(s.length * 0.25));
  let found: { name: string; d: number } | undefined;
  for (const n of names) {
    const d = distance(s, n, max);
    if (d <= max && (!found || d < found.d)) found = { name: n, d };
  }
  return found?.name;
}

/** Replace unknown icon names (entity `icon` and container `title.icon`) with catalog names. */
export function fixIcons(
  doc: Doc,
  names: string[],
  aliases: Record<string, string>,
): { doc: Doc; fixes: string[] } {
  const out = structuredClone(doc);
  const fixes: string[] = [];
  const fix = (holder: Record<string, unknown> | undefined) => {
    const name = holder?.icon;
    if (typeof name !== 'string' || !name) return;
    const hit = resolveIcon(name, names, aliases);
    if (hit && hit !== name) {
      holder!.icon = hit;
      fixes.push(`${name} → ${hit}`);
    }
  };
  for (const e of out.entities) {
    fix(e);
    fix(e.title as Record<string, unknown> | undefined);
  }
  return { doc: out, fixes };
}

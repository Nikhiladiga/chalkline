import type { Doc } from '../engine/types';
import { GENERAL } from './prompt';

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

/** Brands in the general vocabulary; the rest of it names concepts (bell, database, user). */
const BRANDS = new Set(
  'github gitlab docker kubernetes postgres mysql mongodb redis kafka rabbitmq nginx node react python java go elasticsearch grafana prometheus openai anthropic stripe terraform cloudflare vercel firebase supabase graphql'.split(
    ' ',
  ),
);
const GENERIC = new Set(GENERAL);
const CONCEPTS = new Set(GENERAL.filter((n) => !BRANDS.has(n)));
/** Aliases that turn a concept into one vendor's product ("cache" → redis): never trusted for a caption. */
const VENDOR_GUESSES = new Set(['queue', 'cache', 'cdn', 'vpc']);

/** The product icon a caption names exactly ("Sentry", "PostgreSQL"); never fuzzy, never a concept. */
export function namedIcon(
  label: string,
  known: Set<string>,
  aliases: Record<string, string>,
): string | undefined {
  const s = slug(label);
  const hit = known.has(s) ? s : VENDOR_GUESSES.has(s) ? undefined : aliases[s];
  return hit && known.has(hit) && !CONCEPTS.has(hit) ? hit : undefined;
}

/**
 * Replace unknown icon names (entity `icon` and container `title.icon`) with catalog names, then let a
 * caption that exactly names a product replace a generic pick ("Sentry" drawn as a bell). Specific picks
 * and entities whose id and icon are unchanged from `keep` (the diagram being edited) are left alone.
 */
export function fixIcons(
  doc: Doc,
  names: string[],
  aliases: Record<string, string>,
  keep?: Doc,
): { doc: Doc; fixes: string[] } {
  const out = structuredClone(doc);
  const fixes: string[] = [];
  const known = new Set(names);
  const before = new Map(keep?.entities.map((e) => [e.id, e]));
  const fix = (holder: Record<string, unknown> | undefined, label: unknown, kept: unknown) => {
    const name = holder?.icon;
    if (typeof name !== 'string' || !name) return;
    let icon = resolveIcon(name, names, aliases) ?? name;
    const named =
      typeof label === 'string' && kept !== name && GENERIC.has(icon)
        ? namedIcon(label, known, aliases)
        : undefined;
    if (named) icon = named;
    if (icon !== name) {
      holder!.icon = icon;
      fixes.push(`${name} → ${icon}`);
    }
  };
  for (const e of out.entities) {
    const old = before.get(e.id);
    fix(e, (e.texts as { text?: unknown }[] | undefined)?.[0]?.text, old?.icon);
    const title = e.title as Record<string, unknown> | undefined;
    fix(title, title?.text, (old?.title as Record<string, unknown> | undefined)?.icon);
  }
  return { doc: out, fixes };
}

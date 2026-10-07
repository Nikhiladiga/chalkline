import aliases from '../../../icons/aliases.json';
import names from '../../../icons/names.json';

export const iconNames: string[] = names;
export const ICON_MIME = 'application/x-open-eraser-icon';
export const iconCategories = {
  all: 'All icons',
  aws: 'AWS',
  azure: 'Azure',
  gcp: 'Google Cloud',
  general: 'General & brands',
};
export type IconCategory = keyof typeof iconCategories;
const popular = [
  'user',
  'server',
  'database',
  'cloud',
  'aws-lambda',
  'aws-api-gateway',
  'aws-simple-storage-service',
  'aws-dynamodb',
  'aws-vpc',
  'postgres',
  'redis',
  'docker',
  'kubernetes',
];
const rank = new Map(popular.map((n, i) => [n, i]));
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const terms = new Map(names.map((n) => [n, normalize(n)]));
for (const [alias, name] of Object.entries(aliases))
  terms.set(name, `${terms.get(name) ?? ''} ${normalize(alias)}`);

export function findIcons(query: string, category: IconCategory = 'all'): string[] {
  const q = normalize(query);
  const words = q.split(' ').filter(Boolean);
  const exact = (aliases as Record<string, string>)[q.replace(/ /g, '-')];
  return names
    .filter((n) => {
      if (category === 'general' && /^(aws|azure|gcp)-/.test(n)) return false;
      if (category !== 'all' && category !== 'general' && !n.startsWith(`${category}-`)) return false;
      return words.every((w) => terms.get(n)?.includes(w));
    })
    .sort((a, b) => {
      const priority = (n: string) => (n === exact || normalize(n) === q ? -1 : (rank.get(n) ?? 100));
      return priority(a) - priority(b) || a.localeCompare(b);
    });
}

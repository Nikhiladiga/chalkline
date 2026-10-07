import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import type { ProjectScan } from '../shared/project';

const MAX_ENTRIES = 20000;
const MAX_FILE_BYTES = 256000;
const MAX_READ_BYTES = 32000000;
const SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  '.idea',
  '.vscode',
  '.terraform',
  '.aws',
  '.ssh',
  '.claude',
  '.codex',
  '.agents',
  '.cursor',
  '.gemini',
  '.opencode',
]);
const INSTRUCTIONS =
  /^(?:agents\.md|claude\.md|gemini\.md|skill\.md|copilot-instructions\.md|\.cursorrules|\.windsurfrules|\.clinerules)$/i;
const EXTENSIONS = new Set(
  '.ts .tsx .js .jsx .mjs .cjs .py .go .rs .java .kt .kts .cs .fs .rb .php .ex .exs .erl .scala .swift .c .cpp .h .hpp .vue .svelte .json .yaml .yml .toml .xml .tf .tfvars .sql .graphql .gql .proto .prisma .md .properties .conf .ini .sh .gradle'.split(
    ' ',
  ),
);
const SECRET =
  /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|id_rsa|id_ed25519|credentials(?:\..*)?|secrets?(?:\..*)?|service[-_]account.*|.*\.(?:pem|key|p12|pfx|keystore))$/i;
const LOCK = /(?:^|[-.])lock(?:\.|$)|^go\.sum$|\.min\.[jt]s$|\.map$/i;

interface Source {
  path: string;
  text: string;
  rank: number;
}
interface Scope {
  prefix: string;
  rules: Ignore;
}

/** Best-effort removal of common literal credentials; excluded files are never read. */
function redact(text: string): string {
  return text
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@"']+:[^\s/@"']+@/gi, '$1[REDACTED]@')
    .replace(
      /(["']?[\w.-]*(?:password|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)[\w.-]*["']?\s*[:=]\s*)(["'`])[^"'`\r\n]*\2/gi,
      '$1"[REDACTED]"',
    )
    .replace(
      /((?:password|secret|token|api[_-]?key|access[_-]?key)\s*[:=]\s*)(?!["'`])[^\s,}\r\n]+/gi,
      '$1[REDACTED]',
    );
}

function rank(path: string): number {
  const name = basename(path).toLowerCase();
  if (
    /^(package\.json|pyproject\.toml|requirements.*\.txt|go\.mod|cargo\.toml|pom\.xml|gemfile|composer\.json|.*\.csproj)$/.test(
      name,
    )
  )
    return 30;
  if (
    /dockerfile|compose|serverless|terraform|\.tf$|\.prisma$|\.proto$|\.graphql$/.test(name) ||
    /(?:infra|deploy|k8s)\//.test(path)
  )
    return 25;
  if (/readme|architecture/.test(name)) return 20;
  if (/^(?:main|index|app|server|bootstrap|startup)(?:\.|$)/.test(name)) return 15;
  if (/routes|controllers|services|database|storage|client|worker/.test(path)) return 10;
  return /test|spec|fixtures/.test(path) ? -5 : 0;
}

const SIGNAL =
  /\b(import|from|require|export|include|resource|provider|module|service|image|depends_on|route|router|register|listen|connect|query|fetch|axios|http|grpc|redis|postgres|mysql|sqlite|mongo|dynamo|s3|lambda|kafka|rabbit|queue|publish|subscribe|readFile|writeFile|open|socket)\b|@(Get|Post|RequestMapping)|app\.(get|post|put|delete|use)|\.execute\(/i;
const IMPORT = /^\s*(?:import\b|from\s+\S+\s+import\b|(?:const|let|var)\b.*\brequire\s*\()/;
const RUNTIME =
  /\.(?:get|post|put|patch|delete|use|listen|authenticate|connect|query|execute|find\w*|create|update|destroy|upsert|search|retrieve|schedule|publish|subscribe|add|send|fetch|readFile|writeFile)\s*\(|\b(?:resource|service|image|depends_on)\s*[:"{]|@(Get|Post|RequestMapping)/i;
const CALL = /\b(?:await\s+)?[\w$]+(?:\.[\w$]+)*\s*\(/;

/** Keep short files intact; spend bounded excerpts on runtime behavior before import headers. */
function excerpt(text: string, priority: number, maxChars: number): string {
  const lines = text.split(/\r?\n/);
  const numbered = lines.map((line, i) => `${i + 1}: ${line.slice(0, 300)}`);
  const full = numbered.join('\n');
  if (JSON.stringify(full).length <= maxChars) return full;
  const selected = new Set<number>();
  let used = 2;
  const add = (i: number) => {
    if (selected.has(i)) return;
    const cost = JSON.stringify(numbered[i]).length + 2;
    if (used + cost > maxChars) return;
    selected.add(i);
    used += cost;
  };
  const anchors = lines
    .map((line, i) => ({
      i,
      score: IMPORT.test(line)
        ? 0
        : RUNTIME.test(line)
          ? 3
          : CALL.test(line) && !/^\s*(?:\/\/|#|console\.)/.test(line)
            ? 2
            : SIGNAL.test(line) || (priority >= 20 && i < 18)
              ? 1
              : 0,
    }))
    .filter((line) => line.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  // Select the calls themselves before their surrounding declarations/comments.
  for (const { i } of anchors) add(i);
  for (const { i } of anchors) {
    for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 3); j++) add(j);
  }
  for (let i = 0; i < Math.min(priority >= 20 ? 18 : 5, lines.length); i++) add(i);
  return [...selected]
    .sort((a, b) => a - b)
    .map((i) => numbered[i])
    .join('\n');
}

/** Prioritize architecture evidence, then alternate module roots to avoid directory starvation. */
function order(sources: Source[]): Source[] {
  const groups = new Map<string, Source[]>();
  for (const s of [...sources].sort((a, b) => b.rank - a.rank || a.path.localeCompare(b.path))) {
    const module = s.path.includes('/') ? s.path.split('/')[0]! : '.';
    const list = groups.get(module) ?? [];
    list.push(s);
    groups.set(module, list);
  }
  const lists = [...groups.values()].sort(
    (a, b) => b[0]!.rank - a[0]!.rank || a[0]!.path.localeCompare(b[0]!.path),
  );
  const result: Source[] = [];
  for (let i = 0; result.length < sources.length; i++)
    for (const list of lists) if (list[i]) result.push(list[i]!);
  return result;
}

export async function scanProject(
  root: string,
  options: { maxChars: number; signal?: AbortSignal },
): Promise<ProjectScan> {
  const signal = options.signal;
  const check = () => signal?.throwIfAborted();
  check();
  const base = await realpath(root);
  if (!(await lstat(base)).isDirectory()) throw new Error('Choose a code folder, not a file.');
  const warnings = new Set<string>();
  const sources: Source[] = [];
  let filesFound = 0;
  let entries = 0;
  let bytes = 0;
  let bounded = false;
  const inside = (path: string) => {
    const rel = relative(base, path);
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };

  async function read(path: string, limit: number): Promise<string | null> {
    check();
    if (!inside(await realpath(path)) || (await lstat(path)).isSymbolicLink()) return null;
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) return null;
      if (stat.size > limit) {
        warnings.add('Some files were skipped because they exceed the per-file size limit.');
        return null;
      }
      const buffer = Buffer.alloc(Math.min(limit + 1, stat.size + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > limit || buffer.subarray(0, bytesRead).includes(0)) return null;
      check();
      bytes += bytesRead;
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  }

  async function walk(dir: string, prefix: string, inherited: Scope[]): Promise<void> {
    check();
    if (!inside(await realpath(dir)) || (await lstat(dir)).isSymbolicLink()) return;
    const scopes = [...inherited];
    try {
      const rules = await read(join(dir, '.gitignore'), 32000);
      if (rules === null) throw new Error('Ignore rules cannot be read safely.');
      if (rules) scopes.push({ prefix, rules: ignore().add(rules) });
    } catch (e) {
      check();
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        if (!prefix)
          throw new Error(
            'Could not safely read this folder’s ignore rules. Fix its .gitignore or choose another folder.',
          );
        bounded = true;
        warnings.add(`Skipped ${prefix}: its ignore rules could not be read safely.`);
        return;
      }
    }
    const children = [];
    const directory = await opendir(dir);
    for await (const child of directory) {
      check();
      if (++entries > MAX_ENTRIES) {
        bounded = true;
        warnings.add('Folder inventory reached its entry limit; coverage is partial.');
        break;
      }
      children.push(child);
    }
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      check();
      if (bytes >= MAX_READ_BYTES) {
        bounded = true;
        warnings.add('Source reading reached its byte budget; coverage is partial.');
        return;
      }
      const path = prefix + child.name;
      if (
        child.isSymbolicLink() ||
        SECRET.test(child.name) ||
        INSTRUCTIONS.test(child.name) ||
        SKIP_DIRS.has(child.name)
      )
        continue;
      const isDir = child.isDirectory();
      let ignored = false;
      for (const scope of scopes) {
        const result = scope.rules.test(path.slice(scope.prefix.length) + (isDir ? '/' : ''));
        if (result.unignored) ignored = false;
        else if (result.ignored) ignored = true;
      }
      if (ignored) continue;
      const full = join(dir, child.name);
      if (isDir) {
        if (entries <= MAX_ENTRIES)
          try {
            await walk(full, `${path}/`, scopes);
          } catch {
            check();
            bounded = true;
            warnings.add(`Could not scan folder ${path}.`);
          }
      } else if (
        child.isFile() &&
        !LOCK.test(child.name) &&
        (EXTENSIONS.has(extname(child.name).toLowerCase()) ||
          /^(Dockerfile(?:\..*)?|Gemfile|go\.mod|requirements.*\.txt|Makefile)$/i.test(child.name))
      ) {
        filesFound++;
        try {
          const text = await read(full, MAX_FILE_BYTES);
          if (text !== null) sources.push({ path, text: redact(text), rank: rank(path) });
        } catch {
          check();
          warnings.add(`Could not read source file ${path}.`);
        }
      }
    }
  }
  await walk(base, '', []);
  check();
  if (!sources.length) throw new Error('No readable source or configuration files found in this folder.');
  const maxChars = Math.max(4000, Math.min(120000, options.maxChars));
  const paths = sources.map((s) => s.path).sort();
  const inventory: string[] = [];
  let inventorySize = 0;
  for (const path of paths) {
    if (inventorySize + JSON.stringify(path).length + 2 > maxChars * 0.15) break;
    inventory.push(path);
    inventorySize += JSON.stringify(path).length + 2;
  }
  const heading = `Repository evidence from current working-tree files (excerpts, not full source).\nProject: ${JSON.stringify(basename(base))}\nInventory (bounded): ${JSON.stringify(inventory)}\n`;
  const chunks: string[] = [];
  let used = heading.length + 350;
  const ordered = order(sources);
  for (const [i, source] of ordered.entries()) {
    const overhead = JSON.stringify({ path: source.path, lines: '' }).length + 1;
    const remaining = maxChars - used - overhead;
    if (remaining < 100) continue;
    const budget = Math.min(6000, remaining, Math.max(600, Math.floor(remaining / (ordered.length - i))));
    const chunk = JSON.stringify({ path: source.path, lines: excerpt(source.text, source.rank, budget) });
    if (used + chunk.length + 1 > maxChars) continue;
    chunks.push(chunk);
    used += chunk.length + 1;
  }
  const limited = bounded || sources.length < filesFound || chunks.length < sources.length;
  if (chunks.length < sources.length)
    warnings.add('Model context budget includes excerpts from only part of the scanned source.');
  const coverage = `Coverage: ${filesFound} eligible files found; ${sources.length} files read; ${chunks.length} files represented in excerpts. ${limited ? 'PARTIAL evidence: do not claim unobserved behavior.' : 'Eligible files covered; excerpts may omit implementation details.'}\n`;
  return {
    name: basename(base),
    context: heading + coverage + chunks.join('\n'),
    filesFound,
    filesRead: sources.length,
    filesIncluded: chunks.length,
    limited,
    warnings: [...warnings],
    paths: paths.slice(0, 80),
  };
}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, protocol } from 'electron';

const HOSTED = 'https://storage.googleapis.com/eraser-public-assets/canvas-icons/';
const NAME = /^[a-z0-9][a-z0-9-]*$/;

export function registerIconScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'icons',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

export const userIconDir = (): string => join(app.getPath('userData'), 'icons');
const cacheDir = (): string => join(app.getPath('userData'), 'icon-cache');

/** user icon dir → disk cache → hosted Eraser bucket (cached). */
export async function loadIconSvg(name: string, hosted: boolean): Promise<string | null> {
  if (!NAME.test(name)) return null;
  for (const dir of [userIconDir(), cacheDir()]) {
    try {
      return await readFile(join(dir, `${name}.svg`), 'utf8');
    } catch {}
  }
  if (!hosted) return null;
  try {
    const res = await fetch(`${HOSTED}${name}.svg`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const svg = await res.text();
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(join(cacheDir(), `${name}.svg`), svg);
    return svg;
  } catch {
    return null;
  }
}

export function handleIcons(hosted: () => boolean): void {
  protocol.handle('icons', async (req) => {
    const name = new URL(req.url).pathname.replace(/^\//, '').replace(/\.svg$/, '');
    const svg = await loadIconSvg(name, hosted());
    const headers = { 'content-type': 'image/svg+xml', 'access-control-allow-origin': '*' };
    return svg ? new Response(svg, { headers }) : new Response('not found', { status: 404, headers });
  });
}

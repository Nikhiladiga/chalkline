import { type Box, SHEET_PAD } from './types';

/**
 * Standalone SVG: the serialized scene as XHTML inside a <foreignObject>, with the page styles
 * (fonts already inlined as data URIs). Pixel-identical to the app render in browsers.
 * ponytail: foreignObject — Figma/Illustrator ignore it; swap in a DOM→SVG converter if needed.
 */
export function toSvg(
  serialized: { scene: string; css: string },
  /** Painted bounds in scene-local px (engine RenderOk.bounds). */
  bounds: Box,
  /** Background fill, or undefined for transparent. */
  background?: string,
): string {
  const P = SHEET_PAD;
  const W = Math.ceil(bounds.width) + 2 * P;
  const H = Math.ceil(bounds.height) + 2 * P;
  const html = new DOMParser().parseFromString(
    `<!doctype html><html><body>${serialized.scene}</body></html>`,
    'text/html',
  );
  // Template comments may contain "--", which XML forbids; they carry nothing visual.
  const walker = html.createTreeWalker(html.body, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const c of comments) c.parentNode?.removeChild(c);
  const xml = new XMLSerializer();
  const body = [...html.body.childNodes].map((n) => xml.serializeToString(n)).join('');
  const css = serialized.css.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const bg = background ? `<rect width="100%" height="100%" fill="${background}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bg}<foreignObject x="0" y="0" width="${W}" height="${H}"><div xmlns="http://www.w3.org/1999/xhtml" style="margin:0;position:relative;left:${P - bounds.x}px;top:${P - bounds.y}px"><style>${css}</style>${body}</div></foreignObject></svg>`;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Entity {
  tag: string;
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  containerId?: string | null;
  [key: string]: unknown;
}

export interface Connection {
  tag?: string;
  id?: string;
  from: string;
  to: string;
  [key: string]: unknown;
}

export interface Doc {
  title?: string;
  entities: Entity[];
  connections: Connection[];
}

export interface Issue {
  code: string;
  path: string;
  message: string;
  severity?: string;
  elementId?: string;
  suggestion?: string;
}

export const emptyDoc = (): Doc => ({ entities: [], connections: [] });

/** White margin around the diagram on the canvas sheet and in every export (upstream's scene box has none past the outermost label). */
export const SHEET_PAD = 32;

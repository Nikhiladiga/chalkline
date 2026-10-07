import type { Box } from './types';

export const PORTS = [
  'top-left',
  'top',
  'top-right',
  'right',
  'bottom-right',
  'bottom',
  'bottom-left',
  'left',
] as const;
export type Port = (typeof PORTS)[number];
export const PORT_POSITIONS: Record<Port, [number, number]> = {
  'top-left': [0, 0],
  top: [0.5, 0],
  'top-right': [1, 0],
  right: [1, 0.5],
  'bottom-right': [1, 1],
  bottom: [0.5, 1],
  'bottom-left': [0, 1],
  left: [0, 0.5],
};
export const isPort = (value: unknown): value is Port =>
  typeof value === 'string' && (PORTS as readonly string[]).includes(value);
export function portPoint(box: Box, port: Port): { x: number; y: number } {
  const [x, y] = PORT_POSITIONS[port];
  return { x: box.x + x * box.width, y: box.y + y * box.height };
}
export function nearestPort(box: Box, point: { x: number; y: number }): Port {
  return PORTS.reduce((best, port) => {
    const a = portPoint(box, port);
    const b = portPoint(box, best);
    return Math.hypot(a.x - point.x, a.y - point.y) < Math.hypot(b.x - point.x, b.y - point.y) ? port : best;
  });
}

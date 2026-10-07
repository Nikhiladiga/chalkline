/*
 * Ported from eraser-diagrams `packages/diagrams/src/diagrams.ts` (`toDiagramJson`, not exported upstream).
 * Copyright (c) Eraser Labs — MIT License (see third_party/eraser-diagrams/LICENSE).
 *
 * Rebuild the measured document from the pristine authored elements, overlaying measured geometry
 * and nothing else: entities take their final scene boxes; connections take the routed polyline in
 * the authored frame (origin x/y plus origin-relative points, label box as labelPlacement).
 */

import type { SceneLayout } from '@eraserlabs/render';
import type { AuthoredRecord } from '@eraserlabs/resolve';

export interface MeasuredDoc {
  entities: Record<string, unknown>[];
  connections: Record<string, unknown>[];
  scene: SceneLayout['scene'];
}

export function toDiagramJson(authored: readonly AuthoredRecord[], layout: SceneLayout): MeasuredDoc {
  const entities: Record<string, unknown>[] = [];
  const connections: Record<string, unknown>[] = [];

  for (const { id, kind, source } of authored) {
    const element = structuredClone(source);
    if (kind === 'entity') {
      const box = layout.boxes[id];
      if (box) Object.assign(element, { x: box.x, y: box.y, width: box.width, height: box.height });
      entities.push(element);
      continue;
    }

    const geometry = layout.connections[id];
    const origin = geometry?.points[0];
    if (geometry && origin) {
      const [ox, oy] = origin;
      element.x = ox;
      element.y = oy;
      element.points = geometry.points.map(([x, y]) => ({ x: x - ox, y: y - oy }));
      const label = geometry.labelBox;
      if (label) {
        element.labelPlacement = {
          x: Math.round(label.x - ox),
          y: Math.round(label.y - oy),
          width: Math.round(label.width),
          height: Math.round(label.height),
        };
      }
    }
    connections.push(element);
  }

  return { entities, connections, scene: layout.scene };
}

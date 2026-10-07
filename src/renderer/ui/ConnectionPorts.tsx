import { PORTS, type Port, portPoint } from '../engine/ports';
import type { Box } from '../engine/types';

export function ConnectionPorts({
  id,
  box,
  zoom,
  target,
  onStart,
  onKeyboard,
  onHover,
  onFocus,
}: {
  id: string;
  box: Box;
  zoom: number;
  target?: Port;
  onStart(e: React.PointerEvent, id: string, port: Port): void;
  onKeyboard(id: string, port: Port): void;
  onHover(id: string): void;
  onFocus(id: string, port: Port): void;
}) {
  return PORTS.map((port) => {
    const point = portPoint(box, port);
    return (
      <button
        key={port}
        type="button"
        className={`connection-port${target === port ? ' target' : ''}`}
        data-id={id}
        data-port={port}
        title={`Drag from ${port} to connect`}
        aria-label={`Connect ${id} from ${port}`}
        style={{ left: point.x, top: point.y, transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
        onPointerDown={(e) => onStart(e, id, port)}
        onPointerEnter={() => onHover(id)}
        onFocus={() => onFocus(id, port)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          e.stopPropagation();
          onKeyboard(id, port);
        }}
      >
        <span className="port-dot" />
      </button>
    );
  });
}

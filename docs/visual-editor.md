# Visual editor

Choose **Icons** in the left sidebar to search the icon catalog or browse All, AWS, Azure, Google Cloud, and General categories. Search accepts aliases such as `s3`, `postgres`, and `lambda`. Drag a tile onto the canvas to place it, or click it (Enter also works) to add it at the center of the visible canvas. More icons load as you scroll.

Choose **Code** to edit the same diagram as JSON. Switching tabs preserves the current code draft and icon search. Arrow keys switch tabs without changing selected diagram elements. Either sidebar can collapse to leave more room for the canvas.

Hover over or select an icon to reveal eight connection points: four corners and four side midpoints. Drag a point to a point on another icon, or onto its body to snap to the nearest connection point. The preview follows your pointer and highlights the target. Escape, an empty-canvas drop, or a cancelled pointer gesture discards the connection. Keyboard users can focus a point and press Enter or Space, then focus and activate a target point; Escape cancels.

Dropped icons join the smallest containing group. Dragging them outside detaches them from that group. Placement follows the current canvas zoom and pan; dropping beyond the coordinate origin keeps elements at the intended screen position. Each addition or connection is one Undo step. Exact duplicate connections and self-connections are ignored. The resize grip sits outside the bottom-right connection point.

Connections keep their chosen points when icons move or resize and when diagrams are saved, reopened, or exported to PNG/SVG. Corner port names (`top-left`, `top-right`, `bottom-left`, `bottom-right`) extend this application's Relationship schema; external tools using the unmodified Eraser schema may reject those JSON fields. Existing four-side and automatic connections remain supported.

The app's existing icon-source setting applies to palette thumbnails and diagram icons. Unavailable icons can appear as placeholders when hosted icons are disabled and the local cache lacks the selected icon.

# Visual icon editor

User intent: build diagrams directly with a searchable left-side icon palette, while retaining code editing, and drag connectors from eight points on each square icon. Interaction should feel immediate and connections should stay attached.

- The left sidebar has Icons and Code tabs and retains the existing collapse control. Icons is the initial view. Keep the code editor mounted so switching tabs preserves its text and selection. AI validation drafts open Code.
- Reuse the installed icon catalog, aliases, cache and `icons://` loader. Show popular icons, cloud-provider categories and the complete searchable list. Load thumbnails lazily and grow the result list in batches during scrolling. Retain search when switching tabs.
- Native palette dragging provides an icon preview. Drop positions account for canvas zoom/pan, center the new 48px icon under the pointer, join the smallest containing group, and remain compatible with positive-coordinate documents. A drop commits one Undo step. Click/Enter can also add an icon at canvas center.
- Each icon exposes four corners and four side midpoints on hover/selection. Connection dragging previews a line immediately, highlights the target/nearest port, snaps body drops to that port, and cancels on Escape, pointer cancellation or empty space. Avoid self-links and exact duplicate port pairs. Keep resizing available without overlapping the bottom-right connector.
- Persist precise attachment choices as `fromPort`/`toPort`; extend the app's Relationship schema with the four corner names. Reuse the existing Eraser corridor router's relative-port support rather than invent routing. Render/export with the same adapter so ports survive moves, resizing, save/reopen and export. Existing diagrams remain readable.
- Preserve the current Inter UI type, dark chrome, hairline borders and lavender focus/selection accent. A dense icon grid is the main visual content; no extra decorative surfaces. Match light/dark canvas themes for connection handles.
- No new rendering engine, icon provider, collaboration backend or unrelated persistence fixes.

Acceptance: searchable/browsable palette, native drag/drop with transformed coordinates, group drops, cancelled drags, tab/draft preservation, eight real anchors, connections following moved/resized icons, Undo/Redo, save/reopen, PNG/SVG export, and current unit/desktop regressions passing.

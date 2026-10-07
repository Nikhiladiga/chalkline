import type { CodeProject, ProjectScan } from '../../shared/project';

export function CodeFolder({
  project,
  scan,
  busy,
  choose,
  rescan,
}: {
  project: CodeProject | null;
  scan: ProjectScan | null;
  busy: boolean;
  choose(): void;
  rescan(): void;
}) {
  return (
    <div className="code-folder" data-testid="code-folder">
      <div className="row">
        <span className="code-folder-name" title={project?.name}>
          {project?.name ?? 'Choose a project to map'}
        </span>
        <button type="button" className="btn secondary" disabled={busy} onClick={choose}>
          {project ? 'Change folder' : 'Choose folder'}
        </button>
      </div>
      <p className="muted">
        Scans source locally. Generate sends selected excerpts to your chosen provider. Dependencies,
        credentials and ignored files are skipped.
      </p>
      {scan && (
        <>
          <div className="row code-folder-coverage">
            <span>
              {scan.filesRead} of {scan.filesFound} eligible files read; {scan.filesIncluded} in model
              context.
            </span>
            <button type="button" className="btn secondary" disabled={busy} onClick={rescan}>
              Rescan
            </button>
          </div>
          {scan.limited && (
            <p className="code-folder-limited">
              Partial evidence — the diagram may omit uninspected components.
            </p>
          )}
          <details className="code-folder-details">
            <summary>Scan details</summary>
            {scan.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
            <ul>
              {scan.paths.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
            {scan.filesRead > scan.paths.length && <p>Showing the first {scan.paths.length} paths.</p>}
          </details>
        </>
      )}
    </div>
  );
}

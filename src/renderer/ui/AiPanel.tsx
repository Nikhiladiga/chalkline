import { useCallback, useEffect, useRef, useState } from 'react';
import aliases from '../../../icons/aliases.json';
import names from '../../../icons/names.json';
import type { PublicSettings } from '../../shared/ipc';
import type { CodeProject, ProjectScan } from '../../shared/project';
import { type AiResult, runAi } from '../ai/pipeline';
import { useDoc } from '../doc/store';
import { getResolver, render, validate } from '../engine/engine';
import { applyTheme } from '../engine/theme';
import type { Doc } from '../engine/types';
import { ipcMessage } from './actions';
import { CodeFolder } from './CodeFolder';
import { IconRefresh } from './icons';
import { mod } from './platform';
import { requestFit, useUi } from './uiStore';

type Outcome = (AiResult & { mode: 'generate' | 'edit' }) | null;

export function AiPanel() {
  const hasDoc = useDoc((s) => s.doc.entities.length > 0);
  const [modeNow, setMode] = useState<'generate' | 'edit'>(hasDoc ? 'edit' : 'generate');
  const mode = modeNow;
  const [prompt, setPrompt] = useState('');
  const [source, setSource] = useState<'description' | 'folder'>('description');
  const [project, setProject] = useState<CodeProject | null>(null);
  const [scan, setScan] = useState<ProjectScan | null>(null);
  const active = useRef<{ id: string; cancelled: boolean } | null>(null);
  const [allowMove, setAllowMove] = useState(false);
  const [running, setRunning] = useState<{ id: string; stage: string; chars: number } | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [aiDoc, setAiDoc] = useState<Doc | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const modelRequest = useRef(0);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const docNow = useDoc((s) => s.doc);
  const lastHasDoc = useRef(hasDoc);

  // Follow the document: an empty canvas means Generate; the first diagram switches to Edit.
  useEffect(() => {
    if (hasDoc !== lastHasDoc.current) setMode(hasDoc ? 'edit' : 'generate');
    lastHasDoc.current = hasDoc;
  }, [hasDoc]);

  const refresh = useCallback(async () => {
    const request = ++modelRequest.current;
    setLoadingModels(true);
    try {
      const s: PublicSettings = await window.api.invoke('settings:get');
      if (request !== modelRequest.current) return;
      setSettings(s);
      const list: string[] = await window.api.invoke('llm:models');
      if (request !== modelRequest.current) return;
      setModels(list);
      setConnError(null);
      if (!s.model && list[0]) {
        const saved = await window.api.invoke('settings:set', { model: list[0] });
        setSettings(saved);
      }
    } catch (e) {
      if (request !== modelRequest.current) return;
      setModels([]);
      setConnError(ipcMessage(e));
    } finally {
      if (request === modelRequest.current) setLoadingModels(false);
    }
  }, []);
  useEffect(() => {
    if (!settingsOpen) void refresh();
  }, [settingsOpen, refresh]);

  const checkStopped = (id: string) => {
    if (active.current?.id !== id || active.current.cancelled) throw new Error('Stopped.');
  };
  const readProject = async (
    selected: CodeProject,
    id: string,
    prefs: PublicSettings,
  ): Promise<ProjectScan> => {
    checkStopped(id);
    setRunning({ id, stage: 'scanning code folder', chars: 0 });
    const snapshot: ProjectScan = await window.api.invoke('project:scan', {
      projectId: selected.id,
      id,
      maxChars: Math.max(4000, Math.min(120000, (prefs.contextSize - 6000) * 2)),
    });
    checkStopped(id);
    setScan(snapshot);
    return snapshot;
  };
  const previewProject = async (choose: boolean) => {
    if (active.current) return;
    const id = crypto.randomUUID();
    active.current = { id, cancelled: false };
    setRunning({ id, stage: choose ? 'choosing code folder' : 'scanning code folder', chars: 0 });
    setOutcome(null);
    try {
      const selected: CodeProject | null = choose ? await window.api.invoke('project:choose') : project;
      checkStopped(id);
      if (!selected) return;
      setProject(selected);
      setScan(null);
      await readProject(selected, id, settings ?? (await window.api.invoke('settings:get')));
    } catch (e) {
      setOutcome({
        ok: false,
        message: active.current?.cancelled ? 'Stopped.' : ipcMessage(e),
        errors: [],
        mode,
      });
    } finally {
      active.current = null;
      setRunning(null);
    }
  };

  const run = async () => {
    const text = prompt.trim();
    if (active.current || (source === 'folder' ? !project : !text)) return;
    const id = crypto.randomUUID();
    active.current = { id, cancelled: false };
    setRunning({ id, stage: 'generating', chars: 0 });
    setOutcome(null);
    const off = window.api.on('llm:chunk', (c: { id: string; text: string }) => {
      if (c.id === id) setRunning((r) => (r ? { ...r, chars: r.chars + c.text.length } : r));
    });
    const current = useDoc.getState().doc;
    const currentRevision = useDoc.getState().revision;
    try {
      const resolver = await getResolver();
      const s = settings ?? (await window.api.invoke('settings:get'));
      checkStopped(id);
      const snapshot = source === 'folder' && project ? await readProject(project, id, s) : null;
      const result = await runAi(
        {
          chat: async (messages, schema) => {
            checkStopped(id);
            setRunning((r) => (r ? { ...r, chars: 0 } : r));
            try {
              return await window.api.invoke('llm:chat', {
                id,
                messages,
                schema: schema as Record<string, unknown>,
              });
            } catch (e) {
              throw new Error(ipcMessage(e));
            }
          },
          validate,
          measure: async (d) => {
            checkStopped(id);
            // A newer render (user editing meanwhile) can skip ours; try again.
            for (let i = 0; i < 3; i++) {
              const r = await render(applyTheme(d, useUi.getState().theme));
              checkStopped(id);
              if (r.ok) return r.painted;
              if (!r.stale) return null;
            }
            return null;
          },
          names,
          aliases,
          schemaOf: (tag) => resolver.tagSchema(tag),
          maxRepairs: s.maxRepairs,
          onStage: (stage) => setRunning((r) => (r ? { ...r, stage } : r)),
        },
        {
          mode,
          prompt: text || `Map the runtime architecture of ${project?.name ?? 'this project'}.`,
          current,
          allowMove,
          sourceContext: snapshot?.context,
        },
      );
      checkStopped(id);
      const changed = useDoc.getState().revision !== currentRevision;
      if (
        result.ok &&
        (changed || useDoc.getState().codeDraft !== null) &&
        !window.confirm(
          'The diagram or code changed. Replace it with the AI result? Diagram changes stay in undo history; any code draft will be discarded.',
        )
      ) {
        setOutcome({
          ok: false,
          message: 'AI result not applied: the diagram changed while it was running.',
          errors: [],
          mode,
        });
        return;
      }
      if (result.ok) {
        useUi.getState().set({ draft: null });
        useDoc.getState().discardCodeDraft();
        const next = current.title ? { title: current.title, ...result.doc } : result.doc;
        useDoc.getState().commit(next);
        setAiDoc(next);
        if (mode === 'generate') requestFit();
        setPrompt('');
      } else if (result.draft) {
        if (changed || useDoc.getState().codeDraft !== null) {
          setOutcome({
            ...result,
            message: `${result.message} Your newer code and diagram were kept.`,
            mode,
          });
          return;
        }
        useDoc.getState().setCodeDraft(result.draft);
        useUi.getState().set({ draft: result.draft, showCode: true, leftMode: 'code' });
      }
      setOutcome({ ...result, mode });
    } catch (e) {
      setOutcome({
        ok: false,
        message: active.current?.cancelled ? 'Stopped.' : ipcMessage(e),
        errors: [],
        mode,
      });
    } finally {
      off();
      active.current = null;
      setRunning(null);
      // measure() may have replaced the visible scene with an intermediate one.
      useUi.getState().set({ renderTick: useUi.getState().renderTick + 1 });
    }
  };

  const stop = () => {
    if (!active.current) return;
    active.current.cancelled = true;
    void window.api.invoke('llm:cancel', active.current.id);
  };
  const model = settings?.model ?? '';

  return (
    <div className="section" data-testid="ai-panel">
      <div className="progress" data-running={running ? '' : undefined} aria-hidden="true" />
      <div className="section-head">
        <span className="section-title">AI</span>
        <div className="seg" role="tablist" aria-label="AI mode" data-active={mode === 'edit' ? 1 : 0}>
          <button
            type="button"
            onClick={() => setMode('generate')}
            role="tab"
            aria-selected={mode === 'generate'}
          >
            New
          </button>
          <button
            type="button"
            onClick={() => setMode('edit')}
            role="tab"
            aria-selected={mode === 'edit'}
            disabled={!hasDoc}
          >
            Edit
          </button>
        </div>
      </div>
      <label className="ai-source">
        Source
        <select
          className="select"
          aria-label="Diagram source"
          value={source}
          disabled={Boolean(running)}
          onChange={(e) => {
            setSource(e.target.value as 'description' | 'folder');
            setOutcome(null);
          }}
        >
          <option value="description">Description</option>
          <option value="folder">Code folder</option>
        </select>
      </label>
      {source === 'folder' && (
        <CodeFolder
          project={project}
          scan={scan}
          busy={Boolean(running)}
          choose={() => void previewProject(true)}
          rescan={() => void previewProject(false)}
        />
      )}
      <textarea
        className="textarea prompt"
        data-testid="ai-prompt"
        placeholder={
          source === 'folder'
            ? 'Optional focus: “trace API requests and database writes”'
            : mode === 'edit'
              ? 'Describe the change: “add a Redis cache between the API and the database”'
              : 'Describe a diagram: “AWS serverless API: API Gateway, Lambda, DynamoDB and S3 inside a VPC”'
        }
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void run();
          }
        }}
      />
      {mode === 'edit' && (
        <label className="check">
          <input type="checkbox" checked={allowMove} onChange={(e) => setAllowMove(e.target.checked)} />
          Allow AI to move existing elements
        </label>
      )}
      <div className="ai-actions">
        <select
          className="select"
          aria-label="Model"
          disabled={loadingModels || Boolean(running)}
          value={model}
          onChange={async (e) =>
            setSettings(await window.api.invoke('settings:set', { model: e.target.value }))
          }
        >
          {!models.includes(model) && <option value={model}>{model || 'No model'}</option>}
          {models.map((m) => (
            <option key={m} value={m}>
              {m === 'default' ? 'CLI default' : m}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn icon secondary"
          aria-label="Refresh models"
          disabled={loadingModels || Boolean(running)}
          onClick={() => void refresh()}
        >
          {loadingModels ? <span className="spinner" /> : <IconRefresh />}
        </button>
        {running ? (
          <button type="button" className="btn secondary" onClick={stop}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            data-testid="ai-run"
            onClick={() => void run()}
            disabled={source === 'folder' ? !project : !prompt.trim()}
          >
            {mode === 'edit' ? 'Apply' : 'Generate'}
            <span className="kbd" aria-hidden="true">
              {mod}↵
            </span>
          </button>
        )}
      </div>
      {running && (
        <div className="stage-line" aria-live="polite">
          <span className="spinner" />
          {running.stage[0]!.toUpperCase() + running.stage.slice(1)}
          {running.stage === 'generating' || running.stage.startsWith('repairing')
            ? ` · ${running.chars} chars`
            : ''}
        </div>
      )}
      {connError && !running && (
        <div className="note bad">
          {connError}{' '}
          <button type="button" className="btn" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}
      {outcome && !running && (
        <div className={`note ${outcome.ok ? 'ok' : 'bad'}`} data-testid="ai-outcome">
          {outcome.ok ? (
            <>
              {outcome.mode === 'edit'
                ? 'Diagram updated.'
                : outcome.laidOut
                  ? 'Diagram generated, then auto-laid out to remove overlaps.'
                  : 'Diagram generated.'}
              {(outcome.fixes.length > 0 || outcome.warnings.length > 0) && (
                <ul>
                  {outcome.fixes.map((f) => (
                    <li key={f}>Icon fixed: {f}</li>
                  ))}
                  {outcome.warnings.slice(0, 6).map((w) => (
                    <li key={`${w.code}${w.path}`}>{w.message}</li>
                  ))}
                </ul>
              )}
              <div className="note-actions">
                {aiDoc && docNow === aiDoc && (
                  <button type="button" className="btn secondary" onClick={() => useDoc.getState().undo()}>
                    Undo AI change
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              {outcome.message}
              {outcome.errors.length > 0 && (
                <ul>
                  {outcome.errors.slice(0, 5).map((e) => (
                    <li key={`${e.code}${e.path}`}>
                      {e.code} {e.path}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

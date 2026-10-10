import { json, jsonLanguage } from '@codemirror/lang-json';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { type Diagnostic, lintGutter, setDiagnostics } from '@codemirror/lint';
import { Annotation, Compartment } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { type ParseError, parse as parseLoose, printParseErrorCode } from 'jsonc-parser';
import { useEffect, useRef } from 'react';
import names from '../../../icons/names.json';
import { toSplit } from '../ai/parse';
import { useDoc } from '../doc/store';
import { getResolver, validate } from '../engine/engine';
import type { Doc } from '../engine/types';
import { diagramCompletions } from './completions';
import { pointerRange } from './pointer';
import { useUi } from './uiStore';

const External = Annotation.define<boolean>();

// Colours come from the chrome tokens, so the editor follows the theme toggle.
const highlight = HighlightStyle.define([
  { tag: t.propertyName, color: 'var(--syn-prop)' },
  { tag: t.string, color: 'var(--ink-muted)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--syn-num)' },
  { tag: t.punctuation, color: 'var(--syn-punct)' },
]);

const theme = EditorView.theme({
  '.cm-tooltip': {
    background: 'var(--s4)',
    border: '1px solid var(--hairline-strong)',
    borderRadius: 'var(--r-md)',
    boxShadow: 'var(--e2)',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--mono)',
    maxHeight: '18em',
    minWidth: '220px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '3px 10px', color: 'var(--ink-muted)' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    background: 'var(--accent-soft)',
    color: 'var(--ink)',
  },
  '.cm-completionDetail': { color: 'var(--ink-subtle)', fontStyle: 'normal', marginLeft: '12px' },
  '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--syn-prop)', fontWeight: '600' },
});
// CodeMirror's base styles (cursor, panels) pick light or dark from this facet.
const darkMode = new Compartment();

// Schema-aware suggestions: tags, properties, enum values, colors, icons, ids, element templates.
let resolver: Awaited<ReturnType<typeof getResolver>> | null = null;
void getResolver().then((r) => (resolver = r));
const completions = jsonLanguage.data.of({
  autocomplete: diagramCompletions({ schemaOf: (tag) => resolver?.tagSchema(tag), icons: names }),
});

const stringify = (doc: Doc) => JSON.stringify(doc, null, 2);

async function lint(view: EditorView, text: string): Promise<void> {
  const revision = useDoc.getState().revision;
  const errors: ParseError[] = [];
  const parsed = parseLoose(text, errors, { allowTrailingComma: false, disallowComments: true });
  if (errors.length) {
    const e = errors[0]!;
    view.dispatch(
      setDiagnostics(view.state, [
        {
          from: e.offset,
          to: e.offset + e.length,
          severity: 'error',
          message: `JSON: ${printParseErrorCode(e.error)}`,
        },
      ]),
    );
    return;
  }
  const v = await validate(parsed);
  if (view.state.doc.toString() !== text) return; // stale
  if (useDoc.getState().revision !== revision) return;
  const diags: Diagnostic[] = [...v.errors, ...v.warnings].map((i) => {
    const r = pointerRange(text, i.path);
    return {
      from: r.from,
      to: r.to,
      severity: i.severity === 'warning' || !v.errors.includes(i) ? 'warning' : 'error',
      message: `${i.code}: ${i.message}${i.suggestion ? ` (did you mean "${i.suggestion}"?)` : ''}`,
    };
  });
  view.dispatch(setDiagnostics(view.state, diags));
  if (v.ok) {
    const doc = toSplit(parsed);
    const withTitle =
      typeof (parsed as Doc).title === 'string' ? { title: (parsed as Doc).title, ...doc } : doc;
    const store = useDoc.getState();
    store.acceptCodeDraft(withTitle, text, revision);
  }
}

export function CodePane({ active = true }: { active?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const uiTheme = useUi((s) => s.theme);
  const codeDraft = useDoc((s) => s.codeDraft);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const view = new EditorView({
      parent: host.current!,
      doc: useDoc.getState().codeDraft ?? stringify(useDoc.getState().doc),
      extensions: [
        basicSetup,
        json(),
        completions,
        lintGutter(),
        syntaxHighlighting(highlight),
        theme,
        darkMode.of(EditorView.darkTheme.of(useUi.getState().theme === 'dark')),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (!u.docChanged || u.transactions.some((tr) => tr.annotation(External))) return;
          useDoc.getState().setCodeDraft(view.state.doc.toString());
          clearTimeout(timer);
          timer = setTimeout(() => void lint(view, view.state.doc.toString()), 300);
        }),
      ],
    });
    viewRef.current = view;
    // A tab coming back with an unfinished draft shows its diagnostics again (and accepts it if now valid).
    const pending = useDoc.getState().codeDraft;
    if (pending !== null) void lint(view, pending);

    const sync = (text: string) => {
      const cur = view.state.doc.toString();
      if (cur === text) return;
      const head = Math.min(view.state.selection.main.head, text.length);
      view.dispatch({
        changes: { from: 0, to: cur.length, insert: text },
        selection: { anchor: head },
        annotations: External.of(true),
      });
    };
    const unsub = useDoc.subscribe((s, prev) => {
      if (s.codeDraft !== null) {
        if (view.state.doc.toString() !== s.codeDraft) {
          sync(s.codeDraft);
          void lint(view, s.codeDraft);
        }
        return;
      }
      if (s.doc === prev.doc && s.codeDraft === prev.codeDraft && s.session === prev.session) return;
      // Skip when the editor already holds this document (the edit came from here).
      try {
        if (JSON.stringify(toSplit(JSON.parse(view.state.doc.toString()))) === JSON.stringify(toSplit(s.doc)))
          return;
      } catch {}
      sync(stringify(s.doc));
      view.dispatch(setDiagnostics(view.state, []));
    });
    return () => {
      unsub();
      clearTimeout(timer);
      view.destroy();
    };
  }, []);

  useEffect(() => {
    if (active) viewRef.current?.requestMeasure();
  }, [active]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: darkMode.reconfigure(EditorView.darkTheme.of(uiTheme === 'dark')),
    });
  }, [uiTheme]);

  return (
    <>
      {codeDraft !== null && (
        <div className="draft-bar">
          <span className="grow">Code draft. Fix errors before saving, or discard it.</span>
          <button type="button" className="btn" onClick={() => useDoc.getState().discardCodeDraft()}>
            Discard
          </button>
        </div>
      )}
      <div className="code-host" ref={host} data-testid="code-pane" />
    </>
  );
}

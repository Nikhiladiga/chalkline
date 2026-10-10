import type { ChatMsg } from '../../shared/ipc';
import type { Box, Doc, Issue } from '../engine/types';
import { autoLayout } from '../layout/elk';
import { checkLayout } from '../layout/quality';
import { fixIcons } from './iconFix';
import { fitContainers, mergePositions, placeNew } from './merge';
import { extractJson, toSplit } from './parse';
import { buildMessages, iconSubset, RESPONSE_SCHEMA } from './prompt';

export interface AiDeps {
  /** `attempt` 0 is the first call; repairs (≥ 1) must stay isolated. */
  chat(messages: ChatMsg[], schema: object, attempt: number): Promise<string>;
  validate(doc: unknown): Promise<{ ok: boolean; errors: Issue[]; warnings: Issue[] }>;
  /** Render and return painted footprints (box + spilled text), or null when it does not render. */
  measure(doc: Doc): Promise<Record<string, Box> | null>;
  names: string[];
  aliases: Record<string, string>;
  schemaOf(tag: string): any;
  maxRepairs: number;
  onStage(stage: string): void;
}

export interface AiRequest {
  mode: 'generate' | 'edit';
  prompt: string;
  current: Doc;
  allowMove: boolean;
  sourceContext?: string;
  /** Deep scan: the CLI reads the folder itself; no excerpts are sent. */
  deep?: boolean;
  /** Provider id; only used to word the deep-scan budget. */
  provider?: string;
  /** Deep scan only: folder preview text used to choose icon sets; never sent to the model. */
  iconHint?: string;
}

export type AiResult =
  | { ok: true; doc: Doc; fixes: string[]; warnings: Issue[]; laidOut: boolean }
  | { ok: false; message: string; draft?: string; errors: Issue[] };

const ROUTE_KEYS = ['points', 'labelPlacement', 'x', 'y'];

function repairMessage(errors: Issue[]): string {
  if (errors[0]?.code === 'E_JSON') {
    return `${errors[0].message} Reply with ONLY the complete diagram as one JSON object {"entities":[...],"connections":[...]}.`;
  }
  const lines = errors.slice(0, 10).map((e) => `${e.code} ${e.path} ${e.message}`);
  return `The diagram has these errors:\n${lines.join('\n')}\n\nReturn the full corrected document as one JSON object.`;
}

const REMOVAL = /\b(remove|delete|drop|without|get rid|replace|merge|simplify|only)\b/i;

/** Catch replies that validate but would wipe the user's work. */
function completeness(doc: Doc, req: AiRequest): Issue[] {
  if (!doc.entities.length) {
    return [
      {
        code: 'E_EMPTY',
        path: '/entities',
        message: 'The diagram has no entities. Return the complete diagram.',
      },
    ];
  }
  if (req.mode !== 'edit' || req.sourceContext || req.deep || REMOVAL.test(req.prompt)) return [];
  const kept = new Set(doc.entities.map((e) => e.id));
  const dropped = req.current.entities.map((e) => e.id).filter((id) => !kept.has(id));
  if (dropped.length <= Math.max(1, req.current.entities.length * 0.3)) return [];
  return [
    {
      code: 'E_DROPPED',
      path: '/entities',
      message: `These existing elements are missing: ${dropped.join(', ')}. Return the COMPLETE diagram including every existing element.`,
    },
  ];
}

export async function runAi(deps: AiDeps, req: AiRequest): Promise<AiResult> {
  const messages = buildMessages(
    req.mode,
    req.prompt,
    req.current,
    iconSubset(req.prompt + (req.sourceContext ?? (req.deep ? req.iconHint : '') ?? ''), deps.names),
    deps.schemaOf,
    req.sourceContext,
    req.deep,
    req.provider,
  );
  let best: { text: string; doc?: Doc; errors: Issue[] } | undefined;
  let good: { doc: Doc; fixes: string[]; warnings: Issue[] } | undefined;

  for (let attempt = 0; attempt <= deps.maxRepairs && !good; attempt++) {
    deps.onStage(attempt === 0 ? 'generating' : `repairing ${attempt}/${deps.maxRepairs}`);
    let text: string;
    try {
      text = await deps.chat([...messages], RESPONSE_SCHEMA, attempt);
    } catch (e) {
      return { ok: false, message: (e as Error).message, errors: [] };
    }
    deps.onStage('validating');
    let doc: Doc | undefined;
    let errors: Issue[];
    try {
      doc = toSplit(extractJson(text));
      // Model-authored routes are guesses; the router does better.
      for (const c of doc.connections) for (const k of ROUTE_KEYS) delete c[k];
      const fixed = fixIcons(doc, deps.names, deps.aliases, req.mode === 'edit' ? req.current : undefined);
      doc = fixed.doc;
      const v = await deps.validate(doc);
      errors = [...v.errors, ...completeness(doc, req)];
      if (!errors.length) good = { doc, fixes: fixed.fixes, warnings: v.warnings };
    } catch (e) {
      errors = [{ code: 'E_JSON', path: '', message: (e as Error).message }];
    }
    if (!best || errors.length < best.errors.length) best = { text, doc, errors };
    if (!good)
      messages.push(
        // A 60-node diagram passes 20k chars; a cut-off draft cannot be repaired.
        { role: 'assistant', content: text.slice(0, 100_000) },
        { role: 'user', content: repairMessage(errors) },
      );
  }

  if (!good) {
    const b = best!;
    return {
      ok: false,
      message: `The model's diagram still has ${b.errors.length} error(s) after ${deps.maxRepairs} repair attempt(s). The best attempt is in the code pane.`,
      draft: b.doc ? JSON.stringify(b.doc, null, 2) : b.text,
      errors: b.errors,
    };
  }

  deps.onStage('rendering');
  let doc = req.mode === 'edit' ? mergePositions(req.current, good.doc, req.allowMove) : good.doc;
  let laidOut = false;
  const boxes = await deps.measure(doc);
  if (boxes) {
    const q = checkLayout(doc, boxes);
    const messy = q.overlaps.length > 0 || q.outside.length > 0;
    // A new deep diagram is too dense for model-picked coordinates: always lay it out.
    const deepNew = req.deep && req.mode === 'generate';
    if ((messy || deepNew) && (req.mode === 'generate' || req.allowMove)) {
      deps.onStage(messy ? 'layout fallback' : 'auto-layout');
      doc = await autoLayout(doc, boxes, { deep: req.deep });
      laidOut = messy;
    } else if (messy) {
      const before = new Set(req.current.entities.map((e) => e.id));
      doc = placeNew(
        doc,
        boxes,
        doc.entities.filter((e) => !before.has(e.id)).map((e) => e.id),
      );
      const after = await deps.measure(doc);
      if (after) doc = fitContainers(doc, after);
    }
  }
  return { ok: true, doc, fixes: good.fixes, warnings: good.warnings, laidOut };
}

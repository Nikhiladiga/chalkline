import { useEffect, useRef, useState } from 'react';
import { getPrimaryText, setPrimaryText, setProp } from '../doc/ops';
import { useDoc } from '../doc/store';
import { tagSchema } from '../engine/engine';
import { deleteSelection } from './actions';
import { IconTrash } from './icons';
import { type Field, fieldsFor } from './schemaFields';
import { useUi } from './uiStore';

const TOKENS: [string, string][] = [
  ['white', '#ffffff'],
  ['yellow', '#fde68a'],
  ['green', '#bbf7d0'],
  ['blue', '#bfdbfe'],
  ['purple', '#ddd6fe'],
  ['red', '#fecaca'],
  ['orange', '#fed7aa'],
  ['black', '#3f3f46'],
];
const PALETTE_KEYS = new Set(['color']);

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (field.kind === 'enum') {
    return (
      <select
        className="select"
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">
          {field.default !== undefined ? `Default (${String(field.default)})` : 'None'}
        </option>
        {field.options!.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={Boolean(value ?? field.default)}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (field.kind === 'icon') {
    return (
      <div className="row">
        {typeof value === 'string' && (
          <span className="icon-thumb">
            <img src={`icons://i/${value}.svg`} alt="" />
          </span>
        )}
        <button
          type="button"
          className="btn secondary"
          onClick={() => useUi.getState().set({ iconPick: (n) => onChange(n) })}
        >
          {typeof value === 'string' ? value : 'Choose icon'}
        </button>
        {typeof value === 'string' && (
          <button type="button" className="btn" onClick={() => onChange(undefined)}>
            Remove
          </button>
        )}
      </div>
    );
  }
  const text = value === undefined ? '' : String(value);
  return (
    <>
      {field.kind === 'color' && PALETTE_KEYS.has(field.key) && (
        <div className="swatches">
          {TOKENS.map(([token, hex]) => (
            <button
              key={token}
              type="button"
              title={token}
              aria-label={token}
              className={`swatch${value === token ? ' on' : ''}`}
              style={{ background: hex }}
              onClick={() => onChange(value === token ? undefined : token)}
            />
          ))}
        </div>
      )}
      <Draft
        value={text}
        placeholder={
          field.kind === 'color'
            ? 'CSS color, e.g. #4a6fa5'
            : field.default !== undefined
              ? String(field.default)
              : ''
        }
        onCommit={(v) => onChange(v === '' ? undefined : field.kind === 'number' ? Number(v) : v)}
        type={field.kind === 'number' ? 'number' : 'text'}
      />
    </>
  );
}

/** Text input that commits on blur/Enter, so typing is one undo step. */
function Draft({
  value,
  onCommit,
  placeholder,
  type = 'text',
  multiline,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  type?: string;
  multiline?: boolean;
}) {
  const [v, setV] = useState(value);
  // Last value known to be in the document; guards against committing the same text twice.
  const saved = useRef(value);
  const latest = useRef({ v, onCommit });
  latest.current = { v, onCommit };
  useEffect(() => {
    saved.current = value;
    setV(value);
  }, [value]);
  const commit = () => {
    if (latest.current.v === saved.current) return;
    saved.current = latest.current.v;
    latest.current.onCommit(latest.current.v);
  };
  // Clicking the canvas unmounts the inspector before blur fires: keep the typed text.
  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount-only; reads refs.
  useEffect(() => commit, []);
  const props = {
    className: multiline ? 'textarea short' : 'input',
    value: v,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
        e.preventDefault();
        commit();
      }
    },
  };
  return multiline ? <textarea {...props} rows={2} /> : <input {...props} type={type} />;
}

export function Inspector() {
  const doc = useDoc((s) => s.doc);
  const selection = useDoc((s) => s.selection);
  const entity =
    selection.entities.length === 1 ? doc.entities.find((e) => e.id === selection.entities[0]) : undefined;
  const connIdx = !entity && selection.connections.length === 1 ? selection.connections[0]! : undefined;
  const conn = connIdx !== undefined ? doc.connections[connIdx] : undefined;
  const tag = entity?.tag ?? conn?.tag ?? (conn ? 'Relationship' : undefined);
  const [fields, setFields] = useState<Field[]>([]);
  useEffect(() => {
    if (tag) void tagSchema(tag).then((s) => setFields(fieldsFor(s)));
  }, [tag]);

  const count = selection.entities.length + selection.connections.length;
  if (!count) return null;
  if (!entity && !conn) {
    return (
      <div className="section">
        <div className="row">
          <span className="grow">{count} selected</span>
          <button type="button" className="btn" onClick={deleteSelection}>
            <IconTrash />
            Delete
          </button>
        </div>
      </div>
    );
  }
  const target = (entity ?? conn)!;
  const ref = entity ? { entity: entity.id } : { connection: connIdx! };
  const update = (key: string, value: unknown) => {
    const s = useDoc.getState();
    s.commit(setProp(s.doc, ref, key, value));
  };
  const hasText = entity && entity.tag !== 'Legend';

  return (
    <div className="section" data-testid="inspector" key={entity ? `e:${entity.id}` : `c:${connIdx}`}>
      <div className="section-head">
        <span className="section-title">
          {tag} <span className="muted">{entity ? entity.id : `${conn!.from} → ${conn!.to}`}</span>
        </span>
        <button
          type="button"
          className="btn icon"
          aria-label="Delete"
          title="Delete"
          onClick={deleteSelection}
        >
          <IconTrash />
        </button>
      </div>
      {hasText && (
        <div className="field">
          <span>Text</span>
          <Draft
            multiline
            value={getPrimaryText(entity)}
            onCommit={(v) => {
              const s = useDoc.getState();
              s.commit(setPrimaryText(s.doc, entity.id, v));
            }}
          />
        </div>
      )}
      {fields.map((f) => (
        <div className="field" key={f.key}>
          <span>{f.key}</span>
          <FieldInput field={f} value={target[f.key]} onChange={(v) => update(f.key, v)} />
        </div>
      ))}
    </div>
  );
}

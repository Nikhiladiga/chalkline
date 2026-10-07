import { useEffect, useMemo, useRef, useState } from 'react';
import { insertIconAtCenter } from './actions';
import { findIcons, ICON_MIME, type IconCategory, iconCategories, iconNames } from './iconCatalog';

const BATCH = 48;

export function IconPalette() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<IconCategory>('all');
  const [limit, setLimit] = useState(BATCH);
  const results = useMemo(() => findIcons(query, category), [query, category]);
  const scroll = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const reset = () => {
    setLimit(BATCH);
    if (scroll.current) scroll.current.scrollTop = 0;
  };
  useEffect(() => {
    if (!more.current || limit >= results.length) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setLimit((n) => n + BATCH);
      },
      { root: scroll.current, rootMargin: '120px' },
    );
    observer.observe(more.current);
    return () => observer.disconnect();
  }, [limit, results]);

  return (
    <div className="icon-palette" data-testid="icon-palette">
      <div className="palette-search">
        <input
          className="input"
          type="search"
          aria-label="Search icons"
          placeholder={`Search ${iconNames.length.toLocaleString()} icons`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            reset();
          }}
        />
        <select
          className="select"
          aria-label="Browse icons"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as IconCategory);
            reset();
          }}
        >
          {Object.entries(iconCategories).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <div className="palette-summary">
          <span>Drag onto the canvas</span>
          <span>
            {results.length.toLocaleString()} {results.length === 1 ? 'icon' : 'icons'}
          </span>
        </div>
      </div>
      <div className="palette-results" ref={scroll}>
        <div className="palette-grid">
          {results.slice(0, limit).map((name) => (
            <button
              key={name}
              type="button"
              className="palette-cell"
              draggable
              data-icon={name}
              aria-label={`Add ${name}`}
              title={`${name} — drag to place, or click to add`}
              onDragStart={(e) => {
                e.dataTransfer.setData(ICON_MIME, name);
                e.dataTransfer.effectAllowed = 'copy';
                const img = e.currentTarget.querySelector('img');
                if (img?.complete && img.naturalWidth)
                  e.dataTransfer.setDragImage(img, img.clientWidth / 2, img.clientHeight / 2);
              }}
              onClick={() => insertIconAtCenter(name)}
            >
              <span className="palette-thumbnail">
                <img
                  src={`icons://i/${name}.svg`}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  onError={(e) => {
                    e.currentTarget.hidden = true;
                  }}
                />
              </span>
              <span className="palette-name">{name.replace(/-/g, ' ')}</span>
            </button>
          ))}
        </div>
        {!results.length && (
          <p className="palette-empty">No icons found. Try another name or choose All icons.</p>
        )}
        {limit < results.length && (
          <button
            className="btn palette-more"
            type="button"
            ref={more}
            onClick={() => setLimit((n) => n + BATCH)}
          >
            Show more icons
          </button>
        )}
      </div>
    </div>
  );
}

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { IconChevron } from './icons';

const ITEMS = '[role="menuitem"], [role="menuitemcheckbox"]';

/**
 * A button that opens a dropdown menu. Focus moves to the first item on open. ArrowUp/Down (wrapping),
 * Home and End move between items. Escape closes and returns focus to the button. Tab or an outside
 * click closes. The menu stays mounted (hidden) so CSS can animate it out.
 */
export function Menu({
  label,
  icon,
  testId,
  chevron = true,
  children,
}: {
  label: string;
  icon?: ReactNode;
  testId?: string;
  chevron?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const first = wrap.current?.querySelector<HTMLElement>(ITEMS);
    // A static list (Shortcuts) has nothing to act on: focus the menu, not a row that would look selected.
    if (first?.getAttribute('aria-disabled') === 'true')
      wrap.current?.querySelector<HTMLElement>('.menu')?.focus();
    else first?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number> = {
      ArrowDown: i + 1,
      ArrowUp: i - 1,
      Home: 0,
      End: items.length - 1,
    };
    const next = moves[e.key];
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.stopPropagation(); // not a canvas nudge
      return;
    }
    if (e.key === 'Escape') close();
    else if (next !== undefined) items[(next + items.length) % items.length]?.focus();
    else return;
    e.preventDefault();
    e.stopPropagation(); // keep Escape from also clearing the canvas selection
  };

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        ref={button}
        type="button"
        className={`btn${open ? ' on' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        onClick={() => setOpen(!open)}
      >
        {icon}
        {label}
        {chevron && <IconChevron />}
      </button>
      <div className="menu" role="menu" aria-label={label} tabIndex={-1} hidden={!open} onKeyDown={onKeyDown}>
        {children(close)}
      </div>
    </div>
  );
}

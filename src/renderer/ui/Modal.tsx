import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { IconClose } from './icons';

/**
 * Native modal dialog. showModal() gives Escape, the focus trap, an inert background and the top layer.
 * Focus goes to [data-autofocus] on open and back to the opener on close. Children stay mounted until
 * the exit transition has finished (0 ms in test mode and under reduced motion).
 */
export function Modal({
  open,
  title,
  onClose,
  className = '',
  footer,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  className?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      if (d.open) return;
      opener.current = document.activeElement as HTMLElement | null;
      d.showModal();
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
      return;
    }
    if (d.open) d.close();
    opener.current?.focus();
    // getAnimations() flushes style, so it sees the exit transitions close() just started.
    const done = () => {
      if (!d.open) setMounted(false);
    };
    void Promise.all(d.getAnimations({ subtree: true }).map((a) => a.finished)).then(done, done);
  }, [open]);

  if (!mounted) return null;
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-label={title}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault(); // Escape: close through state, so the store never lags the dialog
        onClose();
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose(); // the backdrop
      }}
    >
      <div className="modal-head">
        {title}
        <button type="button" className="btn icon" aria-label="Close" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      {children}
      {footer && <div className="modal-foot">{footer}</div>}
    </dialog>
  );
}

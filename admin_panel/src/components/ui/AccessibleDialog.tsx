import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

export interface AccessibleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  role?: 'dialog' | 'alertdialog';
}

const FOCUSABLE_SELECTORS =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Native, zero-dependency WAI-ARIA compliant modal dialog primitive.
 * Handles focus trapping, Escape key dismissal, backdrop dismissals,
 * and focus restoration without external library overhead.
 */
export function AccessibleDialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  initialFocusRef,
  className = '',
  role = 'dialog',
}: AccessibleDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = setTimeout(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
      } else if (dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
        if (focusables.length > 0) {
          focusables[0].focus();
        } else {
          dialogRef.current.focus();
        }
      }
    }, 10);

    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = originalOverflow;
      if (previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === 'function') {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen, initialFocusRef]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !dialogRef.current) return;

    const focusables = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
    if (focusables.length === 0) return;

    const firstElement = focusables[0];
    const lastElement = focusables[focusables.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      }
    } else {
      if (document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby={description ? 'dialog-description' : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/70 focus:outline-none animate-in zoom-in-95 duration-200 ${className}`}
      >
        <div className="sr-only" id="dialog-title">
          {title}
        </div>
        {description && (
          <div className="sr-only" id="dialog-description">
            {description}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

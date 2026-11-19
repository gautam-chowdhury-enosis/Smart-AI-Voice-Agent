import { useRef } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { AccessibleDialog } from './AccessibleDialog';
import { Button } from './button';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modern, accessible confirmation dialog replacing blocking window.confirm().
 * Defaults keyboard focus to the Cancel button to prevent accidental destructive actions.
 */
export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDestructive = true,
  isPending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={isPending ? () => {} : onCancel}
      title={title}
      description={description}
      role="alertdialog"
      initialFocusRef={cancelButtonRef}
      className="max-w-md"
    >
      <div className="flex items-start gap-4">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
            isDestructive
              ? 'border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300'
              : 'border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300'
          }`}
        >
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{description}</p>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-5 dark:border-slate-800/80">
        <Button
          ref={cancelButtonRef}
          variant="secondary"
          disabled={isPending}
          onClick={onCancel}
        >
          {cancelText}
        </Button>
        <Button
          variant={isDestructive ? 'danger' : 'primary'}
          disabled={isPending}
          onClick={onConfirm}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />
              Processing…
            </>
          ) : (
            confirmText
          )}
        </Button>
      </div>
    </AccessibleDialog>
  );
}

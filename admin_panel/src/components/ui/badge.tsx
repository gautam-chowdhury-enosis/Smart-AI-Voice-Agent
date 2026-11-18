import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';

type BadgeTone = 'success' | 'warning' | 'neutral' | 'accent' | 'primary' | 'danger';

/** Compact status marker for service health and provider availability, and theme compliance. */
export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  const tones: Record<BadgeTone, string> = {
    success: 'border-emerald-500/25 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300',
    warning: 'border-amber-500/30 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200',
    neutral: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300',
    accent: 'border-indigo-500/30 bg-indigo-50 text-indigo-700 dark:border-indigo-400/25 dark:bg-indigo-400/10 dark:text-indigo-200',
    primary: 'border-indigo-500/30 bg-indigo-50 text-indigo-700 dark:border-indigo-400/25 dark:bg-indigo-500/15 dark:text-indigo-200',
    danger: 'border-rose-500/30 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

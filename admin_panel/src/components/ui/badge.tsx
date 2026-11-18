import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';

type BadgeTone = 'success' | 'warning' | 'neutral' | 'accent' | 'primary' | 'danger';

/** Compact status marker for service health and provider availability. */
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
    success: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
    warning: 'border-amber-400/20 bg-amber-400/10 text-amber-200',
    neutral: 'border-slate-700 bg-slate-800/70 text-slate-300',
    accent: 'border-indigo-400/25 bg-indigo-400/10 text-indigo-200',
    primary: 'border-indigo-400/25 bg-indigo-500/15 text-indigo-200',
    danger: 'border-rose-400/25 bg-rose-500/15 text-rose-200',
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

import { Monitor, Moon, Sun } from 'lucide-react';

import { useTheme, type Theme } from '../context/ThemeContext';
import { cn } from '../lib/utils';

interface ThemeToggleProps {
  compact?: boolean;
  className?: string;
}

const themeOptions: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/** Accessible 3-option segmented theme control (Light, Dark, System Default). */
export function ThemeToggle({ compact = false, className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Color theme selection"
      className={cn(
        'inline-flex items-center rounded-xl border border-slate-200 bg-slate-100/90 p-1 dark:border-slate-800 dark:bg-slate-950/70',
        className,
      )}
    >
      {themeOptions.map(({ value, label, icon: Icon }) => {
        const isActive = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={`${label} theme`}
            title={`${label} mode`}
            onClick={() => setTheme(value)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-indigo-500',
              isActive
                ? 'bg-white text-indigo-600 shadow-sm dark:bg-indigo-500/20 dark:text-white dark:shadow-[inset_0_0_0_1px_rgba(129,140,248,0.25)]'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {!compact && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}

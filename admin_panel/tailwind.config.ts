import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        app: 'var(--bg-app)',
        surface: 'var(--surface)',
        'surface-elevated': 'var(--surface-elevated)',
        subtle: 'var(--border-subtle)',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(129, 140, 248, 0.24), 0 22px 70px rgba(15, 23, 42, 0.36)',
      },
      backgroundImage: {
        mesh: 'var(--mesh-gradient)',
      },
    },
  },
  plugins: [],
} satisfies Config;

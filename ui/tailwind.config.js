/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: ['./web/index.html', './web/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces & text — every value is a token so a rebrand is one file.
        bg: token('bg'),
        surface: token('surface'),
        'surface-2': token('surface-2'),
        'surface-3': token('surface-3'),
        line: token('border'),
        'line-strong': token('border-strong'),
        ink: token('text'),
        'ink-muted': token('text-muted'),
        'ink-subtle': token('text-subtle'),

        brand: {
          DEFAULT: token('brand'),
          hover: token('brand-hover'),
          soft: token('brand-soft'),
          fg: token('brand-fg'),
        },
        success: { DEFAULT: token('success'), soft: token('success-soft') },
        warning: { DEFAULT: token('warning'), soft: token('warning-soft') },
        danger: { DEFAULT: token('danger'), soft: token('danger-soft') },
        info: { DEFAULT: token('info'), soft: token('info-soft') },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem',
        // Corner language comes from the active design direction.
        card: 'var(--radius-card)',
        ctl: 'var(--radius-ctl)',
      },
      spacing: {
        // List-row density, likewise per direction.
        row: 'var(--row-py)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        raised: 'var(--shadow-raised)',
        pop: 'var(--shadow-pop)',
        focus: '0 0 0 3px rgb(var(--ring) / 0.35)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in .18s ease-out',
        'slide-up': 'slide-up .20s cubic-bezier(.22,1,.36,1)',
        'slide-down': 'slide-down .16s cubic-bezier(.22,1,.36,1)',
      },
    },
  },
  plugins: [],
}

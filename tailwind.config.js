/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'var(--border)',
        surface: {
          DEFAULT: 'var(--bg-app)',
          subtle: 'var(--bg-subtle)',
          muted: 'var(--bg-muted)',
        },
        ink: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          subtle: 'var(--accent-subtle)',
        },
        success: 'var(--success)',
        danger: 'var(--danger)',
        warning: 'var(--warning)',
        role: {
          supervisor: 'var(--role-supervisor)',
          planner: 'var(--role-planner)',
          coder: 'var(--role-coder)',
          reviewer: 'var(--role-reviewer)',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['SF Mono', 'JetBrains Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        none: '0',
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
        xl: '12px',
        '2xl': '12px',
        '3xl': '12px',
        full: '9999px',
      },
      // 扁平化：移除所有阴影（浮层改用发丝边框界定）
      boxShadow: {
        none: 'none',
        sm: 'none',
        DEFAULT: 'none',
        md: 'none',
        lg: 'none',
        xl: 'none',
        '2xl': 'none',
        inner: 'none',
        pop: 'none',
        float: 'none',
      },
      keyframes: {
        blink: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
        pulse: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
        'message-enter': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        blink: 'blink 1s step-start infinite',
        pulse: 'pulse 1.2s ease-in-out infinite',
        'message-enter': 'message-enter 0.3s ease-out',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
    },
  },
  plugins: [],
}

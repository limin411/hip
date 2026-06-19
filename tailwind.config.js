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
          strong: 'var(--accent-strong)',
          subtle: 'var(--accent-subtle)',
          active: 'var(--accent-active)',
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
      // 字号体系：每级自带行高，密集行（caption/meta/body）用更紧凑的 leading，
      // 阅读文本（prose）保留宽松行距。替代散落的 text-[Npx] 硬编码。
      fontSize: {
        caption: ['11px', { lineHeight: '1.4' }],
        meta: ['12px', { lineHeight: '1.45' }],
        body: ['13px', { lineHeight: '1.5' }],
        prose: ['14px', { lineHeight: '1.7' }],
        title: ['16px', { lineHeight: '1.4' }],
        display: ['20px', { lineHeight: '1.3' }],
        stat: ['24px', { lineHeight: '1.2' }],
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
      // 扁平化：界面主体不用阴影（保持平面外壳）。
      // 唯一例外：真正的浮层（菜单、弹窗）用克制的柔和阴影，避免与画布同色「贴」在一起。
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
        menu: '0 6px 20px -6px rgba(17, 17, 17, 0.14), 0 2px 6px -2px rgba(17, 17, 17, 0.08)',
        overlay: '0 16px 48px -12px rgba(17, 17, 17, 0.22), 0 6px 16px -8px rgba(17, 17, 17, 0.12)',
        'card-hover': '0 4px 16px -4px rgba(17, 17, 17, 0.08)',
        'sticky-top': '0 1px 3px rgba(17, 17, 17, 0.06)',
      },
      keyframes: {
        blink: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
        pulse: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
        'message-enter': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'menu-in': {
          from: { opacity: '0', transform: 'translateY(-4px) scale(0.97)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'panel-in': {
          from: { opacity: '0', transform: 'translateX(8px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'dot-bounce': {
          '0%,60%,100%': { opacity: '0.3', transform: 'translateY(0)' },
          '30%': { opacity: '1', transform: 'translateY(-2px)' },
        },
        'msg-enter-right': {
          from: { opacity: '0', transform: 'translateX(12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'msg-enter-left': {
          from: { opacity: '0', transform: 'translateX(-12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        blink: 'blink 1s step-start infinite',
        pulse: 'pulse 1.2s ease-in-out infinite',
        'message-enter': 'message-enter 0.3s ease-out',
        'menu-in': 'menu-in 0.12s ease-out',
        'panel-in': 'panel-in 0.2s ease-out',
        'dot-bounce': 'dot-bounce 1.2s ease-in-out infinite',
        'msg-enter-right': 'msg-enter-right 0.3s ease-out',
        'msg-enter-left': 'msg-enter-left 0.3s ease-out',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
    },
  },
  plugins: [],
}

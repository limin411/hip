/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: {
          DEFAULT: 'rgb(var(--border-rgb) / <alpha-value>)',
          strong: 'var(--border-strong)',
        },
        surface: {
          DEFAULT: 'rgb(var(--bg-app-rgb) / <alpha-value>)',
          subtle: 'rgb(var(--bg-subtle-rgb) / <alpha-value>)',
          muted: 'rgb(var(--bg-muted-rgb) / <alpha-value>)',
          content: 'var(--bg-content)',
        },
        ink: {
          DEFAULT: 'rgb(var(--text-primary-rgb) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary-rgb) / <alpha-value>)',
          tertiary: 'rgb(var(--text-tertiary-rgb) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          hover: 'var(--accent-hover)',
          strong: 'var(--accent-strong)',
          subtle: 'rgb(var(--accent-subtle-rgb) / <alpha-value>)',
          active: 'var(--accent-active)',
        },
        'on-accent': 'var(--on-accent)',
        'btn-primary': {
          DEFAULT: 'var(--btn-primary)',
          hover: 'var(--btn-primary-hover)',
        },
        'on-btn-primary': 'rgb(var(--on-btn-primary-rgb) / <alpha-value>)',
        success: 'rgb(var(--success-rgb) / <alpha-value>)',
        danger: 'rgb(var(--danger-rgb) / <alpha-value>)',
        warning: 'rgb(var(--warning-rgb) / <alpha-value>)',
        state: {
          hover: 'rgb(var(--state-hover-rgb) / <alpha-value>)',
          active: 'var(--state-active)',
          disabled: 'var(--state-disabled)',
        },
        effort: {
          max: 'rgb(var(--effort-max-rgb) / <alpha-value>)',
        },
        'focus-ring': 'var(--focus-ring)',
        overlay: {
          DEFAULT: 'var(--overlay-scrim)',
          light: 'var(--overlay-scrim-light)',
        },
        glass: {
          DEFAULT: 'var(--glass-bg)',
          border: 'var(--glass-border)',
        },
        role: {
          supervisor: 'var(--role-supervisor)',
          planner: 'var(--role-planner)',
          coder: 'var(--role-coder)',
          reviewer: 'var(--role-reviewer)',
          worker: 'var(--role-worker)',
        },
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Segoe UI Variable',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei UI',
          'Microsoft YaHei',
          'Noto Sans CJK SC',
          'Noto Sans SC',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'Cascadia Mono',
          'Cascadia Code',
          'SF Mono',
          'JetBrains Mono',
          'Consolas',
          'Menlo',
          'monospace',
        ],
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
        // page = document/page H1 only (e.g. Knowledge InlineDocTitle).
        // Not for section headers, cards, stats, or chrome.
        // 32px = T2 裁决值（Notion 40px 在小窗口内占比过高）。
        page: ['32px', { lineHeight: '1.25', letterSpacing: '-0.02em' }],
      },
      // 扁平化：直角优先。按钮/输入 2px，卡片 4px，浮层 6px；full 仅保留给状态点/开关/avatar。
      borderRadius: {
        none: '0',
        sm: '2px',
        DEFAULT: '4px',
        md: '4px',
        lg: '4px',
        xl: '6px',
        '2xl': '6px',
        '3xl': '6px',
        full: '9999px',
      },
      // 扁平化：界面主体不用阴影。
      // 唯一例外：overlay（Modal）一档极轻投影；浮层分层改由实底 + 1px 边框 + scrim。
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
        panel: 'var(--shadow-panel)',
        menu: 'none',
        overlay: '0 12px 32px -12px rgba(17, 17, 17, 0.12)',
        'card-hover': 'none',
        'sticky-top': 'none',
      },
      keyframes: {
        blink: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
        pulse: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
        // 扁平化：入场一律纯 opacity，无位移/缩放（Fade-only Motion）。
        'message-enter': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'menu-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'menu-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
        // Modal: 纯 fade。保持 inset + m-auto 居中，transform 不再参与。
        'modal-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'modal-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
        'overlay-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'overlay-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
        'panel-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'view-enter': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'dot-bounce': {
          '0%,60%,100%': { opacity: '0.3' },
          '30%': { opacity: '1' },
        },
        'msg-enter-right': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'msg-enter-left': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      // ease-out token = springy decelerate (see --ease-out in tokens.css)
      animation: {
        blink: 'blink 1s step-start infinite',
        pulse: 'pulse 1.2s ease-in-out infinite',
        'message-enter':
          'message-enter var(--duration-content, 240ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both',
        'menu-in':
          'menu-in var(--duration-chrome, 140ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both',
        'menu-out':
          'menu-out 110ms var(--ease-standard, cubic-bezier(0.2, 0, 0, 1)) both',
        'modal-in':
          'modal-in var(--duration-content, 240ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both',
        'modal-out':
          'modal-out 160ms var(--ease-standard, cubic-bezier(0.2, 0, 0, 1)) both',
        'overlay-in':
          'overlay-in var(--duration-content, 240ms) var(--ease-standard, cubic-bezier(0.2, 0, 0, 1)) both',
        'overlay-out':
          'overlay-out 160ms var(--ease-standard, cubic-bezier(0.2, 0, 0, 1)) both',
        'panel-in':
          'panel-in var(--duration-content, 240ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both',
        'view-enter':
          'view-enter var(--duration-content, 240ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both',
        'dot-bounce': 'dot-bounce 1.2s ease-in-out infinite',
        'msg-enter-right':
          'msg-enter-right var(--duration-content, 240ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both',
        'msg-enter-left':
          'msg-enter-left var(--duration-content, 240ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both',
      },
      transitionDuration: {
        DEFAULT: '150ms',
        chrome: 'var(--duration-chrome, 140ms)',
        content: 'var(--duration-content, 240ms)',
        celebrate: 'var(--duration-celebrate, 450ms)',
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--ease-standard, cubic-bezier(0.2, 0, 0, 1))',
        out: 'var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1))',
        standard: 'var(--ease-standard, cubic-bezier(0.2, 0, 0, 1))',
      },
    },
  },
  plugins: [],
}

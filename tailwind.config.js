/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
        },
        surface: {
          DEFAULT: 'var(--bg-app)',
          subtle: 'var(--bg-subtle)',
          muted: 'var(--bg-muted)',
          content: 'var(--bg-content)',
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
        'on-accent': 'var(--on-accent)',
        'btn-primary': {
          DEFAULT: 'var(--btn-primary)',
          hover: 'var(--btn-primary-hover)',
        },
        'on-btn-primary': 'var(--on-btn-primary)',
        success: 'var(--success)',
        danger: 'var(--danger)',
        warning: 'var(--warning)',
        state: {
          hover: 'var(--state-hover)',
          active: 'var(--state-active)',
          disabled: 'var(--state-disabled)',
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
        page: ['28px', { lineHeight: '1.25', letterSpacing: '-0.02em' }],
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
      // 扁平化：界面主体不用阴影。
      // 例外三档：panel（右栏浮动卡）、menu（下拉）、overlay（Modal）。
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
        // 浮层阴影：更轻、更弥散 —— 高级感来自柔和而非浓重
        menu: '0 8px 24px -8px rgba(17, 17, 17, 0.12), 0 2px 8px -4px rgba(17, 17, 17, 0.06)',
        overlay: '0 20px 56px -16px rgba(17, 17, 17, 0.18), 0 8px 20px -10px rgba(17, 17, 17, 0.08)',
        'card-hover': 'none',
        'sticky-top': 'none',
      },
      keyframes: {
        blink: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
        pulse: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
        // Individual transform props (translate/scale) so they compose with Tailwind
        // translate utilities (e.g. -translate-x-1/2 is not wiped mid-animation).
        'message-enter': {
          from: { opacity: '0', translate: '0 8px' },
          to: { opacity: '1', translate: '0 0' },
        },
        'menu-in': {
          from: { opacity: '0', translate: '0 -6px', scale: '0.96' },
          to: { opacity: '1', translate: '0 0', scale: '1' },
        },
        'menu-out': {
          from: { opacity: '1', translate: '0 0', scale: '1' },
          to: { opacity: '0', translate: '0 -4px', scale: '0.97' },
        },
        // Modal: scale-only. Still pair with inset + m-auto centering (not -translate-*),
        // so transform composition never flashes the panel off-center on open.
        'modal-in': {
          from: { opacity: '0', scale: '0.96' },
          to: { opacity: '1', scale: '1' },
        },
        'modal-out': {
          from: { opacity: '1', scale: '1' },
          to: { opacity: '0', scale: '0.97' },
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
          from: { opacity: '0', translate: '10px 0' },
          to: { opacity: '1', translate: '0 0' },
        },
        'view-enter': {
          from: { opacity: '0', translate: '0 6px' },
          to: { opacity: '1', translate: '0 0' },
        },
        'dot-bounce': {
          '0%,60%,100%': { opacity: '0.3', translate: '0 0' },
          '30%': { opacity: '1', translate: '0 -2px' },
        },
        'msg-enter-right': {
          from: { opacity: '0', translate: '12px 0' },
          to: { opacity: '1', translate: '0 0' },
        },
        'msg-enter-left': {
          from: { opacity: '0', translate: '-12px 0' },
          to: { opacity: '1', translate: '0 0' },
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

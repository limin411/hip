import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Mail, Github, Chrome, ArrowRight } from 'lucide-react'
import { AuthButton } from '@/components/login/AuthButton'
import { LoginBrandPanel } from '@/components/login/LoginBrandPanel'
import { WindowCaptionButtons } from '@/components/layout/WindowCaptionButtons'
import { useWindowDrag } from '@/lib/useWindowDrag'
import { useAuthStore } from '@/store/authStore'

export function LoginScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const handlePointerDown = useWindowDrag()
  const enter = () => {
    login()
    navigate('/app')
  }

  return (
    // 整页可拖动窗口（Overlay / Win frameless）；交互卡片与 caption 排除拖拽。
    <div
      data-tauri-drag-region
      onPointerDown={handlePointerDown}
      className="fixed inset-0 flex overflow-hidden bg-surface"
    >
      {/* Win frameless: close/min without OS title bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-50 flex justify-end">
        <div className="pointer-events-auto">
          <WindowCaptionButtons />
        </div>
      </div>

      {/* 左侧品牌宣传区 —— 白底 + 文案 */}
      <LoginBrandPanel />

      {/* 右侧登录方式 */}
      <div className="flex h-full min-h-0 w-full items-center justify-center self-stretch bg-surface px-8 md:w-2/5">
        <div className="w-full max-w-sm" data-tauri-drag-region="false" data-no-drag>
          <h1 className="text-display font-bold tracking-tight text-ink">{t('login.title')}</h1>
          <p className="mt-1.5 text-meta text-ink-secondary">{t('login.subtitle')}</p>

          <div className="mt-8 flex flex-col gap-3">
            <AuthButton
              icon={Mail}
              label={t('login.email')}
              onClick={enter}
              variant="solid"
            />
            <AuthButton icon={Github} label={t('login.github')} onClick={enter} />
            <AuthButton icon={Chrome} label={t('login.google')} onClick={enter} />
          </div>

          <button
            type="button"
            onClick={enter}
            className="mt-6 flex w-full items-center justify-center gap-1.5 text-meta text-ink-tertiary transition-colors hover:text-ink-secondary"
          >
            {t('login.skip')}
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

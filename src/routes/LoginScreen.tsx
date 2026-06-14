import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Mail, Github, Chrome, ArrowRight } from 'lucide-react'
import { AuthButton } from '@/components/login/AuthButton'
import { HipLogo } from '@/components/login/HipLogo'
import { useAuthStore } from '@/store/authStore'

export function LoginScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const enter = () => { login(); navigate('/app') }

  return (
    // 整页可拖动窗口（无原生标题栏 Overlay 模式下，空白处即拖拽区）；交互卡片单独排除。
    <div data-tauri-drag-region className="flex h-screen">
      {/* 左侧品牌区 —— 摸鱼小人 hero（抱鱼抚摸 + 眨眼 + 斜瞄） */}
      <div
        className="relative hidden w-1/2 items-center justify-center overflow-hidden md:flex"
        style={{ background: 'linear-gradient(150deg, #0a78c6 0%, #0062ad 52%, #02324f 100%)' }}
      >
        <HipLogo variant="hero" size={260} title="hip" />
      </div>

      {/* 右侧登录方式 */}
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="w-full max-w-sm" data-tauri-drag-region="false">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{t('login.title')}</h1>
          <p className="mt-1.5 text-sm text-ink-secondary">{t('login.subtitle')}</p>

          <div className="mt-8 flex flex-col gap-3">
            <AuthButton icon={Mail} label={t('login.email')} onClick={enter} variant="solid" />
            <AuthButton icon={Github} label={t('login.github')} onClick={enter} />
            <AuthButton icon={Chrome} label={t('login.google')} onClick={enter} />
          </div>

          <button
            onClick={enter}
            className="mt-6 flex w-full items-center justify-center gap-1.5 text-sm text-ink-tertiary transition-colors hover:text-ink-secondary"
          >
            {t('login.skip')}
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

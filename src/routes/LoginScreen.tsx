import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Mail, Github, Chrome, ArrowRight, Bot } from 'lucide-react'
import { AuthButton } from '@/components/login/AuthButton'
import { useAuthStore } from '@/store/authStore'

export function LoginScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const enter = () => { login(); navigate('/app') }

  return (
    <div className="flex h-screen">
      {/* 左侧大图标块 */}
      <div className="relative hidden w-1/2 items-center justify-center bg-surface-subtle md:flex">
        <div className="flex flex-col items-center gap-6">
          <div className="flex h-28 w-28 items-center justify-center rounded-2xl bg-accent">
            <Bot size={64} className="text-white" strokeWidth={1.5} />
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold tracking-tight text-ink">hip</div>
            <div className="mt-1 text-sm text-ink-secondary">{t('login.slogan')}</div>
          </div>
        </div>
      </div>

      {/* 右侧登录方式 */}
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="w-full max-w-sm">
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

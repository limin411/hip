import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Mail, Github, Chrome, ArrowRight } from 'lucide-react'
import { AuthButton } from '@/components/login/AuthButton'
import { MascotActor } from '@/components/login/MascotActor'
import { useWindowDrag } from '@/lib/useWindowDrag'
import { useAuthStore } from '@/store/authStore'

export function LoginScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const handlePointerDown = useWindowDrag()
  const [cheer, setCheer] = useState(false)
  const enter = () => {
    login()
    navigate('/app')
  }

  return (
    // 整页可拖动窗口（无原生标题栏 Overlay 模式下，空白处即拖拽区）；交互卡片单独排除。
    <div data-tauri-drag-region onPointerDown={handlePointerDown} className="flex h-screen">
      {/* 左侧品牌区 —— 白底 + 吉祥物 GIF */}
      <div className="relative hidden w-1/2 items-center justify-center overflow-hidden md:flex">
        <MascotActor size={320} cheer={cheer} />
      </div>

      {/* 右侧登录方式 */}
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="w-full max-w-sm" data-tauri-drag-region="false" data-no-drag>
          <h1 className="text-display font-bold tracking-tight text-ink">{t('login.title')}</h1>
          <p className="mt-1.5 text-meta text-ink-secondary">{t('login.subtitle')}</p>

          <div className="mt-8 flex flex-col gap-3">
            <AuthButton
              icon={Mail}
              label={t('login.email')}
              onClick={enter}
              variant="solid"
              onPointerEnter={() => setCheer(true)}
              onPointerLeave={() => setCheer(false)}
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

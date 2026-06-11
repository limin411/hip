import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Mail, Github, Chrome, ArrowRight, Sparkles } from 'lucide-react'
import { AuthButton } from '@/components/login/AuthButton'
import { HipLogo } from '@/components/login/HipLogo'
import { useAuthStore } from '@/store/authStore'

export function LoginScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const enter = () => { login(); navigate('/app') }

  return (
    <div className="flex h-screen">
      {/* 左侧品牌区 —— 蜜桃 hero（Teal 渐变 + 珊瑚桃，仅登录页引入珊瑚色） */}
      <div
        className="relative hidden w-1/2 items-center justify-center overflow-hidden md:flex"
        style={{ background: 'linear-gradient(150deg, #119c8d 0%, #0c766b 52%, #083f39 100%)' }}
      >
        {/* 装饰层：柔和光晕 + 漂浮蜜桃 + 闪光 */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-14 -top-16 h-52 w-52 rounded-full bg-white/[0.07]" />
          <div className="absolute -bottom-20 -right-12 h-56 w-56 rounded-full bg-white/[0.06]" />
          <HipLogo decorative size={44} className="absolute right-12 top-12 rotate-[14deg] opacity-30" />
          <HipLogo decorative size={34} className="absolute bottom-14 left-10 -rotate-[18deg] opacity-25" />
          <Sparkles size={20} className="absolute left-16 top-24 text-white/40" strokeWidth={1.5} />
          <Sparkles size={15} className="absolute bottom-28 right-20 text-white/30" strokeWidth={1.5} />
        </div>

        {/* 中心：主标识 + 字标 + slogan */}
        <div className="relative z-10 flex flex-col items-center gap-5">
          <HipLogo variant="color" size={140} title="hip" />
          <div className="text-center">
            <div className="text-[46px] font-bold leading-none tracking-tight text-white">hip</div>
            <div className="mt-2.5 text-sm text-white">{t('login.slogan')}</div>
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

import { useNavigate } from 'react-router-dom'
import { Mail, Github, Chrome, ArrowRight, Bot } from 'lucide-react'
import { AuthButton } from '@/components/login/AuthButton'

export function LoginScreen() {
  const navigate = useNavigate()
  const enter = () => navigate('/app')

  return (
    <div className="flex h-screen">
      {/* 左侧大图标块 */}
      <div className="relative hidden w-1/2 items-center justify-center bg-accent-subtle md:flex">
        <div className="flex flex-col items-center gap-6">
          <div className="flex h-28 w-28 items-center justify-center rounded-3xl bg-accent shadow-float">
            <Bot size={64} className="text-white" strokeWidth={1.5} />
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold tracking-tight text-ink">hip</div>
            <div className="mt-1 text-sm text-ink-secondary">没有人比我更懂摸鱼</div>
          </div>
        </div>
      </div>

      {/* 右侧登录方式 */}
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold tracking-tight text-ink">登录到 hip</h1>
          <p className="mt-1.5 text-sm text-ink-secondary">选择一种方式继续</p>

          <div className="mt-8 flex flex-col gap-3">
            <AuthButton icon={Mail} label="使用邮箱登录" onClick={enter} variant="solid" />
            <AuthButton icon={Github} label="使用 GitHub 登录" onClick={enter} />
            <AuthButton icon={Chrome} label="使用 Google 登录" onClick={enter} />
          </div>

          <button
            onClick={enter}
            className="mt-6 flex w-full items-center justify-center gap-1.5 text-sm text-ink-tertiary transition-colors hover:text-ink-secondary"
          >
            跳过登录
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

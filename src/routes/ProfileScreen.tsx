import { Camera, Building2, MapPin, Clock, Shield } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Avatar } from '@/components/ui/Avatar'
import { Separator } from '@/components/ui/Separator'
import { mockProfile } from '@/mock/profile'
import { Button } from '@/components/ui/Button'

export function ProfileScreen() {
  const profile = mockProfile

  return (
    <div className="flex h-screen flex-col bg-surface">
      <PageHeader title="个人资料" />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl px-6 py-8">
          {/* 头像与基本信息 */}
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <Avatar name={profile.name} size={96} />
              <button className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-ink-secondary shadow-pop transition-colors hover:bg-surface-muted">
                <Camera size={14} />
              </button>
            </div>
            <div className="text-center">
              <div className="text-xl font-semibold text-ink">{profile.name}</div>
              <div className="mt-1 text-sm text-ink-secondary">{profile.email}</div>
            </div>
          </div>

          <Separator className="my-6" />

          {/* 详细信息 */}
          <div className="flex flex-col gap-5">
            <InfoRow icon={Shield} label="角色" value={profile.role} />
            <InfoRow icon={Building2} label="组织" value={profile.organization} />
            <InfoRow icon={MapPin} label="所在地" value={profile.location} />
            <InfoRow icon={Clock} label="时区" value={profile.timezone} />
          </div>

          <Separator className="my-6" />

          {/* 个人简介 */}
          <div>
            <div className="mb-2 text-[13px] font-medium text-ink-secondary">个人简介</div>
            <p className="text-[14px] leading-relaxed text-ink">{profile.bio}</p>
          </div>

          <Separator className="my-6" />

          {/* 底部按钮 */}
          <div className="flex gap-3">
            <Button className="flex-1">保存更改</Button>
            <Button variant="secondary" className="flex-1">重置</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Shield; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon size={16} className="text-ink-tertiary" />
      <span className="w-16 text-[13px] text-ink-secondary">{label}</span>
      <span className="text-[14px] text-ink">{value}</span>
    </div>
  )
}

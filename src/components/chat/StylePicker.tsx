import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal, Check, Plus, Trash2 } from 'lucide-react'
import { sessionService, useActiveSession, useActiveSessionId, useActiveSessionStatus } from '@/domain'
import { useStylesStore } from '@/store/stylesStore'
import { resolveStyleLabel } from '@/lib/styles'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/DropdownMenu'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { ComposerChip } from './ComposerChip'
import { cn } from '@/lib/utils'

export function StylePicker() {
  const { t } = useTranslation()
  const session = useActiveSession()
  const activeId = useActiveSessionId()
  const status = useActiveSessionStatus()
  const presets = useStylesStore((s) => s.presets)
  const [manageOpen, setManageOpen] = useState(false)

  if (!activeId || !session) return null
  const disabled = status === 'running'
  const current = session.config.systemPrompt
  const label = resolveStyleLabel(current, presets)
  const text =
    label.kind === 'preset' ? label.name : label.kind === 'custom' ? t('chat.styleCustom') : t('chat.style')
  const apply = (value: string | null) => sessionService.setSystemPrompt(activeId, value)

  return (
    <>
      {/* modal={false}: this dropdown opens the StyleManager Modal (Dialog). A modal dropdown +
          a Dialog each lock body{pointer-events:none}; their DismissableLayers can close out of
          order and leave the body stuck unclickable. Same mitigation as UserMenu. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <ComposerChip
            disabled={disabled}
            active={label.kind !== 'none'}
            title={t('chat.styleHint')}
            data-testid="style-chip"
          >
            <SlidersHorizontal size={13} className="shrink-0" aria-hidden />
            <span className="max-w-[120px] truncate">{text}</span>
          </ComposerChip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => current && apply(null)}>
            <Check size={14} className={cn('shrink-0', current ? 'opacity-0' : 'opacity-100')} />
            <span>{t('chat.styleNone')}</span>
          </DropdownMenuItem>
          {presets.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => apply(p.text)}>
              <Check size={14} className={cn('shrink-0', current === p.text ? 'opacity-100' : 'opacity-0')} />
              <span className="truncate">{p.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setManageOpen(true)}>
            <SlidersHorizontal size={14} className="shrink-0" />
            <span>{t('chat.styleManage')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <StyleManager open={manageOpen} onOpenChange={setManageOpen} />
    </>
  )
}

function StyleManager({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation()
  const presets = useStylesStore((s) => s.presets)
  const addPreset = useStylesStore((s) => s.addPreset)
  const updatePreset = useStylesStore((s) => s.updatePreset)
  const removePreset = useStylesStore((s) => s.removePreset)
  const [name, setName] = useState('')
  const [text, setText] = useState('')

  const create = () => {
    const n = name.trim()
    const tx = text.trim()
    if (!n || !tx) return
    addPreset(n, tx)
    setName('')
    setText('')
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t('chat.styleDialogTitle')}>
      <div className="flex flex-col gap-4 p-5">
        {presets.length === 0 && <p className="text-body text-ink-tertiary">{t('chat.styleEmpty')}</p>}
        {presets.map((p) => (
          <div key={p.id} className="flex flex-col gap-1.5 border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <Input value={p.name} onChange={(e) => updatePreset(p.id, { name: e.target.value })} className="flex-1" />
              <button
                type="button"
                onClick={() => removePreset(p.id)}
                title={t('chat.styleDelete')}
                className="shrink-0 text-ink-tertiary transition-colors hover:text-danger"
              >
                <Trash2 size={15} />
              </button>
            </div>
            <Textarea value={p.text} onChange={(e) => updatePreset(p.id, { text: e.target.value })} rows={3} />
          </div>
        ))}
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('chat.styleName')} />
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={t('chat.styleInstructions')} />
          <button
            type="button"
            onClick={create}
            disabled={!name.trim() || !text.trim()}
            className="flex items-center gap-1.5 self-end bg-accent px-3 py-1.5 text-meta font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            <Plus size={14} />
            {t('chat.styleNew')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

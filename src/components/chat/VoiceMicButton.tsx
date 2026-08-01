import { Mic, Loader2, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { isMacPlatform } from '@/lib/platform'
import { useVoiceDictation } from './useVoiceDictation'

export function VoiceMicButton({
  value,
  onChange,
  disabled,
  inputRef,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  inputRef?: React.RefObject<HTMLTextAreaElement>
}) {
  const { t } = useTranslation()
  const { state, toggle, micDisabled, enabled } = useVoiceDictation({
    value,
    onChange,
    disabled,
    inputRef,
  })

  if (!enabled && state === 'unavailable') {
    // Runtime [voice].enabled=false or HIP_VOICE=0 — hide mic entirely.
    // When enabled but binary missing, still show (toast on click).
  }

  if (!enabled) return null

  const recording = state === 'recording'
  const busy = state === 'transcribing' || state === 'downloading'
  const shortcutLabel = isMacPlatform() ? '⌘⇧M' : 'Ctrl+Shift+M'

  return (
    <Button
      type="button"
      variant={recording ? 'primary' : 'ghost'}
      size="icon"
      className={cn(
        'h-7 w-7 shrink-0 rounded-sm',
        recording && 'animate-pulse',
      )}
      onClick={() => toggle()}
      disabled={micDisabled}
      data-testid="composer-voice-mic"
      data-state={state}
      title={
        recording
          ? t('voice.stopTitle')
          : busy
            ? t('voice.busyTitle')
            : t('voice.micTitle', { shortcut: shortcutLabel })
      }
      aria-label={recording ? t('voice.stopAria') : t('voice.micAria')}
    >
      {busy ? (
        <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />
      ) : recording ? (
        <Square size={12} strokeWidth={1.75} />
      ) : (
        <Mic size={14} strokeWidth={1.75} />
      )}
    </Button>
  )
}

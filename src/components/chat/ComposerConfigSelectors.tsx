import { Check, ChevronDown } from 'lucide-react'
import type { AcpConfigOption } from '@hip/protocol'
import { sessionService, useActiveConfigOptions, useActiveSessionId } from '@/domain'
import { cn } from '@/lib/utils'
import { ComposerChip } from './ComposerChip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/DropdownMenu'

/** The label shown on the chip for a given config option's current value. */
function currentLabel(opt: AcpConfigOption): string {
  return opt.options.find((o) => o.value === opt.currentValue)?.name ?? opt.currentValue
}

function ConfigSelector({ sessionId, opt }: { sessionId: string; opt: AcpConfigOption }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <ComposerChip title={opt.name} data-testid={`config-chip-${opt.id}`}>
          <span className="max-w-[160px] truncate">{currentLabel(opt)}</span>
          <ChevronDown size={11} className="shrink-0 opacity-60" aria-hidden />
        </ComposerChip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {opt.options.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onSelect={() => { if (o.value !== opt.currentValue) sessionService.setAgentConfigOption(sessionId, opt.id, o.value) }}
          >
            <Check size={14} className={cn('shrink-0', o.value === opt.currentValue ? 'opacity-100' : 'opacity-0')} />
            <span className="truncate">{o.name}</span>
            {o.description && <span className="ml-2 text-meta text-ink-tertiary truncate">{o.description}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Composer-toolbar model/mode selectors for an ACP agent, driven by the agent's
 * `agent:configOptions` advertisement. Renders one dropdown chip per option;
 * picking a value sends `agent:setConfigOption` to the live agent. Renders nothing
 * when the active session advertised no options (the built-in/non-ACP case).
 */
export function ComposerConfigSelectors() {
  const sessionId = useActiveSessionId()
  const options = useActiveConfigOptions()
  if (!sessionId || options.length === 0) return null
  return (
    <>
      {options.map((opt) => (
        <ConfigSelector key={opt.id} sessionId={sessionId} opt={opt} />
      ))}
    </>
  )
}

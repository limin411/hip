/**
 * Attachment card — file/PDF embedded in a document.
 *
 * Carrier: `![name](assets/doc.pdf)` — image syntax with a NON-image extension,
 * which pre-parse (`dialectToHtmlCarriers`) rewrites to a div carrier. The
 * block's `toExternalHTML` renders the literal carrier as its text content so
 * BN's markdown exporter passes it back verbatim (probe-verified pattern).
 */
import { createReactBlockSpec } from '@blocknote/react'
import { FileText, FolderOpen } from 'lucide-react'
import { knowledgeRevealPath } from '@/ipc/knowledge'
import { useKnowledgeEditorHost } from './knowledgeEditorHostContext'

export const attachmentBlockSpec = createReactBlockSpec(
  {
    type: 'attachment' as const,
    propSchema: {
      name: { default: '' },
      path: { default: '' },
    },
    content: 'none' as const,
  },
  {
    parse: (el) => {
      if (el.getAttribute('data-hip-block') !== 'attach') return undefined
      return {
        name: el.getAttribute('data-name') ?? '',
        path: el.getAttribute('data-path') ?? '',
      }
    },
    toExternalHTML: ({ block }) => (
      <div
        data-hip-block="attach"
        data-name={String(block.props.name ?? '')}
        data-path={String(block.props.path ?? '')}
      >
        {`![${String(block.props.name ?? '')}](${String(block.props.path ?? '')})`}
      </div>
    ),
    render: ({ block }) => (
      <AttachmentCard
        name={String(block.props.name ?? '')}
        path={String(block.props.path ?? '')}
      />
    ),
  },
)

function AttachmentCard({ name, path }: { name: string; path: string }) {
  const host = useKnowledgeEditorHost()
  return (
    <div
      className="kb-attach-card"
      data-testid="knowledge-attachment"
      data-attach-path={path}
      contentEditable={false}
    >
      <span className="kb-attach-icon">
        <FileText size={16} strokeWidth={1.75} />
      </span>
      <span className="kb-attach-meta">
        <span className="kb-attach-name" title={name}>
          {name || '(untitled)'}
        </span>
        <span className="kb-attach-path" title={path}>
          {path}
        </span>
      </span>
      <button
        type="button"
        className="kb-attach-reveal"
        data-testid="knowledge-attachment-reveal"
        aria-label="Reveal in file manager"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!path) return
          if (!host.spaceId) return
          void knowledgeRevealPath(host.spaceId, path).catch(() => {
            // reveal is best-effort; ignore failures silently
          })
        }}
      >
        <FolderOpen size={14} strokeWidth={1.75} />
      </button>
    </div>
  )
}

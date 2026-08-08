/**
 * 同步块 — 嵌入其他文档某块的只读镜像（V2-E1）。
 * props: nodeId（目标文档）、title、anchor（块锚点：标题文本/块文本）。
 * 源块修改 → 镜像跟随（store 订阅 + 重读）；一键解除 → 变为普通引用链接。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Link2, RefreshCw, Unlink } from 'lucide-react'
import { useKnowledgeEditorHost } from './knowledgeEditorHostContext'
import { listDocsInTreeOrder, resolveWikiTitle } from '../wikiLink'
import { extractAnchorBlock } from './sync'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { WikiLinkPicker } from '@/components/knowledge/WikiLinkPicker'

export const syncBlockSpec = createReactBlockSpec(
  {
    type: 'sync' as const,
    propSchema: {
      nodeId: { default: '' },
      title: { default: '' },
      anchor: { default: '' },
    },
    content: 'none' as const,
  },
  {
    parse: (el) => {
      if (el.getAttribute('data-hip-block') !== 'sync') return undefined
      return {
        nodeId: el.getAttribute('data-node-id') ?? '',
        title: el.getAttribute('data-title') ?? '',
        anchor: el.getAttribute('data-anchor') ?? '',
      }
    },
    toExternalHTML: ({ block }) => (
      <div
        data-hip-block="sync"
        data-node-id={String(block.props.nodeId ?? '')}
        data-title={String(block.props.title ?? '')}
        data-anchor={String(block.props.anchor ?? '')}
      />
    ),
    render: ({ block, editor }) => {
      const { t } = useTranslation()
      const host = useKnowledgeEditorHost()
      const nodeId = String(block.props.nodeId ?? '')
      const title = String(block.props.title ?? '')
      const anchor = String(block.props.anchor ?? '')
      const [mirror, setMirror] = useState<string>('')
      const [picker, setPicker] = useState(false)
      const [pickAnchor, setPickAnchor] = useState<{ top: number; left: number }>({
        top: 120,
        left: 120,
      })
      const nodeRef = useRef(nodeId)
      nodeRef.current = nodeId

      // 跟随更新：源文档在 store 中变化（编辑/保存）或焦点回归时重读。
      const storeTick = useKnowledgeStore((s) =>
        s.activeDocId === nodeRef.current
          ? `${s.docBody.length}:${s.draftBody.length}:${s.saveState}`
          : '',
      )
      const [focusTick, setFocusTick] = useState(0)
      useEffect(() => {
        const onFocus = () => setFocusTick((n) => n + 1)
        window.addEventListener('focus', onFocus)
        return () => window.removeEventListener('focus', onFocus)
      }, [])

      useEffect(() => {
        let cancelled = false
        if (!host.spaceId || !nodeId) {
          setMirror('')
          return
        }
        void import('@/ipc/knowledge')
          .then(({ knowledgeReadDoc }) =>
            knowledgeReadDoc(host.spaceId!, nodeId).catch(() => null),
          )
          .then((md) => {
            if (cancelled || md == null) return
            const hit = extractAnchorBlock(md, anchor)
            setMirror(hit?.md ?? '')
          })
          .catch(() => {
            if (!cancelled) setMirror('')
          })
        return () => {
          cancelled = true
        }
      }, [host.spaceId, nodeId, anchor, storeTick, focusTick])

      const docs = useMemo(() => listDocsInTreeOrder(host.nodes), [host.nodes])
      const resolvedNode = useMemo(
        () => (nodeId ? host.nodes.find((n) => n.id === nodeId) : null),
        [nodeId, host.nodes],
      )
      const displayTitle = title || resolvedNode?.title || '…'
      const selfRef = nodeId && host.spaceId != null && nodeId === useKnowledgeStore.getState().activeDocId

      const setSource = (pickedTitle: string, nodeIdRaw: string) => {
        // 自引用拒绝。
        if (nodeIdRaw === useKnowledgeStore.getState().activeDocId) {
          setPicker(false)
          return
        }
        editor.updateBlock(block, {
          props: { ...block.props, nodeId: nodeIdRaw, title: pickedTitle },
        })
        setPicker(false)
      }

      const unlink = () => {
        // 解除 = 变为普通引用链接（内容不再跟随）。
        const wikiText = anchor ? `[[${displayTitle}#${anchor}]]` : `[[${displayTitle}]]`
        try {
          const blocks = editor.tryParseMarkdownToBlocks(wikiText)
          const current = editor.getTextCursorPosition().block
          if (blocks.length > 0) {
            editor.replaceBlocks([current.id], blocks)
          }
        } catch {
          // ignore
        }
      }

      const navigate = () => {
        host.onWikiNavigate?.({
          title: displayTitle,
          nodeId: nodeId || null,
          broken: !nodeId,
          fragment: anchor || null,
        })
      }

      if (!nodeId) {
        return (
          <div className="kb-sync" data-testid="kb-sync-empty" contentEditable={false}>
            <button
              type="button"
              data-testid="kb-sync-pick"
              onClick={(e) => {
                setPickAnchor({ top: e.clientY, left: e.clientX })
                setPicker(true)
              }}
              className="kb-sync-action"
            >
              <Link2 size={13} aria-hidden />
              {t('knowledge.sync.pickSource')}
            </button>
            {picker ? (
              <WikiLinkPicker
                query=""
                nodes={docs}
                anchor={pickAnchor}
                onClose={() => setPicker(false)}
                onPick={(pickedTitle) => {
                  const hit = resolveWikiTitle(pickedTitle, docs)
                  setSource(pickedTitle, hit?.id ?? '')
                }}
              />
            ) : null}
          </div>
        )
      }

      return (
        <div className="kb-sync" data-testid="kb-sync-block" contentEditable={false}>
          <div className="kb-sync-head">
            <span className="kb-sync-title" onClick={navigate}>
              {displayTitle}
              <ExternalLink size={11} className="kb-sync-external" aria-hidden />
            </span>
            {selfRef ? (
              <span className="kb-sync-self" data-testid="kb-sync-self-ref">
                {t('knowledge.sync.selfRef')}
              </span>
            ) : null}
            <button
              type="button"
              data-testid="kb-sync-refresh"
              className="kb-sync-action"
              onClick={() => setFocusTick((n) => n + 1)}
            >
              <RefreshCw size={12} aria-hidden />
            </button>
            <button
              type="button"
              data-testid="kb-sync-unlink"
              className="kb-sync-action"
              title={t('knowledge.sync.unlink')}
              onClick={unlink}
            >
              <Unlink size={12} aria-hidden />
            </button>
          </div>
          <div className="kb-sync-body" data-testid="kb-sync-mirror">
            {mirror ? (
              <pre className="kb-sync-pre">{mirror}</pre>
            ) : (
              <span className="kb-sync-missing">{t('knowledge.sync.sourceMissing')}</span>
            )}
          </div>
        </div>
      )
    },
  },
)

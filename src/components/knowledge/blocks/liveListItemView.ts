/**
 * Live list_item NodeView: interactive GFM task checkboxes (R4).
 * checked == null → plain list item chrome; true/false → checkbox.
 */
import type { Node } from '@milkdown/kit/prose/model'
import type {
  EditorView,
  NodeView,
  NodeViewConstructor,
} from '@milkdown/kit/prose/view'
import { listItemSchema } from '@milkdown/kit/preset/commonmark'
import { $view } from '@milkdown/kit/utils'

class LiveListItemNodeView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement

  private node: Node
  private view: EditorView
  private getPos: () => number | undefined
  private checkbox: HTMLInputElement | null = null
  private labelWrap: HTMLElement | null = null

  constructor(
    node: Node,
    view: EditorView,
    getPos: () => number | undefined,
  ) {
    this.node = node
    this.view = view
    this.getPos = getPos

    this.dom = document.createElement('li')
    this.dom.className = 'knowledge-live-list-item'
    this.syncTaskAttrs(node)

    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'knowledge-live-list-item-content min-w-0 flex-1'

    if (node.attrs.checked != null) {
      this.mountTaskChrome(node)
    } else {
      this.dom.appendChild(this.contentDOM)
    }
  }

  private syncTaskAttrs(node: Node) {
    if (node.attrs.checked != null) {
      this.dom.setAttribute('data-item-type', 'task')
      this.dom.setAttribute('data-checked', String(node.attrs.checked))
      this.dom.setAttribute('data-testid', 'knowledge-live-task-item')
    } else {
      this.dom.removeAttribute('data-item-type')
      this.dom.removeAttribute('data-checked')
      this.dom.removeAttribute('data-testid')
    }
    if (node.attrs.label != null) {
      this.dom.dataset.label = String(node.attrs.label)
    }
    if (node.attrs.listType != null) {
      this.dom.dataset.listType = String(node.attrs.listType)
    }
  }

  private mountTaskChrome(node: Node) {
    this.dom.className =
      'knowledge-live-list-item knowledge-live-task my-0.5 flex list-none items-start gap-2'
    this.dom.style.listStyle = 'none'

    this.labelWrap = document.createElement('span')
    this.labelWrap.className = 'mt-1 flex shrink-0 items-center'
    this.labelWrap.contentEditable = 'false'

    this.checkbox = document.createElement('input')
    this.checkbox.type = 'checkbox'
    this.checkbox.checked = node.attrs.checked === true
    this.checkbox.setAttribute('data-testid', 'knowledge-live-task-checkbox')
    this.checkbox.setAttribute(
      'aria-checked',
      node.attrs.checked === true ? 'true' : 'false',
    )
    this.checkbox.setAttribute('aria-label', 'Task')
    this.checkbox.className =
      'h-3.5 w-3.5 cursor-pointer rounded border-border accent-[var(--accent)]'
    this.checkbox.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    this.checkbox.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (!this.view.editable) return
      const pos = this.getPos()
      if (pos == null) return
      const next = !(this.node.attrs.checked === true)
      this.view.dispatch(
        this.view.state.tr.setNodeAttribute(pos, 'checked', next),
      )
    })

    this.labelWrap.appendChild(this.checkbox)
    this.dom.append(this.labelWrap, this.contentDOM)
  }

  update(node: Node): boolean {
    if (node.type.name !== 'list_item') return false
    const wasTask = this.node.attrs.checked != null
    const isTask = node.attrs.checked != null
    if (wasTask !== isTask) return false
    this.node = node
    this.syncTaskAttrs(node)
    if (this.checkbox && isTask) {
      this.checkbox.checked = node.attrs.checked === true
      this.checkbox.setAttribute(
        'aria-checked',
        node.attrs.checked === true ? 'true' : 'false',
      )
    }
    return true
  }

  stopEvent(event: Event): boolean {
    const t = event.target as HTMLElement | null
    if (t && this.checkbox && (t === this.checkbox || this.checkbox.contains(t))) {
      return true
    }
    return false
  }

  ignoreMutation(
    mutation: MutationRecord | { type: string; target: globalThis.Node },
  ): boolean {
    const target = mutation.target
    if (!(target instanceof globalThis.Node)) return false
    if (target === this.contentDOM || this.contentDOM.contains(target)) {
      return false
    }
    if (this.checkbox && (target === this.checkbox || this.checkbox.contains(target))) {
      return true
    }
    if (this.labelWrap && this.labelWrap.contains(target)) return true
    return false
  }

  destroy() {
    this.checkbox = null
    this.labelWrap = null
  }
}

export const liveListItemView = $view(
  listItemSchema.node,
  (): NodeViewConstructor =>
    (node, view, getPos) =>
      new LiveListItemNodeView(node, view, getPos),
)

export const liveListItemPlugins = [liveListItemView]

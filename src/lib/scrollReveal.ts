/** Show overlay scrollbars while a pane is actively scrolling, then hide. */

const HIDE_MS = 900
const timers = new WeakMap<Element, number>()

function markScrolling(el: Element) {
  el.classList.add('is-scrolling')
  const prev = timers.get(el)
  if (prev != null) window.clearTimeout(prev)
  timers.set(
    el,
    window.setTimeout(() => {
      el.classList.remove('is-scrolling')
      timers.delete(el)
    }, HIDE_MS),
  )
}

function onScroll(e: Event) {
  const t = e.target
  if (t === document || t === document.documentElement) {
    markScrolling(document.documentElement)
    return
  }
  if (t instanceof Element) markScrolling(t)
}

/** Capture-phase scroll listener (bubbling does not fire on overflow panes). */
export function installScrollReveal(): () => void {
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  return () => document.removeEventListener('scroll', onScroll, true)
}

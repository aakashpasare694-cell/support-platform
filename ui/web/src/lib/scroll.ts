/**
 * Scroll helpers.
 *
 * Everything here degrades to an instant jump when the viewer has asked for
 * reduced motion. Smooth scrolling is the single most common trigger for
 * vestibular discomfort, so it is opt-out at the OS level, not a preference we
 * bury in settings.
 */

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function behavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}

/** Scroll a container to an absolute offset. */
export function scrollTo(el: HTMLElement | null, top = 0) {
  el?.scrollTo({ top, behavior: behavior() })
}

/** Scroll a container to its bottom — used after sending a reply. */
export function scrollToBottom(el: HTMLElement | null) {
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: behavior() })
}

/** Bring an element into view inside its nearest scroll container. */
export function scrollIntoView(el: HTMLElement | null, block: ScrollLogicalPosition = 'nearest') {
  el?.scrollIntoView({ behavior: behavior(), block })
}

/**
 * Lock background scrolling without the layout shifting sideways.
 *
 * Setting overflow:hidden removes the scrollbar, which widens the page by its
 * width and makes everything jump left the instant a dialog opens. Padding the
 * body by that exact width holds the layout still.
 */
export function lockBodyScroll(): () => void {
  const { body, documentElement } = document
  const gap = window.innerWidth - documentElement.clientWidth
  const prevOverflow = body.style.overflow
  const prevPadding = body.style.paddingRight

  body.style.overflow = 'hidden'
  if (gap > 0) body.style.paddingRight = `${gap}px`

  return () => {
    body.style.overflow = prevOverflow
    body.style.paddingRight = prevPadding
  }
}

/** "4m", "3h", "2d" — compact relative time for dense ticket lists. */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const abs = Math.abs(diff)
  const future = diff < 0
  const m = Math.round(abs / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return future ? `in ${m}m` : `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return future ? `in ${h}h` : `${h}h`
  const d = Math.round(h / 24)
  if (d < 30) return future ? `in ${d}d` : `${d}d`
  const mo = Math.round(d / 30)
  return future ? `in ${mo}mo` : `${mo}mo`
}

/** "Today 14:32", "Yesterday 09:04", "4 Nov, 09:04" — for message headers. */
export function messageTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  const sameDay = d.toDateString() === now.toDateString()
  const yest = new Date(now.getTime() - 86_400_000).toDateString() === d.toDateString()
  if (sameDay) return `Today ${time}`
  if (yest) return `Yesterday ${time}`
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`
}

export function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1]![0] : ''
  return (first + last).toUpperCase()
}

/** Strip HTML to a one-line preview for the ticket list. */
export function excerpt(html: string, max = 140): string {
  const text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&rsquo;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text
}

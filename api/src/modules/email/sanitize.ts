/**
 * Email HTML sanitizer.
 *
 * Customer email is the most hostile input this system takes: anyone can send
 * anything to a public support address. The raw body is kept for forensics and
 * NEVER served; this produces the only version the UI renders.
 *
 * Allowlist, not denylist — anything not explicitly permitted is dropped,
 * because an unknown tag is far more likely to be an attack than something a
 * support agent needed to read.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'div', 'span', 'a', 'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'hr', 'img', 'sub', 'sup', 'small',
])

/** Tags whose entire CONTENT is dropped, not just the tag. */
const VOID_CONTENT_TAGS = new Set(['script', 'style', 'head', 'title', 'iframe', 'object', 'embed', 'svg', 'math'])

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan']),
}

const SAFE_URL = /^(https?:|mailto:|tel:|cid:)/i

function escapeAttr(value: string): string {
  return value.split('&').join('&amp;').split('"').join('&quot;').split('<').join('&lt;').split('>').join('&gt;')
}

function escapeText(value: string): string {
  return value.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;')
}

function cleanAttributes(tag: string, attrText: string): string {
  const allowed = ALLOWED_ATTRS[tag]
  if (!allowed || !attrText.trim()) return ''

  const out: string[] = []
  const re = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g
  let m: RegExpExecArray | null

  while ((m = re.exec(attrText)) !== null) {
    const name = (m[1] ?? '').toLowerCase()
    const value = m[3] ?? m[4] ?? m[5] ?? ''
    if (!allowed.has(name)) continue

    if (name === 'href' || name === 'src') {
      // javascript:, data: and vbscript: are the whole reason this exists.
      if (!SAFE_URL.test(value.trim())) continue
    }
    out.push(`${name}="${escapeAttr(value)}"`)
  }

  // Every surviving link opens in a new tab without handing the opener over.
  if (tag === 'a') out.push('target="_blank"', 'rel="noopener noreferrer nofollow"')
  return out.length ? ' ' + out.join(' ') : ''
}

export function sanitizeEmailHtml(html: string): string {
  let out = html

  // Comments can hide conditional markup that some clients execute.
  out = out.replace(/<!--[\s\S]*?-->/g, '')

  // Drop dangerous elements INCLUDING their content.
  for (const tag of VOID_CONTENT_TAGS) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi'), '')
    out = out.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), '')
  }

  // Rewrite every remaining tag through the allowlist.
  out = out.replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (_full, slash: string, rawTag: string, attrs: string) => {
    const tag = rawTag.toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) return ''
    if (slash) return `</${tag}>`
    const selfClosing = tag === 'br' || tag === 'hr' || tag === 'img'
    return `<${tag}${cleanAttributes(tag, attrs)}${selfClosing ? '/' : ''}>`
  })

  // Anything that still looks like an event handler or a javascript URL did
  // not come through a tag we rewrote, so it is text — but belt and braces.
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  out = out.replace(/javascript:/gi, '')

  return out.trim()
}

/** Plain-text fallback, and what the ticket list preview is built from. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Plain text → safe HTML, for text-only mail and agent replies. */
export function textToHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeText(para).split('\n').join('<br/>')}</p>`)
    .join('')
}

/**
 * Strips the quoted history off a reply.
 *
 * Mail clients quote the entire previous thread, so without this every reply
 * stores a copy of everything before it and the timeline becomes unreadable.
 * Conservative on purpose: when no marker is found, keep the whole thing.
 */
export function stripQuotedReply(text: string): string {
  const markers = [
    /^\s*On .+ wrote:\s*$/m,
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^\s*_{10,}\s*$/m,
    /^\s*From:\s.+\n\s*Sent:\s/im,
  ]
  let cut = text.length
  for (const re of markers) {
    const m = re.exec(text)
    if (m && m.index < cut) cut = m.index
  }
  const trimmed = text.slice(0, cut).trim()
  return trimmed.length > 0 ? trimmed : text.trim()
}

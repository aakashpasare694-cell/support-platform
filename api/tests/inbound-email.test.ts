import { describe, expect, it } from 'vitest'
import { fromMime, detectAutoReply, parseReferences, recipientCandidates } from '../src/modules/email/inbound/normalize.ts'
import { normalizeSubject, ticketTokenFrom, ticketIdFromOwnMessageId } from '../src/modules/email/inbound/pipeline.ts'
import { sanitizeEmailHtml, htmlToText, stripQuotedReply } from '../src/modules/email/sanitize.ts'

const eml = (headers: string, body: string) => `${headers}\n\n${body}`

describe('MIME parsing', () => {
  it('pulls out the fields threading depends on', async () => {
    const mail = await fromMime(
      eml(
        [
          'Message-ID: <abc-123@mail.example.com>',
          'In-Reply-To: <prev-1@mail.example.com>',
          'References: <root-0@mail.example.com> <prev-1@mail.example.com>',
          'From: Eleanor Whitfield <Eleanor@Example.ORG>',
          'To: support@charityerp.com',
          'Delivered-To: erp@incomingmail.charityerp.com',
          'Subject: Receipts are failing',
          'Content-Type: text/plain',
        ].join('\n'),
        'Body text here.',
      ),
    )

    expect(mail.messageId).toBe('<abc-123@mail.example.com>')
    expect(mail.inReplyTo).toBe('<prev-1@mail.example.com>')
    expect(mail.references).toHaveLength(2)
    // Addresses are lower-cased so matching never depends on how it was typed.
    expect(mail.from.address).toBe('eleanor@example.org')
    expect(mail.from.name).toBe('Eleanor Whitfield')
    expect(mail.deliveredTo).toBe('erp@incomingmail.charityerp.com')
  })

  it('puts Delivered-To first when resolving the product', async () => {
    const mail = await fromMime(
      eml(
        ['From: a@b.co', 'To: support@charityerp.com', 'Delivered-To: erp@incomingmail.charityerp.com', 'Subject: x'].join('\n'),
        'hi',
      ),
    )
    // A forwarded message keeps the ORIGINAL recipient in To; the forwarding
    // address — the one mapped to a product — only appears in Delivered-To.
    expect(recipientCandidates(mail)[0]).toBe('erp@incomingmail.charityerp.com')
  })

  it('survives a message with no subject', async () => {
    const mail = await fromMime(eml(['From: a@b.co', 'To: c@d.co'].join('\n'), 'body'))
    expect(mail.subject).toBe('(no subject)')
  })
})

describe('auto-reply detection', () => {
  it.each([
    [{ 'auto-submitted': 'auto-replied' }, true],
    [{ 'auto-submitted': 'no' }, false],
    [{ precedence: 'bulk' }, true],
    [{ 'list-id': '<list.example.com>' }, true],
    [{ 'list-unsubscribe': '<mailto:x@y>' }, true],
    [{ 'x-auto-response-suppress': 'All' }, true],
    [{ from: 'a@b.co' }, false],
  ])('%o -> %s', (headers, expected) => {
    expect(detectAutoReply(headers as Record<string, string>)).toBe(expected)
  })
})

describe('threading helpers', () => {
  it('strips reply prefixes and ticket tokens from a subject', () => {
    expect(normalizeSubject('Re: Fwd: RE: Receipts failing [#ERP-1024]')).toBe('receipts failing')
    expect(normalizeSubject('AW: Antwort: Rechnung')).toBe('rechnung')
  })

  it('finds a ticket token in the subject', () => {
    expect(ticketTokenFrom('Re: anything [#ERP-1024]')).toBe('ERP-1024')
    expect(ticketTokenFrom('no token here')).toBeNull()
  })

  it('recovers the ticket id from our own Message-ID', () => {
    // This is the path that survives a customer editing the subject line.
    expect(ticketIdFromOwnMessageId('<t42.m7.a1b2c3@incomingmail.charityerp.com>')).toBe(42)
    expect(ticketIdFromOwnMessageId('<someone-elses@mail.com>')).toBeNull()
  })

  it('parses a References header into individual ids', () => {
    expect(parseReferences('<a@b> <c@d>')).toEqual(['<a@b>', '<c@d>'])
    expect(parseReferences(null)).toEqual([])
  })
})

describe('sanitizer', () => {
  it('removes script tags and their contents', () => {
    const out = sanitizeEmailHtml('<p>ok</p><script>steal()</script>')
    expect(out).not.toContain('script')
    expect(out).not.toContain('steal')
    expect(out).toContain('<p>ok</p>')
  })

  it('drops javascript: and data: urls but keeps real links', () => {
    const out = sanitizeEmailHtml('<a href="javascript:evil()">x</a><a href="https://ok.com">y</a>')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('https://ok.com')
  })

  it('strips inline event handlers', () => {
    expect(sanitizeEmailHtml('<p onclick="evil()">hi</p>')).not.toContain('onclick')
    expect(sanitizeEmailHtml('<img src="x" onerror="evil()"/>')).not.toContain('onerror')
  })

  it('hardens surviving links against tab-nabbing', () => {
    expect(sanitizeEmailHtml('<a href="https://ok.com">y</a>')).toContain('noopener')
  })

  it('removes styles, iframes and comments entirely', () => {
    const out = sanitizeEmailHtml('<style>body{}</style><iframe src="x"></iframe><!-- hidden -->text')
    expect(out).not.toContain('style')
    expect(out).not.toContain('iframe')
    expect(out).not.toContain('hidden')
  })

  it('keeps the formatting an agent actually needs to read', () => {
    const out = sanitizeEmailHtml('<p>a</p><ul><li>b</li></ul><table><tr><td>c</td></tr></table><strong>d</strong>')
    for (const tag of ['<p>', '<ul>', '<li>', '<table>', '<td>', '<strong>']) expect(out).toContain(tag)
  })

  it('converts html to readable text for the list preview', () => {
    expect(htmlToText('<p>One</p><p>Two</p>')).toBe('One\nTwo')
    expect(htmlToText('<p>a &amp; b</p>')).toContain('a & b')
  })

  it('trims the quoted history off a reply', () => {
    const text = 'My actual answer.\n\nOn Thu, 13 Nov 2026, Support wrote:\n> old thread\n> more old thread'
    expect(stripQuotedReply(text)).toBe('My actual answer.')
  })

  it('keeps the whole body when no quote marker is present', () => {
    expect(stripQuotedReply('Just one line.')).toBe('Just one line.')
  })
})

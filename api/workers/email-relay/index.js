/**
 * Email relay Worker.
 *
 * Cloudflare Email Routing delivers mail here; this forwards the raw MIME to
 * the support platform's inbound webhook and does nothing else.
 *
 * It is deliberately separate from the main API Worker and deliberately dumb:
 * no database, no parsing, no business logic. That means it works against a
 * localhost tunnel during development and against the production API later by
 * changing one variable — and it keeps working if the API is rewritten.
 */
export default {
  async email(message, env) {
    if (!env.INGEST_URL || !env.INBOUND_SECRET) {
      // Reject rather than drop: the sending server retries, so a
      // misconfiguration delays mail instead of losing it.
      message.setReject('Support platform relay is not configured')
      return
    }

    const raw = await new Response(message.raw).arrayBuffer()

    let res
    try {
      res = await fetch(env.INGEST_URL, {
        method: 'POST',
        headers: {
          'content-type': 'message/rfc822',
          'x-inbound-secret': env.INBOUND_SECRET,
          // Lets the pipeline dedupe retries of the same delivery.
          'x-message-id': message.headers.get('message-id') ?? '',
        },
        body: raw,
      })
    } catch (err) {
      message.setReject(`Support platform unreachable: ${err.message}`)
      return
    }

    if (!res.ok) {
      // 4xx means this message will never be accepted, so rejecting it now is
      // honest. 5xx is transient and also worth a retry.
      message.setReject(`Support platform returned HTTP ${res.status}`)
      return
    }

    // The API answers 2xx for created, appended, duplicate, ignored AND
    // unrouted — all of those are "handled", so the mail is accepted.
    console.log(`relayed ${message.from} -> ${message.to}: ${res.status}`)
  },
}

import type { WebhookSender, WebhookSendResult } from '../../application/ports/index.js';

/** HMAC signature header name (spec 08 §5). */
export const SIGNATURE_HEADER = 'X-PayOrder-Signature';

/**
 * HTTP webhook sender using the global `fetch`. A 2xx is success; any other status or a
 * network/timeout error is a failure that the dispatcher schedules for retry (spec 08 §5).
 */
export class FetchWebhookSender implements WebhookSender {
  constructor(private readonly timeoutMs = 10_000) {}

  async send(target: string, body: string, signature: string): Promise<WebhookSendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(target, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signature },
        body,
        signal: controller.signal,
      });
      return { ok: response.ok, status: response.status };
    } catch {
      return { ok: false, status: null };
    } finally {
      clearTimeout(timer);
    }
  }
}

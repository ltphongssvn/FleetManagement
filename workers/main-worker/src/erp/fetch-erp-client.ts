// workers/main-worker/src/erp/fetch-erp-client.ts
// Worker-side ERP HTTP adapter. Mirrors apps/api version but lives here so the
// worker can call ERP directly when draining the erp BullMQ queue.
import type { MappedErpPayload } from './erp-policy.js';
import type { ErpClientPort } from './erp-send-flow.js';

export interface FetchErpClientConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetchFn?: typeof globalThis.fetch;
}

export class FetchErpClient implements ErpClientPort {
  constructor(private readonly config: FetchErpClientConfig) {}

  async sendInvoice(payload: MappedErpPayload): Promise<{ externalInvoiceId: string }> {
    const fetchFn = this.config.fetchFn ?? globalThis.fetch;
    const res = await fetchFn(`${this.config.baseUrl}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': this.config.apiKey },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`ERP /invoices HTTP ${String(res.status)} ${res.statusText} ${detail}`);
    }
    const json = (await res.json()) as { externalInvoiceId?: unknown };
    if (typeof json.externalInvoiceId !== 'string')
      throw new Error('ERP response missing externalInvoiceId');
    return { externalInvoiceId: json.externalInvoiceId };
  }
}

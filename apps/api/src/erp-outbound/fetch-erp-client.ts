// apps/api/src/erp-outbound/fetch-erp-client.ts
// Outbound ERP HTTP client. Worker calls this via /erp/send-invoice callback
// or API uses it directly when draining the erp BullMQ queue.
import type { MappedErpPayload } from '@fleet/sync-protocol';

export interface ErpClient {
  sendInvoice(payload: MappedErpPayload): Promise<{ externalInvoiceId: string }>;
}

export interface FetchErpClientConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetchFn?: typeof globalThis.fetch;
}

export class FetchErpClient implements ErpClient {
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
    if (typeof json.externalInvoiceId !== 'string') {
      throw new Error('ERP response missing externalInvoiceId');
    }
    return { externalInvoiceId: json.externalInvoiceId };
  }
}

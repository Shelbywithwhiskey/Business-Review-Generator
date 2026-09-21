// Generic Zuper API client.
//
// IMPORTANT: endpoint paths and response field names below are best-guess
// based on common Zuper REST conventions and MUST be verified against your
// account's API reference (https://developers.zuperpro.com) before a real
// sync. Adjust the `path` and field mappings in modules.ts — the pagination
// and auth handling here should not need to change.

export class ZuperApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message);
    this.name = "ZuperApiError";
  }
}

export class ZuperClient {
  constructor(
    private apiKey: string,
    private baseUrl: string = process.env.ZUPER_API_BASE_URL ?? "https://api.zuperpro.com"
  ) {}

  private async request<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const res = await fetch(url.toString(), {
      headers: {
        "x-api-key": this.apiKey,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      throw new ZuperApiError(`Zuper API ${res.status} on ${path}`, res.status, body);
    }

    return res.json() as Promise<T>;
  }

  /** Generic paginated GET, yields one page of items at a time. */
  async *paginate<T>(
    path: string,
    itemsKey: string,
    baseParams: Record<string, string | number | undefined> = {},
    pageSize = 100
  ): AsyncGenerator<T[]> {
    let page = 1;
    while (true) {
      const data = await this.request<Record<string, unknown>>(path, {
        ...baseParams,
        page,
        per_page: pageSize,
      });
      const items = (data[itemsKey] ?? []) as T[];
      if (items.length === 0) return;
      yield items;
      if (items.length < pageSize) return;
      page += 1;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.request("/api/organization", {});
      return true;
    } catch {
      return false;
    }
  }
}

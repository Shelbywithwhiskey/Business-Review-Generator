// Zuper API client.
//
// Base URL, auth, pagination, and every endpoint path used in modules.ts
// were verified live against two real Zuper accounts (2026-09-22). Two
// things learned that are NOT what Zuper's general developer docs describe:
//   1. The data-center base URL is per-tenant and must be discovered via
//      accounts.zuperpro.com — it is not a fixed "east"/"west" domain, and
//      guessing wrong 404s or 503s.
//   2. None of start_date/end_date/from/to/created_from/created_to filter
//      list endpoints server-side — total_records was identical with or
//      without them on every endpoint tested. So this client always pulls
//      full history; period filtering happens locally in lib/analytics.ts
//      against the synced rows.

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

export interface ZuperDiscoveredConfig {
  apiBaseUrl: string;
  /** Workflow Builder lives on its own host (dc_workflow_builder_url) — not derivable from apiBaseUrl. Absent if the account has no Workflow Builder access. */
  workflowBaseUrl: string | null;
}

/** Resolves a company's Zuper login name to its real data-center API base URL (e.g. https://us-east-1.zuperpro.com/api) and, separately, its Workflow Builder host. */
export async function discoverZuperConfig(companyName: string): Promise<ZuperDiscoveredConfig> {
  const res = await fetch("https://accounts.zuperpro.com/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_name: companyName }),
  });
  if (!res.ok) {
    throw new ZuperApiError(`Could not resolve Zuper data center for "${companyName}"`, res.status);
  }
  const body = (await res.json()) as {
    config?: { dc_api_url?: string; dc_workflow_builder_url?: string };
  };
  const dcApiUrl = body.config?.dc_api_url;
  if (!dcApiUrl) {
    throw new ZuperApiError(`Zuper data-center discovery returned no dc_api_url for "${companyName}"`, 502, body);
  }
  const dcWorkflowUrl = body.config?.dc_workflow_builder_url;
  return {
    apiBaseUrl: `${dcApiUrl.replace(/\/$/, "")}/api`,
    workflowBaseUrl: dcWorkflowUrl ? `${dcWorkflowUrl.replace(/\/$/, "")}/api` : null,
  };
}

/** @deprecated use discoverZuperConfig — kept so any other call sites don't break. */
export async function discoverZuperBaseUrl(companyName: string): Promise<string> {
  return (await discoverZuperConfig(companyName)).apiBaseUrl;
}

interface ListEnvelope<T> {
  data: T[];
  total_records?: number;
  total_pages?: number;
  current_page?: number;
}

export class ZuperClient {
  constructor(
    private apiKey: string,
    /** Must already include the /api suffix — see discoverZuperBaseUrl. */
    private baseUrl: string
  ) {}

  private async request<T>(
    path: string,
    params: Record<string, string | number | undefined> = {},
    init: { method?: "GET" | "POST"; body?: unknown } = {}
  ): Promise<T> {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    const query = qs.toString();
    const url = `${this.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}${query ? `?${query}` : ""}`;

    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(url, {
        method: init.method ?? "GET",
        headers: {
          "x-api-key": this.apiKey,
          Accept: "application/json",
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      // Rate limited (200–700 req/min by plan): honour Retry-After, up to 3 retries.
      if (res.status !== 429 || attempt >= 3) break;
      const wait = Math.min(Number(res.headers.get("retry-after") ?? 5), 30);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }

    const text = await res.text();
    if (!res.ok) {
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // non-JSON error body (e.g. an HTML 404 page from a wrong path) — keep raw text
      }
      // Zuper's own reason (e.g. "Invalid API key", a missing permission) — never contains the key.
      const reason = typeof body === "object" && body && "message" in body && typeof body.message === "string" ? body.message : null;
      const where = path.split("?")[0].replace(/^\//, "");
      throw new ZuperApiError(`Zuper API ${res.status} on ${where}${reason ? `: ${reason.slice(0, 200)}` : ""}`, res.status, body);
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ZuperApiError(`Zuper API returned non-JSON response on ${path}`, res.status, text.slice(0, 500));
    }
  }

  /** Paginated GET against the standard {data: [...], total_records, total_pages, current_page} envelope. Max count is 1000. */
  async *paginate<T>(
    path: string,
    baseParams: Record<string, string | number | undefined> = {},
    pageSize = 200
  ): AsyncGenerator<T[]> {
    let page = 1;
    while (true) {
      // Most endpoints read `count`; Workflow Builder reads `limit` instead — send both, harmless either way.
      const res = await this.request<ListEnvelope<T>>(path, { ...baseParams, page, count: pageSize, limit: pageSize });
      const items = res.data ?? [];
      if (items.length === 0) return;
      yield items;
      const totalPages = res.total_pages ?? page;
      if (page >= totalPages || items.length < pageSize) return;
      page += 1;
    }
  }

  /** For endpoints with a nested list, e.g. GET /timesheets -> { data: { timesheets: [...] } }. */
  async *paginateNested<T>(
    path: string,
    nestedKey: string,
    baseParams: Record<string, string | number | undefined> = {},
    pageSize = 200
  ): AsyncGenerator<T[]> {
    let page = 1;
    while (true) {
      const res = await this.request<{ data: Record<string, unknown>; total_pages?: number }>(path, {
        ...baseParams,
        page,
        count: pageSize,
      });
      const items = (res.data?.[nestedKey] as T[]) ?? [];
      if (items.length === 0) return;
      yield items;
      const totalPages = res.total_pages ?? page;
      if (page >= totalPages || items.length < pageSize) return;
      page += 1;
    }
  }

  /** Whole response envelope, e.g. when total_records is the value you want. */
  async getRaw<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    return this.request<T>(path, params);
  }

  /** POST with a JSON body, whole response envelope (Zuper Connect list endpoints are POST + filters). */
  async postRaw<T>(path: string, body: unknown, params: Record<string, string | number | undefined> = {}): Promise<T> {
    return this.request<T>(path, params, { method: "POST", body });
  }

  /** For endpoints that return a single {data: {...}} object, e.g. GET /team. */
  async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const res = await this.request<{ data: T }>(path, params);
    return res.data;
  }

  /** Checks the key against /organization and /jobs — a key can read the former yet be refused the
   * latter, and jobs is the first thing a sync pulls. Returns null when both work, else the failure. */
  async testConnection(): Promise<string | null> {
    try {
      await this.request("/organization", {});
      await this.request("/jobs", { page: 1, count: 1 });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }
}

const DEFAULT_BASE_URL = "https://intervals.icu/api/v1";

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: unknown;
}

export class IntervalsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "IntervalsError";
  }
}

/** intervals.icu athlete ids look like `i123456`; accept a bare number too. */
export function normalizeAthleteId(id: string): string {
  const trimmed = id.trim();
  return /^\d+$/.test(trimmed) ? `i${trimmed}` : trimmed;
}

export class IntervalsClient {
  readonly #authorization: string;
  readonly #baseUrl: string;
  #athleteId: string | undefined;
  #athleteIdLookup: Promise<string> | undefined;

  constructor(opts: { apiKey: string; athleteId?: string | undefined; baseUrl?: string }) {
    if (!opts.apiKey) {
      throw new Error("Missing intervals.icu API key (set INTERVALS_API_KEY)");
    }
    const credentials = Buffer.from(`API_KEY:${opts.apiKey}`).toString("base64");
    this.#authorization = `Basic ${credentials}`;
    this.#baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#athleteId = opts.athleteId ? normalizeAthleteId(opts.athleteId) : undefined;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = "GET", query, body } = options;
    const url = new URL(this.#baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      Authorization: this.#authorization,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      throw new IntervalsError(
        await describeFailure(response, method, url.pathname),
        response.status,
        await safeText(response),
      );
    }

    const text = await safeText(response);
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  /** The athlete the API key belongs to, resolved once and cached. */
  async athleteId(): Promise<string> {
    if (this.#athleteId) return this.#athleteId;
    this.#athleteIdLookup ??= this.#lookupAthleteId();
    const id = await this.#athleteIdLookup;
    this.#athleteId = id;
    return id;
  }

  /** Path helper: `athletePath("/events")` -> `/athlete/i123/events`. */
  async athletePath(suffix: string): Promise<string> {
    return `/athlete/${await this.athleteId()}${suffix}`;
  }

  async #lookupAthleteId(): Promise<string> {
    // `0` is the intervals.icu shorthand for "the authenticated athlete".
    try {
      const me = await this.request<{ id?: string }>("/athlete/0");
      if (me?.id) return normalizeAthleteId(me.id);
    } catch (error) {
      if (error instanceof IntervalsError && (error.status === 401 || error.status === 403)) throw error;
    }
    // Fallback: the athlete list includes the caller; unambiguous only when it is the sole entry.
    const athletes = await this.request<Array<{ id?: string }>>("/athletes");
    if (Array.isArray(athletes) && athletes.length === 1 && athletes[0]?.id) {
      return normalizeAthleteId(athletes[0].id);
    }
    throw new Error(
      "Could not auto-detect the athlete id. Set INTERVALS_ATHLETE_ID (e.g. i123456) — " +
        "you can read it from the URL of your intervals.icu profile page.",
    );
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

async function describeFailure(response: Response, method: string, path: string): Promise<string> {
  const body = await safeText(response.clone());
  const detail = extractMessage(body);
  const where = `${method} ${path}`;
  switch (response.status) {
    case 401:
    case 403:
      return `${where} → ${response.status} unauthorized. Check INTERVALS_API_KEY (intervals.icu → Settings → Developer Settings) and that INTERVALS_ATHLETE_ID belongs to that key.${detail}`;
    case 404:
      return `${where} → 404 not found. The id may not exist or may not be visible to this API key.${detail}`;
    case 422:
    case 400:
      return `${where} → ${response.status} rejected by intervals.icu. Often a workout syntax or field error.${detail}`;
    case 429:
      return `${where} → 429 rate limited by intervals.icu. Retry in a moment.${detail}`;
    default:
      return `${where} → HTTP ${response.status}.${detail}`;
  }
}

function extractMessage(body: string): string {
  if (!body) return "";
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const message = record["error"] ?? record["message"] ?? record["errors"];
      if (message) return ` Details: ${typeof message === "string" ? message : JSON.stringify(message)}`;
    }
  } catch {
    /* not JSON */
  }
  return ` Details: ${body.slice(0, 500)}`;
}

import type { Dataset, DataMode } from "../shared/domain";
export interface AppState {
  mode: DataMode;
  storage?: { kind: "ephemeral"; durable: false; notice: string };
  data: Dataset;
  integrations: {
    provider: string;
    status: string;
    lastSyncedAt: string | null;
    error: string | null;
    configured?: boolean;
    verifiedAt?: string | null;
    detail?: Record<string, unknown> | null;
  }[];
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  let data: any = null;

  if (raw && contentType.includes("application/json")) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const fallback = raw
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const detail = typeof data?.detail === "string" ? data.detail.trim() : "";
    const message =
      typeof data?.error === "string" && data.error.trim()
        ? `${data.error}${detail ? `: ${detail}` : ""}`
        : fallback.slice(0, 240) || `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  if (data !== null) return data as T;

  throw new ApiError(
    `API returned an unexpected response (${response.status})`,
    response.status,
  );
}

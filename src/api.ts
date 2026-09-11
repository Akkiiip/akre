import type { Dataset, DataMode } from "../shared/domain";
export interface AppState {
  mode: DataMode;
  data: Dataset;
  integrations: {
    provider: string;
    status: string;
    lastSyncedAt: string | null;
    error: string | null;
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
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(data.error ?? "Request failed", response.status);
  return data;
}

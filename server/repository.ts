import type { DataMode, Dataset } from "../shared/domain";

/** The synchronous contract used by AKRE's deterministic domain/service layer. */
export interface RepositoryContract {
  readonly mode: DataMode;
  transaction<T>(fn: () => T): T;
  list<K extends keyof Dataset>(kind: K): Dataset[K];
  get<K extends keyof Dataset>(kind: K, id: string): Dataset[K][number];
  put<K extends keyof Dataset>(kind: K, entity: Dataset[K][number]): void;
  snapshot(): Dataset;
  close(): void;
}

export const datasetKinds = [
  "scoreHistory",
  "connections",
  "products",
  "opportunities",
  "sources",
  "observations",
  "signals",
  "suppliers",
  "offers",
  "variants",
  "costs",
  "stores",
  "listings",
  "assets",
  "experiments",
  "metrics",
  "orders",
  "orderItems",
  "decisions",
  "jobs",
  "audit",
] as const satisfies readonly (keyof Dataset)[];

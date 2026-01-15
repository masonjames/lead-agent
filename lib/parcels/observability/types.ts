/**
 * Parcel Ingestion Observability Types
 */

export interface ParcelIngestionObserver {
  onRunStart(meta: { runId: string; sourceKey: string; input: unknown }): void;
  onStepStart(meta: { runId: string; step: string }): void;
  onStepEnd(meta: {
    runId: string;
    step: string;
    ok: boolean;
    durationMs: number;
    data?: unknown;
  }): void;
  onRunEnd(meta: {
    runId: string;
    ok: boolean;
    durationMs: number;
    error?: string;
  }): void;
  increment(name: string, by?: number, tags?: Record<string, string>): void;
  timing(name: string, durationMs: number, tags?: Record<string, string>): void;
}

export interface ObserverMetrics {
  counters: Record<string, number>;
  timings: Record<string, number[]>;
  steps: Array<{
    step: string;
    ok: boolean;
    durationMs: number;
    data?: unknown;
  }>;
}

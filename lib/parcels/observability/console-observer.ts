/**
 * Console Observer
 * 
 * Default observer implementation that logs structured JSON
 * to console for easy parsing in hosted log systems.
 */

import type { ParcelIngestionObserver, ObserverMetrics } from "./types";

export class ConsoleObserver implements ParcelIngestionObserver {
  private metrics: ObserverMetrics = {
    counters: {},
    timings: {},
    steps: [],
  };

  onRunStart(meta: { runId: string; sourceKey: string; input: unknown }): void {
    console.log(
      JSON.stringify({
        event: "parcel_ingestion_run_start",
        runId: meta.runId,
        sourceKey: meta.sourceKey,
        input: meta.input,
        timestamp: new Date().toISOString(),
      })
    );
  }

  onStepStart(meta: { runId: string; step: string }): void {
    console.log(
      JSON.stringify({
        event: "parcel_ingestion_step_start",
        runId: meta.runId,
        step: meta.step,
        timestamp: new Date().toISOString(),
      })
    );
  }

  onStepEnd(meta: {
    runId: string;
    step: string;
    ok: boolean;
    durationMs: number;
    data?: unknown;
  }): void {
    this.metrics.steps.push({
      step: meta.step,
      ok: meta.ok,
      durationMs: meta.durationMs,
      data: meta.data,
    });

    console.log(
      JSON.stringify({
        event: "parcel_ingestion_step_end",
        runId: meta.runId,
        step: meta.step,
        ok: meta.ok,
        durationMs: meta.durationMs,
        data: meta.data,
        timestamp: new Date().toISOString(),
      })
    );
  }

  onRunEnd(meta: {
    runId: string;
    ok: boolean;
    durationMs: number;
    error?: string;
  }): void {
    console.log(
      JSON.stringify({
        event: "parcel_ingestion_run_end",
        runId: meta.runId,
        ok: meta.ok,
        durationMs: meta.durationMs,
        error: meta.error,
        metrics: this.metrics,
        timestamp: new Date().toISOString(),
      })
    );
  }

  increment(name: string, by = 1, tags?: Record<string, string>): void {
    const key = tags ? `${name}:${JSON.stringify(tags)}` : name;
    this.metrics.counters[key] = (this.metrics.counters[key] || 0) + by;
  }

  timing(name: string, durationMs: number, tags?: Record<string, string>): void {
    const key = tags ? `${name}:${JSON.stringify(tags)}` : name;
    if (!this.metrics.timings[key]) {
      this.metrics.timings[key] = [];
    }
    this.metrics.timings[key].push(durationMs);
  }

  getMetrics(): ObserverMetrics {
    return { ...this.metrics };
  }
}

/**
 * Create a new console observer instance.
 */
export function createConsoleObserver(): ConsoleObserver {
  return new ConsoleObserver();
}

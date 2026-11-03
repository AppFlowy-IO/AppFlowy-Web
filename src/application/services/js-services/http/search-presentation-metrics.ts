import { getAxios } from './core';

export interface SearchPresentationMetrics {
  transport: 'stream' | 'legacy';
  mode: 'hybrid' | 'keyword';
  outcome: 'complete' | 'degraded' | 'superseded' | 'error' | 'cancelled';
  elapsed_ms: number;
  first_result_visible_ms?: number;
  all_results_received_ms?: number;
  final_results_visible_ms?: number;
}

/** Best-effort, single-attempt client timings. Never shares the search's cancellation signal. */
export async function reportSearchPresentationMetrics(
  workspaceId: string,
  metrics: SearchPresentationMetrics
): Promise<void> {
  try {
    await getAxios()?.post(`/api/search/${encodeURIComponent(workspaceId)}/stream/metrics`, metrics, {
      timeout: 3_000,
      skipTransportRetry: true,
      // Telemetry must not rotate credentials, invalidate a session, or replay a failed report.
      skipAuthRefresh: true,
    });
  } catch {
    // Observability must never affect search results or display a user-facing error.
  }
}

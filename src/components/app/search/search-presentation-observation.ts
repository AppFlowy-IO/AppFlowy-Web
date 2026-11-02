import type { SearchPresentationMetrics } from '@/application/services/domains/search';

const MAX_OBSERVATION_MS = 120_000;

type Outcome = SearchPresentationMetrics['outcome'];
type CancelPaint = () => void;
type AfterPaint = (callback: () => void) => CancelPaint;

/** Wait for a visible document and two frames: a paint opportunity, not a hardware-paint guarantee. */
export function afterVisibleSearchPaint(callback: () => void): CancelPaint {
  let firstFrame: number | undefined;
  let secondFrame: number | undefined;
  let disposed = false;
  const clearFrames = () => {
    if (firstFrame !== undefined) cancelAnimationFrame(firstFrame);
    if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
    firstFrame = undefined;
    secondFrame = undefined;
  };

  const dispose = () => {
    disposed = true;
    clearFrames();
    document.removeEventListener('visibilitychange', schedule);
  };

  const schedule = () => {
    clearFrames();
    if (disposed || document.visibilityState !== 'visible') return;
    firstFrame = requestAnimationFrame(() => {
      firstFrame = undefined;
      if (disposed || document.visibilityState !== 'visible') return;
      secondFrame = requestAnimationFrame(() => {
        secondFrame = undefined;
        if (disposed || document.visibilityState !== 'visible') return;
        dispose();
        callback();
      });
    });
  };

  document.addEventListener('visibilitychange', schedule);
  schedule();
  return dispose;
}

/** Own one issued query's presentation lifecycle, independently of summary and later page requests. */
export class SearchPresentationObservation {
  private issued = false;
  private ended = false;
  private transport: SearchPresentationMetrics['transport'] = 'stream';
  private mode: SearchPresentationMetrics['mode'];
  private outcome?: Outcome;
  private firstVisible?: number;
  private allReceived?: number;
  private finalVisible?: number;
  private hasRows = false;
  private finalRowsSettled = false;
  private cancelFirstPaint?: CancelPaint;
  private cancelFinalPaint?: CancelPaint;
  private deadline: ReturnType<typeof setTimeout>;
  private readonly now: () => number;
  private readonly afterPaint: AfterPaint;

  constructor(
    private readonly options: {
      startedAt: number;
      mode: SearchPresentationMetrics['mode'];
      report: (metrics: SearchPresentationMetrics) => void;
      now?: () => number;
      afterPaint?: AfterPaint;
    }
  ) {
    this.mode = options.mode;
    this.now = options.now ?? (() => performance.now());
    this.afterPaint = options.afterPaint ?? afterVisibleSearchPaint;
    // A hidden tab can postpone paint indefinitely. Bound the observer without cancelling search.
    this.deadline = setTimeout(() => {
      if (this.outcome) this.flush(this.outcome);
      else this.dispose();
    }, Math.max(0, MAX_OBSERVATION_MS - this.elapsed()));
  }

  issue(): void {
    if (!this.ended) this.issued = true;
  }

  useLegacy(): void {
    this.transport = 'legacy';
    this.mode = 'keyword';
  }

  /** Called after React commits; raw snapshots without routable metadata do not count as visible. */
  committedRows(hasRows: boolean, finalRowsSettled: boolean): void {
    this.hasRows = hasRows;
    this.finalRowsSettled = finalRowsSettled;
    if (!this.issued || this.ended) return;
    if (!hasRows) {
      this.cancelFirstPaint?.();
      this.cancelFirstPaint = undefined;
    } else if (this.firstVisible === undefined && !this.cancelFirstPaint) {
      this.cancelFirstPaint = this.afterPaint(() => {
        this.cancelFirstPaint = undefined;
        if (this.ended || !this.hasRows) return;
        this.firstVisible = this.sample();
        this.finishIfReady();
      });
    }

    // A final commit may arrive between the keyword paint's two frames. Its own
    // schedule ensures both final frames happen after final metadata/rows commit.
    if (!finalRowsSettled) {
      this.cancelFinalPaint?.();
      this.cancelFinalPaint = undefined;
    } else if (this.finalVisible === undefined && !this.cancelFinalPaint) {
      this.cancelFinalPaint = this.afterPaint(() => {
        this.cancelFinalPaint = undefined;
        if (this.ended || !this.finalRowsSettled) return;
        this.finalVisible = this.sample();
        this.finishIfReady();
      });
    }
  }

  /** Stream callers invoke this only after validated EOF; legacy callers after the initial page. */
  received(outcome: 'complete' | 'degraded'): void {
    if (this.ended) return;
    this.allReceived = this.sample();
    this.outcome = outcome;
    this.finishIfReady();
  }

  terminate(outcome: 'superseded' | 'error' | 'cancelled'): void {
    this.flush(outcome);
  }

  private finishIfReady(): void {
    if (this.outcome && this.finalVisible !== undefined) this.flush(this.outcome);
  }

  private elapsed(): number {
    return Math.max(0, this.now() - this.options.startedAt);
  }

  private sample(): number | undefined {
    const elapsed = Math.round(this.elapsed());

    return elapsed <= MAX_OBSERVATION_MS ? elapsed : undefined;
  }

  private flush(outcome: Outcome): void {
    if (this.ended) return;
    const metrics: SearchPresentationMetrics = {
      transport: this.transport,
      mode: this.mode,
      outcome,
      elapsed_ms: Math.min(MAX_OBSERVATION_MS, Math.round(this.elapsed())),
      ...(this.firstVisible !== undefined ? { first_result_visible_ms: this.firstVisible } : {}),
      ...(this.allReceived !== undefined ? { all_results_received_ms: this.allReceived } : {}),
      ...(this.finalVisible !== undefined ? { final_results_visible_ms: this.finalVisible } : {}),
    };

    this.dispose();
    if (this.issued) {
      try {
        this.options.report(metrics);
      } catch {
        // Reporting remains best-effort even if the adapter is unavailable during teardown.
      }
    }
  }

  private dispose(): void {
    this.ended = true;
    clearTimeout(this.deadline);
    this.cancelFirstPaint?.();
    this.cancelFirstPaint = undefined;
    this.cancelFinalPaint?.();
    this.cancelFinalPaint = undefined;
  }
}

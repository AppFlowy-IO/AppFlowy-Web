import { afterVisibleSearchPaint, SearchPresentationObservation } from '../search-presentation-observation';

function harness() {
  let now = 0;
  const paints = new Set<() => void>();
  const report = jest.fn();
  const cancelPaint = jest.fn();
  const afterPaint = jest.fn((callback: () => void) => {
    paints.add(callback);
    return () => {
      paints.delete(callback);
      cancelPaint();
    };
  });
  const observation = new SearchPresentationObservation({
    startedAt: 0,
    mode: 'hybrid',
    report,
    now: () => now,
    afterPaint,
  });

  return {
    observation,
    report,
    afterPaint,
    cancelPaint,
    at: (time: number) => {
      now = time;
    },
    paint: () => {
      const callbacks = [...paints];

      paints.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('SearchPresentationObservation', () => {
  it('includes debounce, separates routable paint from final snapshot and waits for EOF', () => {
    const h = harness();

    h.at(300);
    h.observation.issue();
    h.at(450);
    h.observation.committedRows(false, false);
    expect(h.afterPaint).not.toHaveBeenCalled();
    h.at(500);
    h.observation.committedRows(true, false);
    h.at(516);
    h.paint();
    expect(h.report).not.toHaveBeenCalled();
    h.at(1_000);
    h.observation.committedRows(true, true);
    h.at(1_020);
    h.paint();
    expect(h.report).not.toHaveBeenCalled();
    h.at(1_100);
    h.observation.received('complete');
    expect(h.report).toHaveBeenCalledWith({
      transport: 'stream',
      mode: 'hybrid',
      outcome: 'complete',
      elapsed_ms: 1_100,
      first_result_visible_ms: 516,
      final_results_visible_ms: 1_020,
      all_results_received_ms: 1_100,
    });
    h.observation.terminate('cancelled');
    expect(h.report).toHaveBeenCalledTimes(1);
  });

  it('waits for final metadata and paint when EOF arrives first', () => {
    const h = harness();

    h.observation.issue();
    h.at(400);
    h.observation.received('degraded');
    h.observation.committedRows(false, false);
    expect(h.report).not.toHaveBeenCalled();
    h.at(750);
    h.observation.committedRows(true, true);
    h.at(800);
    h.paint();
    expect(h.report).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'degraded',
        all_results_received_ms: 400,
        first_result_visible_ms: 800,
        final_results_visible_ms: 800,
        elapsed_ms: 800,
      })
    );
  });

  it('reports a partial cancellation once and cancels pending paint', () => {
    const h = harness();

    h.observation.issue();
    h.at(350);
    h.observation.committedRows(true, false);
    h.paint();
    h.observation.committedRows(true, true);
    h.at(500);
    h.observation.terminate('cancelled');
    h.paint();
    h.observation.received('complete');
    h.observation.terminate('error');
    expect(h.cancelPaint).toHaveBeenCalledTimes(1);
    expect(h.report).toHaveBeenCalledTimes(1);
    expect(h.report).toHaveBeenCalledWith({
      transport: 'stream',
      mode: 'hybrid',
      outcome: 'cancelled',
      elapsed_ms: 500,
      first_result_visible_ms: 350,
    });
  });

  it('does not report input abandoned before any API request', () => {
    const h = harness();

    h.at(200);
    h.observation.committedRows(true, true);
    h.observation.terminate('cancelled');
    expect(h.afterPaint).not.toHaveBeenCalled();
    expect(h.report).not.toHaveBeenCalled();
  });

  it('counts empty legacy completion without inventing a first result', () => {
    const h = harness();

    h.observation.issue();
    h.observation.useLegacy();
    h.at(600);
    h.observation.received('complete');
    h.observation.committedRows(false, true);
    h.at(630);
    h.paint();
    expect(h.report).toHaveBeenCalledWith({
      transport: 'legacy',
      mode: 'keyword',
      outcome: 'complete',
      elapsed_ms: 630,
      all_results_received_ms: 600,
      final_results_visible_ms: 630,
    });
  });

  it.each(['error', 'superseded'] as const)('flushes %s without inventing an EOF or final visibility', (outcome) => {
    const h = harness();

    h.observation.issue();
    h.at(400);
    h.observation.terminate(outcome);
    expect(h.report).toHaveBeenCalledWith({ transport: 'stream', mode: 'hybrid', outcome, elapsed_ms: 400 });
  });

  it('flushes known terminal timings at the lifetime bound without clamping a missing visibility sample', () => {
    const h = harness();

    h.observation.issue();
    h.at(500);
    h.observation.received('complete');
    h.observation.committedRows(true, true);
    h.at(120_001);
    jest.advanceTimersByTime(120_000);
    expect(h.report).toHaveBeenCalledWith({
      transport: 'stream',
      mode: 'hybrid',
      outcome: 'complete',
      elapsed_ms: 120_000,
      all_results_received_ms: 500,
    });
    expect(h.cancelPaint).toHaveBeenCalledTimes(2);
    h.paint();
    h.observation.terminate('cancelled');
    expect(h.report).toHaveBeenCalledTimes(1);
  });

  it('drops an expired observer with no terminal outcome and releases resources', () => {
    const h = harness();

    h.observation.issue();
    h.observation.committedRows(true, false);
    h.at(120_000);
    jest.advanceTimersByTime(120_000);
    h.paint();
    h.observation.received('complete');
    expect(h.cancelPaint).toHaveBeenCalledTimes(1);
    expect(h.report).not.toHaveBeenCalled();
  });

  it.each(['complete', 'degraded'] as const)('ends the initial %s window before pending final paint', (outcome) => {
    const h = harness();

    h.observation.issue();
    h.at(350);
    h.observation.committedRows(true, false);
    h.paint();
    h.at(400);
    h.observation.received(outcome);
    h.observation.committedRows(true, true);
    h.at(500);
    h.observation.finishInitialWindow();
    expect(h.report).toHaveBeenCalledWith({
      transport: 'stream',
      mode: 'hybrid',
      outcome,
      elapsed_ms: 500,
      first_result_visible_ms: 350,
      all_results_received_ms: 400,
    });
    expect(h.cancelPaint).toHaveBeenCalledTimes(1);
    h.paint();
    h.observation.terminate('cancelled');
    expect(h.report).toHaveBeenCalledTimes(1);
  });

  it('drops an initial window without a known terminal outcome and detaches pending paint', () => {
    const h = harness();

    h.observation.issue();
    h.observation.committedRows(true, false);
    h.observation.finishInitialWindow();
    h.paint();
    h.observation.received('complete');
    expect(h.cancelPaint).toHaveBeenCalledTimes(1);
    expect(h.report).not.toHaveBeenCalled();
  });

  it('omits a milestone beyond the accepted duration instead of clamping it', () => {
    const h = harness();

    h.observation.issue();
    h.at(400);
    h.observation.received('complete');
    h.observation.committedRows(true, true);
    h.at(120_001);
    h.paint();
    jest.advanceTimersByTime(120_000);
    expect(h.report).toHaveBeenCalledWith({
      transport: 'stream',
      mode: 'hybrid',
      outcome: 'complete',
      elapsed_ms: 120_000,
      all_results_received_ms: 400,
    });
  });
});

describe('afterVisibleSearchPaint', () => {
  it.each([false, true])('gives updated final rows two frames (initially empty final: %s)', (emptyFinal) => {
    let now = 400;
    let nextId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const report = jest.fn();
    const visibility = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const request = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => {
      frames.set(++nextId, fn);
      return nextId;
    });
    const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    const frame = (at: number) => {
      now = at;
      const pending = [...frames.values()];

      frames.clear();
      pending.forEach((fn) => fn(at));
    };

    const observation = new SearchPresentationObservation({ startedAt: 0, mode: 'hybrid', report, now: () => now });

    try {
      observation.issue();
      observation.committedRows(!emptyFinal, emptyFinal);
      if (emptyFinal) observation.received('complete');
      frame(416);
      now = 420;
      observation.committedRows(true, true);
      if (!emptyFinal) observation.received('complete');
      frame(432);
      expect(report).not.toHaveBeenCalled();
      frame(448);
      expect(report).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledWith({
        transport: 'stream',
        mode: 'hybrid',
        outcome: 'complete',
        elapsed_ms: 448,
        first_result_visible_ms: emptyFinal ? 448 : 432,
        all_results_received_ms: emptyFinal ? 400 : 420,
        final_results_visible_ms: 448,
      });
    } finally {
      observation.terminate('cancelled');
      visibility.mockRestore();
      request.mockRestore();
      cancel.mockRestore();
    }
  });

  it('waits for a visible document and two frames; hiding between frames restarts the opportunity', () => {
    let visibility = 'hidden';
    let nextId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const callback = jest.fn();
    const visibilityGetter = jest
      .spyOn(document, 'visibilityState', 'get')
      .mockImplementation(() => visibility as DocumentVisibilityState);
    const request = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => {
      frames.set(++nextId, fn);
      return nextId;
    });
    const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    const frame = () => {
      const pending = [...frames.values()];

      frames.clear();
      pending.forEach((fn) => fn(0));
    };

    const dispose = afterVisibleSearchPaint(callback);

    expect(frames.size).toBe(0);
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    frame();
    expect(callback).not.toHaveBeenCalled();
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    frame();
    expect(callback).not.toHaveBeenCalled();
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    frame();
    frame();
    expect(callback).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(0);
    dispose();
    visibilityGetter.mockRestore();
    request.mockRestore();
    cancel.mockRestore();
  });
});

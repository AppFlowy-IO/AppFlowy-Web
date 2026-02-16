import { context, propagation, Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';

const TRACER_NAME = 'appflowy-web';

let initialized = false;

function ensureInitialized() {
  if (initialized) return;
  initialized = true;

  const provider = new WebTracerProvider();

  provider.register({
    propagator: new W3CTraceContextPropagator(),
  });
}

function getTracer() {
  ensureInitialized();
  return trace.getTracer(TRACER_NAME);
}

/**
 * Starts a span for an HTTP request and injects W3C Trace Context headers
 * (`traceparent`) into the provided headers record.
 *
 * Returns the span so the caller can end it after the response arrives.
 */
export function startHttpSpan(method: string, url: string, headers: Record<string, string>): Span {
  const tracer = getTracer();
  const span = tracer.startSpan(`HTTP ${method.toUpperCase()} ${url}`);

  // Inject traceparent header into the carrier (headers object)
  const ctx = trace.setSpan(context.active(), span);

  propagation.inject(ctx, headers);

  return span;
}

/**
 * Ends an HTTP span, optionally marking it as an error.
 */
export function endHttpSpan(span: Span, error?: boolean) {
  if (error) {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }

  span.end();
}

import { type Context, context, propagation, Span, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';

import { messages } from '@/proto/messages';

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

/**
 * Creates a root span for a WebSocket connection session.
 * Returns the span and its context so child spans can be parented under it.
 */
export function startWsConnectionSpan(workspaceId: string): { span: Span; ctx: Context } {
  const tracer = getTracer();
  const span = tracer.startSpan(`WS connection ${workspaceId}`, {
    kind: SpanKind.CLIENT,
    attributes: { 'ws.workspace_id': workspaceId },
  });
  const ctx = trace.setSpan(context.active(), span);

  return { span, ctx };
}

/**
 * Ends a WebSocket connection span, optionally marking it as an error.
 */
export function endWsConnectionSpan(span: Span, error?: boolean): void {
  if (error) {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }

  span.end();
}

/**
 * Extracts the W3C trace context from the connection-level context.
 * The returned value is embedded in the protobuf `IMessage.trace` field so the
 * server can create per-message spans as children of the connection span.
 */
export function getWsTraceContext(connectionCtx: Context): messages.ITraceContext {
  const carrier: Record<string, string> = {};

  propagation.inject(connectionCtx, carrier);

  return {
    traceparent: carrier['traceparent'] || null,
    tracestate: carrier['tracestate'] || null,
  };
}

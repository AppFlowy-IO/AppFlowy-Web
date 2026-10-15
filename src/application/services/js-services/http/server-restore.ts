import axios, { type InternalAxiosRequestConfig } from 'axios';

import { serverRestore } from '@/application/server-restore';

function cloudRequestURL(request: InternalAxiosRequestConfig, effectiveBaseURL: string): URL | undefined {
  const origin = typeof window === 'undefined' ? undefined : window.location.origin;
  const cloud = new URL(effectiveBaseURL, origin);
  const target = new URL(axios.getUri({ ...request, baseURL: request.baseURL ?? effectiveBaseURL, params: undefined }), origin);
  const apiPath = `${cloud.pathname.replace(/\/+$/, '')}/api/`;

  if (target.origin !== cloud.origin || !target.pathname.startsWith(apiPath)) return;
  if (target.pathname === `${apiPath}server-info`) return;

  return target;
}

/** Stamp the tab's generation, never the latest value written by another tab. */
export function applyServerRestoreFence(request: InternalAxiosRequestConfig, effectiveBaseURL: string): void {
  const url = cloudRequestURL(request, effectiveBaseURL);

  if (!url) return;
  serverRestore.assertCurrent();

  // Preserve callers' params/serializers, and replace the stamp on a retry.
  url.searchParams.set('server_restore_id', serverRestore.restoreId);
  request.url = url.toString();
}

export function handleServerRestoreRejection(error: unknown, effectiveBaseURL: string): void {
  if (!axios.isAxiosError(error) || error.response?.status !== 409) return;
  if (!error.config || !cloudRequestURL(error.config, effectiveBaseURL)) return;
  const restoreId = error.response.data?.data?.server_restore_id;

  if (restoreId !== undefined) serverRestore.accept(restoreId);
}

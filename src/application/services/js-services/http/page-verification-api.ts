import {
  PageVerification,
  VerificationExpiration,
  VerificationProperty,
  VerificationPropertyState,
  VerificationViewSettings,
} from '@/application/page-verification/types';

import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

const pageUrl = (workspaceId: string, targetId: string) => `/api/workspace/${workspaceId}/page/${targetId}/verification`;
const propertyUrl = (workspaceId: string, databaseId: string) =>
  `/api/workspace/${workspaceId}/database/${databaseId}/verification-property`;

export function getPageVerification(workspaceId: string, targetId: string): Promise<PageVerification> {
  return executeAPIRequest(() => getAxios()?.get<APIResponse<PageVerification>>(pageUrl(workspaceId, targetId)));
}

export function batchPageVerification(workspaceId: string, targetIds: string[]) {
  type Batch = { items: PageVerification[]; targets: Record<string, string> };
  return executeAPIRequest<Batch>(() =>
    getAxios()?.post<APIResponse<Batch>>(`/api/workspace/${workspaceId}/verification/batch`, { target_ids: targetIds })
  );
}

export function verifyPage(
  workspaceId: string,
  targetId: string,
  expiration: VerificationExpiration,
  propertyId?: string
): Promise<PageVerification> {
  return executeAPIRequest(() =>
    getAxios()?.put<APIResponse<PageVerification>>(pageUrl(workspaceId, targetId), {
      expiration,
      property_id: propertyId,
    })
  );
}

export function removePageVerification(workspaceId: string, targetId: string): Promise<PageVerification> {
  return executeAPIRequest(() => getAxios()?.delete<APIResponse<PageVerification>>(pageUrl(workspaceId, targetId)));
}

export function getVerificationProperty(workspaceId: string, databaseId: string): Promise<VerificationPropertyState> {
  return executeAPIRequest(() =>
    getAxios()?.get<APIResponse<VerificationPropertyState>>(propertyUrl(workspaceId, databaseId))
  );
}

export function createVerificationProperty(workspaceId: string, databaseId: string): Promise<VerificationProperty> {
  return executeAPIRequest(() =>
    getAxios()?.post<APIResponse<VerificationProperty>>(propertyUrl(workspaceId, databaseId))
  );
}

export function deleteVerificationProperty(workspaceId: string, databaseId: string, propertyId: string): Promise<void> {
  return executeAPIVoidRequest(() =>
    getAxios()?.delete<APIResponse>(`${propertyUrl(workspaceId, databaseId)}/${propertyId}`)
  );
}

export function setVerificationViewSettings(
  workspaceId: string,
  databaseId: string,
  propertyId: string,
  viewId: string,
  settings: VerificationViewSettings
): Promise<void> {
  return executeAPIVoidRequest(() =>
    getAxios()?.put<APIResponse>(`${propertyUrl(workspaceId, databaseId)}/${propertyId}/view/${viewId}`, settings)
  );
}

export function clearVerificationProperty(workspaceId: string, databaseId: string, propertyId: string): Promise<void> {
  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(`${propertyUrl(workspaceId, databaseId)}/${propertyId}/clear`)
  );
}

export interface VerificationReminder {
  title: string;
  body: string;
  view_id: string | null;
  row_id?: string | null;
}
export function getVerificationReminder(
  workspaceId: string,
  notificationId: string
): Promise<VerificationReminder | null> {
  return executeAPIRequest(() =>
    getAxios()?.get<APIResponse<VerificationReminder | null>>(
      `/api/workspace/${workspaceId}/verification/reminder/${notificationId}`
    )
  );
}

import { t } from 'i18next';
import { validate as isUuid } from 'uuid';

import { PlainError } from '@/application/errors/plain-error';
import { GroupSpaceCoverageLevel } from '@/application/types';

import { APIResponse, executeAPIRequest } from './core';
import { captureApiContext } from './request-context';

export interface GroupSpaceCoverage {
  access_level: GroupSpaceCoverageLevel;
}

export function isGroupSpaceCoverageLevel(value: unknown): value is GroupSpaceCoverageLevel {
  return value === null || value === 10 || value === 30;
}

function parseCoverage(value: unknown): GroupSpaceCoverage {
  if (
    !value ||
    typeof value !== 'object' ||
    !('access_level' in value) ||
    !isGroupSpaceCoverageLevel(value.access_level)
  ) {
    throw new PlainError(t('groupSpaceAccess.invalidResponse'));
  }

  return { access_level: value.access_level };
}

function coverageUrl(workspaceId: string, groupId: string) {
  if (!isUuid(groupId)) throw new PlainError(t('groupSpaceAccess.invalidResponse'));
  return `/api/workspace/${encodeURIComponent(workspaceId)}/groups/${groupId}/space-coverage`;
}

/** The Owner-only GET is a current authority check, independent of directory ownership. */
export async function getGroupSpaceCoverage(workspaceId: string, groupId: string): Promise<GroupSpaceCoverage> {
  const context = captureApiContext();
  const url = coverageUrl(workspaceId, groupId);
  const result = await executeAPIRequest<unknown>(() => context.client?.get<APIResponse>(url));

  context.assertCurrent();
  return parseCoverage(result);
}

/** Explicit null disables coverage. A focused PUT cannot edit group identity or membership. */
export async function setGroupSpaceCoverage(
  workspaceId: string,
  groupId: string,
  level: GroupSpaceCoverageLevel,
  isCurrent: () => boolean = () => true
): Promise<GroupSpaceCoverage> {
  const context = captureApiContext();
  const assertCurrent = () => {
    context.assertCurrent();
    if (!isCurrent()) throw new PlainError(t('groupSpaceAccess.contextChanged'));
  };

  if (!isGroupSpaceCoverageLevel(level)) throw new PlainError(t('groupSpaceAccess.invalidResponse'));
  const url = coverageUrl(workspaceId, groupId);

  assertCurrent();
  await getGroupSpaceCoverage(workspaceId, groupId);
  assertCurrent();
  const result = await executeAPIRequest<unknown>(() => {
    assertCurrent();
    return context.client?.put<APIResponse>(url, { access_level: level });
  });

  assertCurrent();
  const coverage = parseCoverage(result);

  if (coverage.access_level !== level) throw new PlainError(t('groupSpaceAccess.invalidResponse'));
  return coverage;
}

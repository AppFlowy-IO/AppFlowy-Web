import { TFunction } from 'i18next';

import { ERROR_CODE } from '@/application/constants';
import { getConfigValue } from '@/utils/runtime-config';
import { updateServerInfo } from '@/utils/server-info';

import { getLandingPageErrorContent } from '../errorContent';

const translate = ((_key: string, fallback: string) => fallback) as TFunction;

it.each([
  ERROR_CODE.WORKSPACE_MEMBER_LIMIT_EXCEEDED,
  ERROR_CODE.FREE_PLAN_GUEST_LIMIT_EXCEEDED,
  ERROR_CODE.PAID_PLAN_GUEST_LIMIT_EXCEEDED,
  ERROR_CODE.WORKSPACE_LIMIT_EXCEEDED,
  ERROR_CODE.FILE_STORAGE_LIMIT_EXCEEDED,
  ERROR_CODE.STORAGE_SPACE_NOT_ENOUGH,
])('limits upgrade guidance to cloud for landing-page quota error %s', (code) => {
  const serverUrl = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');

  updateServerInfo(serverUrl, { status: 'available', info: { enable_page_history: true, self_hosted: false } });
  expect(getLandingPageErrorContent({ code }, translate).description).toMatch(/upgrade/i);

  updateServerInfo(serverUrl, { status: 'available', info: { enable_page_history: true, self_hosted: true } });
  expect(getLandingPageErrorContent({ code }, translate).description).toContain('workspace administrator');
  expect(getLandingPageErrorContent({ code }, translate).description).not.toMatch(/Free|Pro|upgrade/);
  expect(getLandingPageErrorContent({ code, message: 'Configured by the server administrator' }, translate).description)
    .toBe('Configured by the server administrator');

  updateServerInfo(serverUrl, { status: 'unavailable' });
  expect(getLandingPageErrorContent({ code }, translate).description).not.toMatch(/Free|Pro|upgrade/);
});

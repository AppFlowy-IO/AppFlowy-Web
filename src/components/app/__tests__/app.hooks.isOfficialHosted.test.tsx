import { act, renderHook } from '@testing-library/react';

import { ERROR_CODE } from '@/application/constants';
import { useIsOfficialHosted } from '@/components/app/hooks/useServerInfo';
import { getBillingErrorMessage } from '@/utils/billing-error';
import { updateServerInfo } from '@/utils/server-info';

const mockBaseUrl = jest.fn(() => 'http://localhost:8000');

jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => mockBaseUrl() }));
jest.mock('@/application/services/domains', () => ({ AuthService: { getServerInfo: jest.fn() } }));

const error = { code: ERROR_CODE.INVALID_SUBSCRIPTION_PLAN, message: 'Server limit reached' };

beforeEach(() => {
  mockBaseUrl.mockReturnValue('http://localhost:8000');
  updateServerInfo(mockBaseUrl(), { status: 'loading' });
});

it('shares the server-info decision between feature gates and error guidance', () => {
  const { result } = renderHook(useIsOfficialHosted);

  expect(result.current).toBe(false);
  expect(getBillingErrorMessage(error)).toBeUndefined();
  act(() =>
    updateServerInfo(mockBaseUrl(), {
      status: 'available',
      info: { enable_page_history: true, self_hosted: false },
    })
  );
  expect(result.current).toBe(true);
  expect(getBillingErrorMessage(error)).toContain('Pro');
  act(() =>
    updateServerInfo(mockBaseUrl(), {
      status: 'available',
      info: { enable_page_history: true, self_hosted: true },
    })
  );
  expect(result.current).toBe(false);
  expect(getBillingErrorMessage(error)).toBeUndefined();
});

it('drops cloud guidance on refresh failure and when switching servers', () => {
  updateServerInfo(mockBaseUrl(), { status: 'available', info: { enable_page_history: true, self_hosted: false } });
  const { result, rerender } = renderHook(useIsOfficialHosted);

  expect(result.current).toBe(true);
  act(() => updateServerInfo(mockBaseUrl(), { status: 'unavailable' }));
  expect(result.current).toBe(false);
  expect(getBillingErrorMessage(error)).toBeUndefined();
  act(() =>
    updateServerInfo(mockBaseUrl(), {
      status: 'available',
      info: { enable_page_history: true, self_hosted: false },
    })
  );
  mockBaseUrl.mockReturnValue('https://selfhost.example.com');
  rerender();
  expect(result.current).toBe(false);
  expect(getBillingErrorMessage(error)).toBeUndefined();
});

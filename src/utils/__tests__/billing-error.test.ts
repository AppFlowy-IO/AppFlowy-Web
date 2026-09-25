import { ERROR_CODE } from '@/application/constants';
import { getBillingErrorMessage } from '@/utils/billing-error';
import { getErrorMessage } from '@/utils/errors';
import { updateServerInfo } from '@/utils/server-info';

const upgradeMessage = 'Upgrade this workspace to Pro to use this feature or increase its limits.';
const mockBaseUrl = jest.fn(() => 'https://test.appflowy.cloud');

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: () => mockBaseUrl(),
}));

describe('billing error messages', () => {
  beforeEach(() => {
    mockBaseUrl.mockReturnValue('https://test.appflowy.cloud');
    updateServerInfo(mockBaseUrl(), { status: 'available', info: { enable_page_history: true, self_hosted: false } });
  });

  it.each(['https://selfhost.example.com', 'http://localhost:8000', 'http://127.0.0.1:8000', 'http://[::1]:8000'])(
    'preserves administrator-defined limits on %s',
    (baseUrl) => {
      mockBaseUrl.mockReturnValue(baseUrl);
      updateServerInfo(baseUrl, { status: 'available', info: { enable_page_history: true, self_hosted: true } });
      const error = {
        code: ERROR_CODE.SINGLE_UPLOAD_LIMIT_EXCEEDED,
        message: 'Your administrator limits files to 100 MB',
      };

      expect(getBillingErrorMessage(error)).toBeUndefined();
      expect(getBillingErrorMessage({ response: { data: error } })).toBeUndefined();
      expect(getErrorMessage(error)).toBe(error.message);
    }
  );

  it.each([
    ERROR_CODE.INVALID_SUBSCRIPTION_PLAN,
    ERROR_CODE.FILE_STORAGE_LIMIT_EXCEEDED,
    ERROR_CODE.SINGLE_UPLOAD_LIMIT_EXCEEDED,
    ERROR_CODE.CUSTOM_NAMESPACE_DISABLED,
    ERROR_CODE.FREE_PLAN_GUEST_LIMIT_EXCEEDED,
  ])('adds actionable workspace upgrade guidance for error %s', (code) => {
    expect(getErrorMessage({ code, message: 'Limit exceeded' })).toBe(upgradeMessage);
    expect(getErrorMessage({ response: { data: { code, message: 'Limit exceeded' } } })).toBe(upgradeMessage);
  });

  it('keeps the form limit and upgrade explanation from the server', () => {
    const message = 'Free workspaces can have one form. Upgrade this workspace to Pro to create more forms.';

    expect(getErrorMessage({ code: ERROR_CODE.INVALID_SUBSCRIPTION_PLAN, message })).toBe(message);
  });

  it.each([
    [403, 'You do not have access'],
    [ERROR_CODE.NOT_HAS_PERMISSION, 'You do not have access'],
    [1090, 'Update the app to import this file'],
    [ERROR_CODE.AI_IMAGE_RESPONSE_LIMIT_EXCEEDED, 'Purchase AI Max'],
    [1129, 'Your monthly transcription limit has been reached'],
    [ERROR_CODE.PAID_PLAN_GUEST_LIMIT_EXCEEDED, 'Paid workspace guest limit reached'],
    [ERROR_CODE.PAYLOAD_TOO_LARGE, 'Metadata request too large'],
  ])('preserves errors whose remedy is not a Pro upgrade (%s)', (code, message) => {
    const error = { code, message };

    expect(getBillingErrorMessage(error)).toBeUndefined();
    expect(getErrorMessage(error)).toBe(message);
  });

  it('does not infer billing restrictions from HTTP 403 or text alone', () => {
    expect(getBillingErrorMessage({ response: { status: 403 } })).toBeUndefined();
    expect(getBillingErrorMessage(new Error('Limit exceeded'))).toBeUndefined();
  });
});

import { TFunction } from 'i18next';

import { ERROR_CODE } from '@/application/constants';
import { ErrorIdentity, hasServerErrorPresentation } from '@/application/errors/error-message';
import { getWorkspacePlanPolicy } from '@/application/workspace-plan-policy';
import { determineErrorType, ErrorType } from '@/application/utils/error-utils';
import { getErrorMessage } from '@/utils/errors';

export interface LandingPageError extends Partial<ErrorIdentity> {
  code?: number;
  message?: string;
}

export interface LandingPageErrorContent {
  title: string;
  description: string;
}

export function getLandingPageErrorContent(error: LandingPageError | undefined, t: TFunction): LandingPageErrorContent {
  const guidance = getErrorMessage(error);
  const content = (titleKey: string, fallbackTitle: string) => ({
    title: t(titleKey, fallbackTitle),
    description: guidance,
  });

  const quotaContent = (titleKey: string, fallbackTitle: string) => {
    const result = content(titleKey, fallbackTitle);

    return getWorkspacePlanPolicy().usesHostedBilling || hasServerErrorPresentation(error)
      ? result
      : { ...result, description: `${result.description} ${t('landingPage.error.contactAdministrator', 'Contact your workspace administrator for help.')}` };
  };

  if (!error) {
    return content('landingPage.error.title', 'Something went wrong');
  }

  switch (error.code) {
    case ERROR_CODE.WORKSPACE_MEMBER_LIMIT_EXCEEDED:
      return quotaContent('landingPage.inviteCode.memberLimitTitle', 'Workspace member limit reached');
    case ERROR_CODE.FREE_PLAN_GUEST_LIMIT_EXCEEDED:
    case ERROR_CODE.PAID_PLAN_GUEST_LIMIT_EXCEEDED:
      return quotaContent('landingPage.error.guestLimitTitle', 'Workspace guest limit reached');
    case ERROR_CODE.WORKSPACE_LIMIT_EXCEEDED:
      return quotaContent('landingPage.error.workspaceLimitTitle', 'Workspace limit reached');
    case ERROR_CODE.PAYLOAD_TOO_LARGE:
    case ERROR_CODE.SINGLE_UPLOAD_LIMIT_EXCEEDED:
      return content('landingPage.error.uploadLimitTitle', 'Upload limit reached');
    case ERROR_CODE.FILE_STORAGE_LIMIT_EXCEEDED:
    case ERROR_CODE.STORAGE_SPACE_NOT_ENOUGH:
      return quotaContent('landingPage.error.storageLimitTitle', 'Storage limit reached');
    case ERROR_CODE.FEATURE_NOT_AVAILABLE:
      return content('landingPage.error.featureUnavailableTitle', 'Feature not available');
    case ERROR_CODE.ACCESS_REQUEST_ALREADY_APPROVED:
    case ERROR_CODE.ACCESS_REQUEST_ALREADY_DENIED:
      return content('landingPage.error.requestAlreadyHandledTitle', 'Request already handled');
    default:
      break;
  }

  const appError = determineErrorType(error);

  switch (appError.type) {
    case ErrorType.AlreadyExists:
      return content('landingPage.error.alreadyExistsTitle', 'Item already exists');
    case ErrorType.PageNotFound:
      return content('landingPage.pageNotFound.title', 'Page not found');
    case ErrorType.Unauthorized:
      return content('landingPage.unauthorized.title', 'Sign in required');
    case ErrorType.Forbidden:
      return content('landingPage.forbidden.title', 'Access denied');
    case ErrorType.ServerError:
      return content('landingPage.serverError.title', 'Server error');
    case ErrorType.NetworkError:
      return content('landingPage.networkError.title', 'Connection error');
    case ErrorType.InvalidLink:
      return content('landingPage.invalidLink.title', 'Invalid link');
    case ErrorType.AlreadyJoined:
      return content('landingPage.alreadyJoined.title', 'Already a member');
    case ErrorType.NotInvitee:
      return content('landingPage.notInvitee.title', 'Access denied');
    case ErrorType.Gone:
      return content('landingPage.gone.title', 'Resource deleted');
    case ErrorType.Timeout:
      return content('landingPage.timeout.title', 'Request timeout');
    case ErrorType.RateLimited:
      return content('landingPage.rateLimited.title', 'Too many requests');
    case ErrorType.Unknown:
    default:
      return content('landingPage.unknown.title', 'Something went wrong');
  }
}

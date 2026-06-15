import { TFunction } from 'i18next';

import { ERROR_CODE } from '@/application/constants';
import { determineErrorType, ErrorType } from '@/application/utils/error-utils';

export interface LandingPageError {
  code?: number;
  message?: string;
}

export interface LandingPageErrorContent {
  title: string;
  description: string;
}

const GENERIC_ERROR_MESSAGES = new Set(['Request failed', 'Unknown error occurred']);

function getServerMessage(error?: LandingPageError) {
  const message = error?.message?.trim();

  if (!message || GENERIC_ERROR_MESSAGES.has(message)) return undefined;

  return message;
}

export function getLandingPageErrorContent(error: LandingPageError | undefined, t: TFunction): LandingPageErrorContent {
  const serverMessage = getServerMessage(error);
  const content = (titleKey: string, fallbackTitle: string, descriptionKey: string, fallbackDescription: string) => ({
    title: t(titleKey, fallbackTitle),
    description: serverMessage || t(descriptionKey, fallbackDescription),
  });

  if (!error) {
    return content(
      'landingPage.error.title',
      'Something went wrong',
      'landingPage.error.descriptionShort',
      'This might be due to a network issue or a temporary server error. Please check your internet connection or try again later.'
    );
  }

  switch (error.code) {
    case ERROR_CODE.WORKSPACE_MEMBER_LIMIT_EXCEEDED:
      return content(
        'landingPage.inviteCode.memberLimitTitle',
        'Workspace member limit reached',
        'landingPage.error.workspaceMemberLimitDescription',
        'This workspace has reached the Free plan member limit. Ask the workspace owner to upgrade their plan or remove a member, then try again.'
      );
    case ERROR_CODE.FREE_PLAN_GUEST_LIMIT_EXCEEDED:
    case ERROR_CODE.PAID_PLAN_GUEST_LIMIT_EXCEEDED:
      return content(
        'landingPage.error.guestLimitTitle',
        'Workspace guest limit reached',
        'landingPage.error.guestLimitDescription',
        'This workspace has reached its guest limit. Ask the workspace owner to upgrade their plan or remove a guest, then try again.'
      );
    case ERROR_CODE.WORKSPACE_LIMIT_EXCEEDED:
      return content(
        'landingPage.error.workspaceLimitTitle',
        'Workspace limit reached',
        'landingPage.error.workspaceLimitDescription',
        'This account has reached the workspace limit. Remove an unused workspace or upgrade the plan, then try again.'
      );
    case ERROR_CODE.PAYLOAD_TOO_LARGE:
    case ERROR_CODE.SINGLE_UPLOAD_LIMIT_EXCEEDED:
      return content(
        'landingPage.error.uploadLimitTitle',
        'Upload limit reached',
        'landingPage.error.uploadLimitDescription',
        'The uploaded file is larger than the allowed limit. Choose a smaller file and try again.'
      );
    case ERROR_CODE.FILE_STORAGE_LIMIT_EXCEEDED:
    case ERROR_CODE.STORAGE_SPACE_NOT_ENOUGH:
      return content(
        'landingPage.error.storageLimitTitle',
        'Storage limit reached',
        'landingPage.error.storageLimitDescription',
        'This workspace does not have enough storage available. Free up storage or upgrade the plan, then try again.'
      );
    case ERROR_CODE.FEATURE_NOT_AVAILABLE:
      return content(
        'landingPage.error.featureUnavailableTitle',
        'Feature not available',
        'landingPage.error.featureUnavailableDescription',
        'This feature is not available for the current workspace or plan.'
      );
    case ERROR_CODE.ACCESS_REQUEST_ALREADY_APPROVED:
    case ERROR_CODE.ACCESS_REQUEST_ALREADY_DENIED:
      return content(
        'landingPage.error.requestAlreadyHandledTitle',
        'Request already handled',
        'landingPage.error.requestAlreadyHandledDescription',
        'This access request has already been handled. Refresh the page to see the latest state.'
      );
    default:
      break;
  }

  const appError = determineErrorType(error);

  switch (appError.type) {
    case ErrorType.PageNotFound:
      return content(
        'landingPage.pageNotFound.title',
        'Page not found',
        'landingPage.pageNotFound.description',
        "This page doesn't exist or has been deleted. It may have been moved or removed by the owner."
      );
    case ErrorType.Unauthorized:
      return content(
        'landingPage.unauthorized.title',
        'Sign in required',
        'landingPage.unauthorized.description',
        'You need to sign in to access this page. Please sign in with your AppFlowy account.'
      );
    case ErrorType.Forbidden:
      return content(
        'landingPage.forbidden.title',
        'Access denied',
        'landingPage.forbidden.description',
        "You don't have permission to view this page. Contact the page owner to request access."
      );
    case ErrorType.ServerError:
      return content(
        'landingPage.serverError.title',
        'Server error',
        'landingPage.serverError.description',
        'Our servers are experiencing issues. Please try again in a few moments.'
      );
    case ErrorType.NetworkError:
      return content(
        'landingPage.networkError.title',
        'Connection error',
        'landingPage.networkError.description',
        'Unable to connect to AppFlowy. Please check your internet connection and try again.'
      );
    case ErrorType.InvalidLink:
      return content(
        'landingPage.invalidLink.title',
        'Invalid link',
        'landingPage.invalidLink.description',
        'This link is invalid or has expired. Please request a new invitation link from the sender.'
      );
    case ErrorType.AlreadyJoined:
      return content(
        'landingPage.alreadyJoined.title',
        'Already a member',
        'landingPage.alreadyJoined.description',
        "You're already a member of this workspace."
      );
    case ErrorType.NotInvitee:
      return content(
        'landingPage.notInvitee.title',
        'Access denied',
        'landingPage.notInvitee.description',
        "This invitation wasn't sent to your account. Please contact the sender for a new invitation."
      );
    case ErrorType.Gone:
      return content(
        'landingPage.gone.title',
        'Resource deleted',
        'landingPage.gone.description',
        'This resource has been permanently deleted and is no longer available.'
      );
    case ErrorType.Timeout:
      return content(
        'landingPage.timeout.title',
        'Request timeout',
        'landingPage.timeout.description',
        'The request took too long to complete. Please check your connection and try again.'
      );
    case ErrorType.RateLimited:
      return content(
        'landingPage.rateLimited.title',
        'Too many requests',
        'landingPage.rateLimited.description',
        "You've made too many requests. Please wait a moment and try again."
      );
    case ErrorType.Unknown:
    default:
      return content(
        'landingPage.unknown.title',
        'Something went wrong',
        'landingPage.unknown.description',
        'An unexpected error occurred. Please try again or contact support if the problem persists.'
      );
  }
}

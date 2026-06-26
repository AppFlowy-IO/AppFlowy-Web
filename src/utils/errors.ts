export function getErrorMessage(error: unknown, fallback = 'Request failed'): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;

    if (typeof message === 'string') return message;
  }

  return fallback;
}

export function isAPIErrorCode(error: unknown, code: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

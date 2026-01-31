/**
 * Upload Tracker
 *
 * Tracks ongoing file uploads and warns users before leaving the page
 * if there are uploads in progress.
 */

import { Log } from '@/utils/log';

// Set to track active upload IDs
const activeUploads = new Set<string>();

// Track if beforeunload listener is attached
let listenerAttached = false;

// Counter for generating unique upload IDs
let uploadIdCounter = 0;

/**
 * Handler for beforeunload event
 */
function handleBeforeUnload(e: BeforeUnloadEvent) {
  Log.info(`[UploadTracker] beforeunload triggered, active uploads: ${activeUploads.size}`);
  if (activeUploads.size > 0) {
    // Standard way to show a confirmation dialog
    e.preventDefault();
    // For older browsers - must be a non-empty string in some browsers
    e.returnValue = 'You have uploads in progress. Are you sure you want to leave?';
    return 'You have uploads in progress. Are you sure you want to leave?';
  }
}

/**
 * Update the beforeunload listener based on active uploads
 */
function updateListener() {
  if (activeUploads.size > 0 && !listenerAttached) {
    window.addEventListener('beforeunload', handleBeforeUnload);
    listenerAttached = true;
    Log.info('[UploadTracker] beforeunload listener attached');
  } else if (activeUploads.size === 0 && listenerAttached) {
    window.removeEventListener('beforeunload', handleBeforeUnload);
    listenerAttached = false;
    Log.info('[UploadTracker] beforeunload listener removed');
  }
}

/**
 * Register an upload as started
 * @returns A unique upload ID to use when marking the upload as complete
 */
export function registerUpload(): string {
  const uploadId = `upload-${++uploadIdCounter}-${Date.now()}`;

  activeUploads.add(uploadId);
  Log.info(`[UploadTracker] Upload started: ${uploadId}, active uploads: ${activeUploads.size}`);
  updateListener();
  return uploadId;
}

/**
 * Mark an upload as complete (success or failure)
 * @param uploadId The ID returned from registerUpload
 */
export function unregisterUpload(uploadId: string): void {
  activeUploads.delete(uploadId);
  Log.info(`[UploadTracker] Upload completed: ${uploadId}, active uploads: ${activeUploads.size}`);
  updateListener();
}

/**
 * Check if there are any active uploads
 */
export function hasActiveUploads(): boolean {
  return activeUploads.size > 0;
}

/**
 * Get the count of active uploads
 */
export function getActiveUploadCount(): number {
  return activeUploads.size;
}

/**
 * Clear all active uploads (for testing purposes)
 */
export function clearAllUploads(): void {
  activeUploads.clear();
  updateListener();
}

/**
 * Higher-order function to wrap an upload function with tracking
 * Automatically registers and unregisters the upload
 */
export function withUploadTracking<T extends unknown[], R>(
  uploadFn: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    const uploadId = registerUpload();

    try {
      return await uploadFn(...args);
    } finally {
      unregisterUpload(uploadId);
    }
  };
}

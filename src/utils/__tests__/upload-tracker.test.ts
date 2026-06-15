import {
  registerUpload,
  unregisterUpload,
  hasActiveUploads,
  getActiveUploadCount,
  clearAllUploads,
} from '../upload-tracker';

describe('upload-tracker', () => {
  let addEventListenerSpy: jest.SpyInstance;
  let removeEventListenerSpy: jest.SpyInstance;

  beforeEach(() => {
    // Clear all uploads before each test
    clearAllUploads();
    addEventListenerSpy = jest.spyOn(window, 'addEventListener');
    removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    clearAllUploads();
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  it('should register and unregister uploads correctly', () => {
    expect(hasActiveUploads()).toBe(false);
    expect(getActiveUploadCount()).toBe(0);

    const uploadId1 = registerUpload();
    expect(hasActiveUploads()).toBe(true);
    expect(getActiveUploadCount()).toBe(1);

    const uploadId2 = registerUpload();
    expect(getActiveUploadCount()).toBe(2);

    unregisterUpload(uploadId1);
    expect(getActiveUploadCount()).toBe(1);
    expect(hasActiveUploads()).toBe(true);

    unregisterUpload(uploadId2);
    expect(getActiveUploadCount()).toBe(0);
    expect(hasActiveUploads()).toBe(false);
  });

  it('should add beforeunload listener when first upload is registered', () => {
    addEventListenerSpy.mockClear();

    const uploadId = registerUpload();

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'beforeunload',
      expect.any(Function)
    );

    unregisterUpload(uploadId);
  });

  it('should remove beforeunload listener when last upload completes', () => {
    const uploadId = registerUpload();

    removeEventListenerSpy.mockClear();

    unregisterUpload(uploadId);

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'beforeunload',
      expect.any(Function)
    );
  });

  it('should not add multiple listeners for multiple uploads', () => {
    addEventListenerSpy.mockClear();

    const uploadId1 = registerUpload();
    const uploadId2 = registerUpload();
    const uploadId3 = registerUpload();

    // Should only add listener once
    const beforeUnloadCalls = addEventListenerSpy.mock.calls.filter(
      (call) => call[0] === 'beforeunload'
    );
    expect(beforeUnloadCalls.length).toBe(1);

    unregisterUpload(uploadId1);
    unregisterUpload(uploadId2);
    unregisterUpload(uploadId3);
  });

  it('should set returnValue on beforeunload when uploads are active', () => {
    const uploadId = registerUpload();

    // Get the handler that was registered
    const beforeUnloadHandler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === 'beforeunload'
    )?.[1] as ((e: BeforeUnloadEvent) => string | void) | undefined;

    expect(beforeUnloadHandler).toBeDefined();

    // Create a mock event
    const mockEvent = {
      preventDefault: jest.fn(),
      returnValue: '',
    } as unknown as BeforeUnloadEvent;

    // Call the handler
    const result = beforeUnloadHandler?.(mockEvent);

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    // Should set a non-empty message for browser compatibility
    expect(mockEvent.returnValue).toContain('uploads in progress');
    expect(result).toContain('uploads in progress');

    unregisterUpload(uploadId);
  });

  it('should handle unregistering non-existent upload ID gracefully', () => {
    expect(() => unregisterUpload('non-existent-id')).not.toThrow();
  });
});

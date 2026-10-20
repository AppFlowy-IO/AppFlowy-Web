import { renderHook } from '@testing-library/react';

import { ERROR_CODE } from '@/application/constants';
import { ViewService } from '@/application/services/domains';
import { openRowSubDocument } from '@/application/view-loader';
import { useAuthInternal } from '@/components/app/contexts/AuthInternalContext';
import { useDatabaseOperations } from '@/components/app/hooks/useDatabaseOperations';

jest.mock('@/application/services/domains', () => ({
  AIService: {},
  ViewService: {
    createOrphaned: jest.fn(),
  },
}));

jest.mock('@/application/view-loader', () => ({
  openRowSubDocument: jest.fn(),
}));

jest.mock('@/components/app/contexts/AuthInternalContext', () => ({
  useAuthInternal: jest.fn(),
}));

const mockCreateOrphaned = ViewService.createOrphaned as jest.MockedFunction<typeof ViewService.createOrphaned>;
const mockOpenRowSubDocument = openRowSubDocument as jest.MockedFunction<typeof openRowSubDocument>;
const mockUseAuthInternal = useAuthInternal as jest.MockedFunction<typeof useAuthInternal>;

describe('useDatabaseOperations row document permission errors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuthInternal.mockReturnValue({
      currentWorkspaceId: 'workspace-id',
      aiEnabled: true,
    } as ReturnType<typeof useAuthInternal>);
  });

  it.each([
    { code: ERROR_CODE.NOT_HAS_PERMISSION, message: 'user is not allowed to access this view' },
    { code: 403, message: 'forbidden' },
  ])('rethrows permission denial $code from row document load and create operations', async (permissionError) => {
    mockOpenRowSubDocument.mockRejectedValue(permissionError);
    mockCreateOrphaned.mockRejectedValue(permissionError);

    const { result } = renderHook(() => useDatabaseOperations());

    await expect(result.current.loadRowDocument('document-id')).rejects.toBe(permissionError);
    await expect(result.current.createRowDocument('document-id')).rejects.toBe(permissionError);
  });

  it('keeps recoverable row document failures as null results', async () => {
    mockOpenRowSubDocument.mockRejectedValue(new Error('row document is not ready'));
    mockCreateOrphaned.mockRejectedValue(new Error('row document is not ready'));

    const { result } = renderHook(() => useDatabaseOperations());

    await expect(result.current.loadRowDocument('document-id')).resolves.toBeNull();
    await expect(result.current.createRowDocument('document-id')).resolves.toBeNull();
  });

  it('does not misclassify quota errors as object permission denials', async () => {
    const quotaError = { code: ERROR_CODE.STORAGE_SPACE_NOT_ENOUGH, message: 'storage quota exceeded' };

    mockOpenRowSubDocument.mockRejectedValue(quotaError);
    mockCreateOrphaned.mockRejectedValue(quotaError);

    const { result } = renderHook(() => useDatabaseOperations());

    await expect(result.current.loadRowDocument('document-id')).resolves.toBeNull();
    await expect(result.current.createRowDocument('document-id')).resolves.toBeNull();
  });
});

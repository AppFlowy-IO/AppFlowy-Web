import { act, renderHook } from '@testing-library/react';

import { useDatabase, useDatabaseContext } from '@/application/database-yjs';

import { useOpenDatabaseAsPage } from '../useOpenDatabaseAsPage';

jest.mock('@/application/database-yjs', () => ({
  useDatabase: jest.fn(),
  useDatabaseContext: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));

const mockUseDatabase = useDatabase as jest.MockedFunction<typeof useDatabase>;
const mockUseDatabaseContext = useDatabaseContext as jest.MockedFunction<typeof useDatabaseContext>;

const navigateToView = jest.fn(() => Promise.resolve());
const getViewIdFromDatabaseId = jest.fn(() => Promise.resolve('primary-view'));

beforeEach(() => {
  jest.clearAllMocks();
  mockUseDatabase.mockReturnValue({ get: () => 'database-id' } as unknown as ReturnType<typeof useDatabase>);
  mockUseDatabaseContext.mockReturnValue({
    navigateToView,
    getViewIdFromDatabaseId,
  } as unknown as ReturnType<typeof useDatabaseContext>);
});

describe('useOpenDatabaseAsPage', () => {
  it('opens exactly the given view and never resolves the database page', async () => {
    const { result } = renderHook(() =>
      useOpenDatabaseAsPage({ viewId: 'linked-dashboard', fallbackViewId: 'host-page' })
    );

    expect(result.current.canOpen).toBe(true);
    await act(() => result.current.openDatabaseAsPage());

    expect(navigateToView).toHaveBeenCalledWith('linked-dashboard');
    expect(getViewIdFromDatabaseId).not.toHaveBeenCalled();
  });

  it('can open a given view even without a database lookup', () => {
    mockUseDatabaseContext.mockReturnValue({ navigateToView } as unknown as ReturnType<typeof useDatabaseContext>);
    mockUseDatabase.mockReturnValue(undefined as unknown as ReturnType<typeof useDatabase>);

    const { result } = renderHook(() => useOpenDatabaseAsPage({ viewId: 'linked-dashboard' }));

    expect(result.current.canOpen).toBe(true);
  });

  it('still opens the primary page of the database without a view id', async () => {
    const { result } = renderHook(() => useOpenDatabaseAsPage({ fallbackViewId: 'host-page' }));

    await act(() => result.current.openDatabaseAsPage());

    expect(getViewIdFromDatabaseId).toHaveBeenCalledWith('database-id');
    expect(navigateToView).toHaveBeenCalledWith('primary-view');
  });

  it('falls back to the fallback view when the database page is unknown', async () => {
    getViewIdFromDatabaseId.mockResolvedValueOnce(null as unknown as string);
    const { result } = renderHook(() => useOpenDatabaseAsPage({ fallbackViewId: 'host-page' }));

    await act(() => result.current.openDatabaseAsPage());

    expect(navigateToView).toHaveBeenCalledWith('host-page');
  });
});

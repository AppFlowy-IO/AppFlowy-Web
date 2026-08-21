import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { FileService } from '@/application/services/domains';

import ImporterDialogContent from '../ImporterDialogContent';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/application/services/domains', () => ({
  FileService: {
    CreateImportTaskType: {
      Notion: 'Notion',
      Workspace: 'Workspace',
    },
    importFile: jest.fn(),
  },
}));

const importFile = FileService.importFile as jest.MockedFunction<typeof FileService.importFile>;

function uploadVisibleFile(file: File) {
  const input = screen.getByTestId('file-dropzone').querySelector('input');

  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { files: [file] } });
}

describe('ImporterDialogContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    importFile.mockResolvedValue(undefined);
  });

  it.each([
    ['appflowy', FileService.CreateImportTaskType.Workspace],
    ['notion', FileService.CreateImportTaskType.Notion],
  ] as const)('routes the %s tab to the matching import task type', async (source, taskType) => {
    const file = new File(['workspace'], `${source}.zip`, { type: 'application/zip' });

    render(<ImporterDialogContent source={source} onSuccess={jest.fn()} />);
    uploadVisibleFile(file);

    await waitFor(() => {
      expect(importFile).toHaveBeenCalledWith(file, {
        taskType,
        onProgress: expect.any(Function),
      });
    });
  });
});

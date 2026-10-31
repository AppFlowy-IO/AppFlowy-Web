import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { analyzePresentationTemplate, deleteArtifact, importPresentationTemplate, reviewPresentationStyle } from '../presentation-client';
import StyleSettings from '../StyleSettings';

import type { PresentationStyle } from '../types';

jest.mock('../presentation-client', () => ({
  deleteArtifact: jest.fn(),
  importPresentationTemplate: jest.fn(),
  analyzePresentationTemplate: jest.fn(),
  reviewPresentationStyle: jest.fn(),
}));
jest.mock('../SlideCanvas', () => ({ __esModule: true, default: () => <div>Appearance sample</div> }));

const original: PresentationStyle = {
  id: 'template-id',
  serverVersion: 7,
  name: 'Company',
  description: '',
  color: '#123456',
  background: '#ffffff',
  font: 'Arial',
  footer: 'Confidential',
  guidelines: 'Clear language',
  company: true,
  serverStyle: {
    reference: { id: 'template-id', version: 7 },
    theme: {
      id: 'theme-id',
      name: 'Company',
      description: 'Template theme',
      color: '#123456',
      background: '#ffffff',
      textColor: '#111111',
      font: 'Arial',
      bodyFont: 'Arial',
      footer: 'Confidential',
      palette: ['#123456'],
      guidelines: 'Clear language',
    },
    templateSlides: [
      {
        id: 'layout',
        title: 'Title',
        text: 'Template',
        textSlots: { title: 'slot-1' },
        elements: [{ asset: 'private-asset', x: 10, width: 80 }],
      },
    ],
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
});

it.each([5, 50])('checks the %i MB workspace allowance before uploading a company style', async (megabytes) => {
  const limit = megabytes * 1024 * 1024;
  const file = (size: number) => Object.defineProperty(new File(['pptx'], 'brand.potx'), 'size', { value: size });
  const changed = jest.fn();

  jest.mocked(importPresentationTemplate).mockResolvedValueOnce(original);
  jest.mocked(analyzePresentationTemplate).mockResolvedValueOnce(original);
  render(<StyleSettings styles={[]} scope={{ workspaceId: 'workspace' }} onChange={changed} maxTemplateBytes={limit} />);
  expect(screen.getByText(`.pptx or .potx · up to ${megabytes} MB`)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Import template'), { target: { files: [file(limit + 1)] } });
  expect(importPresentationTemplate).not.toHaveBeenCalled();
  expect(analyzePresentationTemplate).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Import template'), { target: { files: [file(limit)] } });
  await screen.findByText('Theme analyzed. Review its appearance before saving.');
  expect(importPresentationTemplate).toHaveBeenCalledTimes(1);
  expect(analyzePresentationTemplate).toHaveBeenCalledTimes(1);
});

it('allows company templates above 50 MB when self-host reports no upload cap', async () => {
  const file = Object.defineProperty(new File(['pptx'], 'large.potx'), 'size', { value: 51 * 1024 * 1024 });

  jest.mocked(importPresentationTemplate).mockResolvedValueOnce(original);
  jest.mocked(analyzePresentationTemplate).mockResolvedValueOnce(original);
  render(<StyleSettings styles={[]} scope={{ workspaceId: 'workspace' }} onChange={jest.fn()} maxTemplateBytes={null} />);
  expect(screen.getByText('.pptx or .potx')).toBeTruthy();
  expect(screen.queryByText(/up to .* MB/)).toBeNull();
  fireEvent.change(screen.getByLabelText('Import template'), { target: { files: [file] } });
  await screen.findByText('Theme analyzed. Review its appearance before saving.');
  expect(importPresentationTemplate).toHaveBeenCalledTimes(1);
  expect(analyzePresentationTemplate).toHaveBeenCalledTimes(1);
});

it('reviews the exact saved version and changed server theme while preserving template geometry, assets and mandatory footer', async () => {
  const saved = { ...original, name: 'Updated company', serverVersion: 8 };

  jest.mocked(reviewPresentationStyle).mockResolvedValue(saved);
  const changed = jest.fn();

  render(<StyleSettings styles={[original]} scope={{ workspaceId: 'workspace' }} onChange={changed} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Style name'), { target: { value: 'Updated company' } });
  fireEvent.change(screen.getByLabelText('Brand color'), { target: { value: '#abcdef' } });
  expect((screen.getByLabelText('Mandatory footer')).readOnly).toBe(true);
  expect(screen.queryByText('Create style')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save style' }));
  await waitFor(() => expect(changed).toHaveBeenCalledWith([saved]));
  const [scope, candidate, signal] = jest.mocked(reviewPresentationStyle).mock.calls[0];

  expect(scope).toEqual({ workspaceId: 'workspace' });
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(candidate.serverVersion).toBe(7);
  expect(candidate.serverStyle).toEqual({
    ...original.serverStyle,
    theme: { ...original.serverStyle!.theme, name: 'Updated company', color: '#abcdef' },
  });
  expect(original.name).toBe('Company');
});

it('keeps an edit and its version after a failed review without publishing optimistic styles', async () => {
  jest.mocked(reviewPresentationStyle).mockRejectedValue(new Error('Style changed. Refresh before saving.'));
  const changed = jest.fn();

  render(<StyleSettings styles={[original]} scope={{ workspaceId: 'workspace' }} onChange={changed} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Style name'), { target: { value: 'Unsaved edit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save style' }));
  await screen.findByText('Style changed. Refresh before saving.');
  expect(changed).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Style name')).value).toBe('Unsaved edit');
  expect(jest.mocked(reviewPresentationStyle).mock.calls[0][1].serverVersion).toBe(7);
});

it('deletes only with the saved version and updates the catalog only after server success', async () => {
  let finish!: () => void;

  jest.mocked(deleteArtifact).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const changed = jest.fn();

  render(<StyleSettings styles={[original]} scope={{ workspaceId: 'workspace' }} onChange={changed} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(deleteArtifact).toHaveBeenCalledWith({ workspaceId: 'workspace' }, original.id, 7, expect.any(AbortSignal));
  expect(changed).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(changed).toHaveBeenCalledWith([]);
});

it('uploads the chosen file and ignores a completion after workspace switch', async () => {
  let finish!: (style: PresentationStyle) => void;

  jest.mocked(importPresentationTemplate).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const changed = jest.fn();
  const rendered = render(<StyleSettings styles={[]} scope={{ workspaceId: 'first' }} onChange={changed} />);
  const file = new File(['pptx'], 'company.pptx');

  fireEvent.change(screen.getByLabelText('Import template'), { target: { files: [file] } });
  expect(importPresentationTemplate).toHaveBeenCalledWith({ workspaceId: 'first' }, file, expect.any(AbortSignal));
  const signal = jest.mocked(importPresentationTemplate).mock.calls[0][2]!;

  rendered.rerender(<StyleSettings styles={[]} scope={{ workspaceId: 'second' }} onChange={changed} />);
  expect(signal.aborted).toBe(true);
  await act(async () => finish(original));
  expect(changed).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Style name')).toBeNull();
});

it('keeps all mutations disabled when current workspace access is denied', () => {
  render(
    <StyleSettings styles={[original]} scope={{ workspaceId: 'workspace' }} onChange={jest.fn()} editable={false} />
  );
  expect((screen.getByLabelText('Import template')).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Edit' })).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Remove' })).disabled).toBe(true);
  expect(deleteArtifact).not.toHaveBeenCalled();
});

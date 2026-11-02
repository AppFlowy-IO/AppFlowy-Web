import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { analyzePresentationTemplate, importPresentationTemplate, reviewPresentationStyle, deleteArtifact } from '../presentation-client';
import { reviewedStyleToStyle } from '../server-adapter';
import StyleSettings from '../StyleSettings';

jest.mock('../presentation-client', () => ({ analyzePresentationTemplate: jest.fn(), importPresentationTemplate: jest.fn(), reviewPresentationStyle: jest.fn(), deleteArtifact: jest.fn() }));
jest.mock('../SlideCanvas', () => ({ __esModule: true, default: () => null }));

const style = reviewedStyleToStyle({ reference: { id: 'style', version: 2 }, templateSlides: [],
  theme: { id: 'theme', name: 'Brand', description: '', color: '#112233', background: '#ffffff', textColor: '#000000', font: 'Arial', bodyFont: 'Arial', footer: '', palette: [], guidelines: '' } }, false, [], true);
const onChange = jest.fn();
const onUpgrade = jest.fn();
const refresh = jest.fn();
const scope = { workspaceId: 'workspace' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(reviewPresentationStyle).mockResolvedValue(style);
  jest.mocked(importPresentationTemplate).mockResolvedValue({ ...style, company: false });
  jest.mocked(analyzePresentationTemplate).mockResolvedValue({ ...style, company: false });
  jest.mocked(deleteArtifact).mockResolvedValue(undefined as never);
  Object.defineProperty(global, 'structuredClone', { configurable: true, value: (value: unknown) => JSON.parse(JSON.stringify(value)) });
});

test('Free owner keeps ordinary 5 MiB imports but company configuration save offers Upgrade', async () => {
  render(<StyleSettings scope={scope} styles={[]} editable companyStyles={false} isPro={false} onChange={onChange} onUpgrade={onUpgrade} onStatusRefresh={refresh} />);
  const file = Object.defineProperty(new File(['pptx'], 'ordinary.pptx'), 'size', { value: 5 * 1024 * 1024 });

  fireEvent.change(screen.getByLabelText('Import template'), { target: { files: [file] } });
  await screen.findByRole('button', { name: 'Save style' });
  expect(importPresentationTemplate).toHaveBeenCalledWith(scope, file, expect.any(AbortSignal));
  expect(analyzePresentationTemplate).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Save style' }));
  await waitFor(() => expect(reviewPresentationStyle).not.toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));
  expect(onUpgrade).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText<HTMLInputElement>('Style name').value).toBe('Brand');
  expect(refresh).toHaveBeenCalled();
});

test('paid owner explicitly promotes through company:true and refreshes status', async () => {
  render(<StyleSettings scope={scope} styles={[style]} editable companyStyles isPro onChange={onChange} onUpgrade={onUpgrade} onStatusRefresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save style' }));
  await waitFor(() => expect(reviewPresentationStyle).toHaveBeenCalledWith(scope, expect.objectContaining({ id: 'style' }), expect.any(AbortSignal), true));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
});

test('member cannot edit company configuration; owner can delete it after downgrade', async () => {
  const view = render(<StyleSettings scope={scope} styles={[style]} editable={false} companyStyles onChange={onChange} onUpgrade={onUpgrade} />);

  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Edit' }).disabled).toBe(true);
  expect(screen.getByLabelText<HTMLInputElement>('Import template').disabled).toBe(true);
  view.rerender(<StyleSettings scope={scope} styles={[style]} editable companyStyles={false} onChange={onChange} onUpgrade={onUpgrade} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await waitFor(() => expect(deleteArtifact).toHaveBeenCalledWith(scope, 'style', 2, expect.any(AbortSignal)));
});

test.each([[402, true, true], [413, true, true], [413, false, false], [403, true, false], [429, true, false], [503, true, false]])('style failure %i upgradeRequired=%s shows Upgrade=%s', async (status, upgradeRequired, expected) => {
  jest.mocked(reviewPresentationStyle).mockRejectedValue(Object.assign(new Error('Save failed'), { status, details: { upgradeRequired } }));
  render(<StyleSettings scope={scope} styles={[style]} editable companyStyles onChange={onChange} onUpgrade={onUpgrade} onStatusRefresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save style' }));
  await screen.findByText('Save failed');
  expect(Boolean(screen.queryByRole('button', { name: 'Upgrade to Pro' }))).toBe(expected);
  expect(screen.getByLabelText<HTMLInputElement>('Style name').value).toBe('Brand');
  expect(refresh).toHaveBeenCalled();
});

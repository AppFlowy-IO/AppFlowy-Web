import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { FieldType } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import GridNewProperty from '@/components/database/components/grid/grid-column/GridNewProperty';
import PropertySelectTrigger from '@/components/database/components/property/PropertySelectTrigger';
import { useVerificationPropertyConversion } from '@/components/page-verification/useVerificationPropertyConversion';

import type { HTMLAttributes, ReactNode } from 'react';

const mockNewProperty = jest.fn(() => 'new-text');
const mockSetActiveProperty = jest.fn();
const mockDeleteProperty = jest.fn();
const mockCreateVerification = jest.fn();
const mockRemoveVerification = jest.fn();
const mockSwitchType = jest.fn();
const mockField = new Map<string, unknown>();
let mockVerification: Record<string, unknown>;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
jest.mock('@/application/database-yjs', () => ({
  FieldType: jest.requireActual('@/application/database-yjs/database.type').FieldType,
  isAIFieldType: () => false,
  useFieldSelector: () => ({ field: mockField }),
}));
jest.mock('@/application/database-yjs/dispatch', () => ({
  useNewPropertyDispatch: () => mockNewProperty,
  useDeletePropertyDispatch: () => mockDeleteProperty,
  useSwitchPropertyType: () => mockSwitchType,
}));
jest.mock('@/application/page-verification/database', () => ({
  useDatabaseVerification: () => mockVerification,
}));
jest.mock('@/components/database/grid/useGridContext', () => ({
  useGridContext: () => ({ setActivePropertyId: mockSetActiveProperty }),
}));
jest.mock('@/components/app/app.hooks', () => ({ useAIEnabled: () => true }));
jest.mock('@/components/database/components/field', () => ({ FieldTypeIcon: () => null }));
jest.mock('@/components/database/components/field/FieldLabel', () => ({
  __esModule: true,
  default: ({ type }: { type: number }) => <span>Type {type}</span>,
}));
jest.mock('@/components/billing/UpgradePlan', () => ({ __esModule: true, default: () => <div>Upgrade checkout</div> }));
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));
jest.mock('@/components/ui/dropdown-menu', () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <div>{children}</div>;

  return {
    DropdownMenuGroup: Wrapper,
    DropdownMenuPortal: Wrapper,
    DropdownMenuSub: Wrapper,
    DropdownMenuSubContent: Wrapper,
    DropdownMenuSubTrigger: Wrapper,
    DropdownMenuItem: ({
      children,
      onSelect,
      disabled,
      ...props
    }: HTMLAttributes<HTMLButtonElement> & {
      disabled?: boolean;
      onSelect?: (event: Event) => void;
    }) => (
      <button {...props} disabled={disabled} onClick={(event) => onSelect?.(event.nativeEvent)}>
        {children}
      </button>
    ),
  };
});

function Conversion({ onClose, target = FieldType.Verification }: { onClose: () => void; target?: FieldType }) {
  const { convert, feedback } = useVerificationPropertyConversion('new-text', onClose);

  return (
    <>
      <button onClick={() => void convert(target)}>Switch</button>
      {feedback}
    </>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateVerification.mockReset().mockResolvedValue({ id: 'generation-A' });
  mockRemoveVerification.mockReset().mockResolvedValue(undefined);
  mockSwitchType.mockReset().mockResolvedValue(undefined);
  mockField.clear();
  mockField.set(YjsDatabaseKey.id, 'new-text');
  mockField.set(YjsDatabaseKey.type, FieldType.RichText);
  mockField.set(YjsDatabaseKey.name, 'Text');
  mockField.set(YjsDatabaseKey.is_primary, false);
  mockVerification = {
    state: { can_edit: true, eligible: true },
    property: null,
    readOnly: false,
    assertEditable: jest.fn(),
    store: { create: mockCreateVerification, remove: mockRemoveVerification },
  };
});

it('opens the ordinary Text property editor directly from + New property', () => {
  render(<GridNewProperty />);
  fireEvent.click(screen.getByTestId('grid-new-property-button'));
  expect(mockNewProperty).toHaveBeenCalledWith(FieldType.RichText);
  expect(mockSetActiveProperty).toHaveBeenCalledWith('new-text');
  expect(screen.queryByText('New property · Verification')).toBeNull();
  expect(mockCreateVerification).not.toHaveBeenCalled();
});

it('offers Verification alongside the ordinary field types', () => {
  const request = jest.fn();

  render(<PropertySelectTrigger fieldId='new-text' onRequestVerification={request} />);
  expect(screen.getByTestId(`property-type-option-${FieldType.RichText}`)).toBeTruthy();
  fireEvent.click(screen.getByTestId(`property-type-option-${FieldType.Verification}`));
  expect(request).toHaveBeenCalledTimes(1);
  expect(mockSwitchType).not.toHaveBeenCalled();
});

it('does not offer a second Verification property', () => {
  mockVerification.nativeField = new Map([[YjsDatabaseKey.id, 'existing']]);
  const request = jest.fn();

  render(<PropertySelectTrigger fieldId='new-text' onRequestVerification={request} />);
  fireEvent.click(screen.getByTestId(`property-type-option-${FieldType.Verification}`));
  expect(request).not.toHaveBeenCalled();
});

it('preserves the original property until creation succeeds', async () => {
  let finish!: (property: { id: string }) => void;

  mockCreateVerification.mockReturnValue(
    new Promise<{ id: string }>((resolve) => {
      finish = resolve;
    })
  );
  const close = jest.fn();

  render(<Conversion onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockCreateVerification).toHaveBeenCalledTimes(1);
  expect(mockDeleteProperty).not.toHaveBeenCalled();
  expect(mockSwitchType).not.toHaveBeenCalled();
  finish({ id: 'generation-A' });
  await waitFor(() =>
    expect(mockSwitchType).toHaveBeenCalledWith('new-text', FieldType.Verification, {
      expectedFieldType: FieldType.RichText,
      assertEditable: mockVerification.assertEditable,
      expectedVerificationPropertyId: undefined,
      verificationPropertyId: 'generation-A',
    })
  );
  expect(mockDeleteProperty).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
});

it('keeps the original property when the server rejects creation', async () => {
  mockCreateVerification.mockRejectedValue(new Error('Connection lost'));
  render(<Conversion onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Connection lost'));
  expect(mockDeleteProperty).not.toHaveBeenCalled();
});

it('keeps the property when an upgrade is needed', () => {
  mockVerification.state = { can_edit: true, eligible: false };
  const close = jest.fn();

  render(<Conversion onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
  expect(screen.getByText('Upgrade checkout')).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  expect(mockCreateVerification).not.toHaveBeenCalled();
  expect(mockDeleteProperty).not.toHaveBeenCalled();
});

function bindVerification(propertyId = 'generation-A') {
  mockField.set(YjsDatabaseKey.type, FieldType.Verification);
  mockField.set(
    YjsDatabaseKey.type_option,
    new Map([[String(FieldType.Verification), new Map([[YjsDatabaseKey.property_id, propertyId]])]])
  );
  mockVerification.nativeField = mockField;
}

it('routes leaving Verification through the guarded conversion flow', () => {
  bindVerification();
  const request = jest.fn();

  render(<PropertySelectTrigger fieldId='new-text' onRequestVerification={request} />);
  fireEvent.click(screen.getByTestId(`property-type-option-${FieldType.Number}`));
  expect(request).toHaveBeenCalledWith(FieldType.Number);
  expect(mockSwitchType).not.toHaveBeenCalled();
});

it('asks before leaving Verification and keeps the field on cancel', async () => {
  bindVerification();
  render(<Conversion target={FieldType.Number} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
  await screen.findByText('grid.verification.conversionTitle');
  expect(mockRemoveVerification).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'button.cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mockSwitchType).not.toHaveBeenCalled();
});

it('preserves the native field ID when converting Verification to Number', async () => {
  bindVerification();
  render(<Conversion target={FieldType.Number} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
  fireEvent.click(await screen.findByRole('button', { name: 'grid.verification.conversionConfirm' }));
  await waitFor(() =>
    expect(mockSwitchType).toHaveBeenCalledWith('new-text', FieldType.Number, {
      expectedFieldType: FieldType.Verification,
      assertEditable: mockVerification.assertEditable,
      expectedVerificationPropertyId: 'generation-A',
    })
  );
  expect(mockRemoveVerification).toHaveBeenCalledWith('generation-A');
  expect(mockDeleteProperty).not.toHaveBeenCalled();
});

it('rejects a property rebound while the conversion confirmation is open', async () => {
  bindVerification();
  render(<Conversion target={FieldType.RichText} onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
  await screen.findByText('grid.verification.conversionTitle');
  bindVerification('generation-B');
  fireEvent.click(screen.getByRole('button', { name: 'grid.verification.conversionConfirm' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Verification property changed'));
  expect(mockRemoveVerification).not.toHaveBeenCalled();
  expect(mockSwitchType).not.toHaveBeenCalled();
});

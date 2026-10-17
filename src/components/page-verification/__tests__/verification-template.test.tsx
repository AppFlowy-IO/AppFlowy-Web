import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import * as Y from 'yjs';

import { createFieldWithTypeOption } from '@/application/database-yjs/__tests__/test-helpers';
import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType, FieldVisibility } from '@/application/database-yjs/database.type';
import { useFieldsSelector } from '@/application/database-yjs/selector';
import { getVerificationProperty } from '@/application/services/js-services/http/page-verification-api';
import { YDatabase, YDatabaseField, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import RowPropertyCell from '@/components/database/components/database-row/RowPropertyCell';

const mockVerificationControl = jest.fn(() => <button>Click to verify</button>);

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/page-verification/PageVerificationControl', () => ({
  PageVerificationControl: () => mockVerificationControl(),
}));
jest.mock('@/application/publish', () => ({ usePublishContext: () => undefined }));
jest.mock('@/components/main/app.hooks', () => ({ useAuthenticatedUserIdOptional: () => 'user' }));
jest.mock('@/application/services/js-services/http/page-verification-api', () => ({
  getVerificationProperty: jest.fn(),
}));

function fixture(hidden = false) {
  const doc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();
  const field = new Y.Map() as YDatabaseField;
  const view = new Y.Map() as YDatabaseView;
  const views = new Y.Map<YDatabaseView>();

  field.set(YjsDatabaseKey.id, 'text');
  field.set(YjsDatabaseKey.name, 'Text');
  field.set(YjsDatabaseKey.type, FieldType.RichText);
  fields.set('text', field);
  const verification = createFieldWithTypeOption('native-verification', FieldType.Verification, {
    property_id: 'property',
  });
  const nativeField = new Y.Map() as YDatabaseField;

  nativeField.set(YjsDatabaseKey.id, 'native-verification');
  nativeField.set(YjsDatabaseKey.name, 'Verification');
  nativeField.set(YjsDatabaseKey.type, FieldType.Verification);
  nativeField.set(YjsDatabaseKey.type_option, verification.get(YjsDatabaseKey.type_option).clone());
  fields.set('native-verification', nativeField);
  view.set(YjsDatabaseKey.field_orders, Y.Array.from([{ id: 'text' }, { id: 'native-verification' }]));
  const settings = new Y.Map();

  settings.set(
    'native-verification',
    new Y.Map([[YjsDatabaseKey.visibility, hidden ? FieldVisibility.AlwaysHidden : FieldVisibility.AlwaysShown]])
  );
  view.set(YjsDatabaseKey.field_settings, settings);
  views.set('view', view);
  database.set(YjsDatabaseKey.id, doc.guid);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  const context: DatabaseContextState = {
    readOnly: false,
    databaseDoc: doc,
    databasePageId: 'view',
    activeViewId: 'view',
    workspaceId: 'workspace',
    templateEditingRowId: 'template',
    rowMap: {},
  };

  (getVerificationProperty as jest.Mock).mockResolvedValue({
    property: { id: 'property', database_id: doc.guid },
    views: { view: { hidden } },
    can_edit: true,
    eligible: true,
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
  );

  return { Wrapper, context, fields };
}

beforeEach(() => jest.clearAllMocks());

it('includes the native Verification schema in the template property list', async () => {
  const { Wrapper, fields } = fixture();
  const { result } = renderHook(() => useFieldsSelector(), { wrapper: Wrapper });

  await waitFor(() => expect(result.current.map(({ fieldId }) => fieldId)).toEqual(['text', 'native-verification']));
  expect(Number(fields.get('native-verification')?.get(YjsDatabaseKey.type))).toBe(FieldType.Verification);
  expect(getVerificationProperty).not.toHaveBeenCalled();
});

it('respects hidden visibility and includes Verification when hidden properties are revealed', async () => {
  const { Wrapper } = fixture(true);
  const { result } = renderHook(
    () => ({
      visible: useFieldsSelector(),
      all: useFieldsSelector([FieldVisibility.AlwaysShown, FieldVisibility.AlwaysHidden]),
    }),
    { wrapper: Wrapper }
  );

  await waitFor(() => expect(result.current.all).toHaveLength(2));
  expect(result.current.visible.map(({ fieldId }) => fieldId)).toEqual(['text']);
});

it('renders a non-editable template value without mounting the verification control', async () => {
  const { Wrapper } = fixture();
  const { rerender } = render(<RowPropertyCell rowId='template' fieldId='native-verification' templateStyle />, {
    wrapper: Wrapper,
  });

  expect(getVerificationProperty).not.toHaveBeenCalled();
  const placeholder = screen.getByText('—');

  fireEvent.mouseEnter(placeholder.parentElement!);
  fireEvent.click(placeholder);
  expect(placeholder.parentElement?.className).not.toContain('cursor-pointer');
  expect(screen.queryByRole('button')).toBeNull();
  expect(mockVerificationControl).not.toHaveBeenCalled();

  // A real row still uses the normal verification control.
  rerender(<RowPropertyCell rowId='real-row' fieldId='native-verification' />);
  expect(screen.getByRole('button', { name: 'Click to verify' })).toBeTruthy();
});

it('does not load live Verification metadata in historical templates', () => {
  const { Wrapper, context } = fixture();

  context.dataSource = { type: 'history', id: 'snapshot' };
  const { result } = renderHook(() => useFieldsSelector(), { wrapper: Wrapper });

  expect(result.current.map(({ fieldId }) => fieldId)).toEqual(['text', 'native-verification']);
  render(<RowPropertyCell rowId='historical-row' fieldId='native-verification' />, { wrapper: Wrapper });
  expect(screen.getByText('—')).toBeTruthy();
  expect(mockVerificationControl).not.toHaveBeenCalled();
  expect(getVerificationProperty).not.toHaveBeenCalled();
});

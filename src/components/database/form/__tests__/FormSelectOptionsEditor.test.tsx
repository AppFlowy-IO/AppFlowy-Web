import { act, Profiler, ProfilerOnRenderCallback } from 'react';
import { render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { SelectOptionColor } from '@/application/database-yjs/fields/select-option/select_option.type';
import type {
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFieldTypeOption,
  YMapFieldTypeOption,
} from '@/application/types';
import { YjsDatabaseKey } from '@/application/types';

import { FormSelectOptionsEditor } from '../FormSelectOptionsEditor';

function createSelectField(id: string, optionName: string): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;
  const typeOptions = new Y.Map() as YDatabaseFieldTypeOption;
  const typeOption = new Y.Map() as YMapFieldTypeOption;

  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  typeOption.set(
    YjsDatabaseKey.content,
    JSON.stringify({
      disable_color: false,
      options: [{ id: `option-${id}`, name: optionName, color: SelectOptionColor.OptionColor1 }],
    })
  );
  typeOptions.set(String(FieldType.SingleSelect), typeOption);
  field.set(YjsDatabaseKey.type_option, typeOptions);
  return field;
}

function setOptionName(field: YDatabaseField, name: string) {
  field
    .get(YjsDatabaseKey.type_option)
    .get(String(FieldType.SingleSelect))
    .set(
      YjsDatabaseKey.content,
      JSON.stringify({
        disable_color: false,
        options: [
          {
            id: `option-${field.get(YjsDatabaseKey.id)}`,
            name,
            color: SelectOptionColor.OptionColor1,
          },
        ],
      })
    );
}

describe('FormSelectOptionsEditor subscriptions', () => {
  it('rerenders only the editor for the field whose options changed', () => {
    const doc = new Y.Doc();
    const fields = doc.getMap('fields') as YDatabaseFields;
    const first = createSelectField('first', 'First option');
    const second = createSelectField('second', 'Second option');
    const commits = { first: 0, second: 0 };
    const onRender: ProfilerOnRenderCallback = (id) => {
      commits[id as keyof typeof commits] += 1;
    };

    fields.set('first', first);
    fields.set('second', second);

    render(
      <>
        <Profiler id='first' onRender={onRender}>
          <FormSelectOptionsEditor fieldId='first' field={first} addOption={jest.fn()} />
        </Profiler>
        <Profiler id='second' onRender={onRender}>
          <FormSelectOptionsEditor fieldId='second' field={second} addOption={jest.fn()} />
        </Profiler>
      </>
    );

    commits.first = 0;
    commits.second = 0;

    act(() => setOptionName(first, 'Updated first option'));

    expect(screen.getByText('Updated first option')).not.toBeNull();
    expect(screen.getByText('Second option')).not.toBeNull();
    expect(commits.first).toBe(1);
    expect(commits.second).toBe(0);
  });
});

import { useMemo } from 'react';

import { FieldVisibility, useDatabaseGroupFieldIdSelector, useFieldsSelector } from '@/application/database-yjs';

const GALLERY_FIELD_VISIBILITIES = [
  FieldVisibility.AlwaysShown,
  FieldVisibility.HideWhenEmpty,
  FieldVisibility.AlwaysHidden,
];

/** The same visible fields drive Gallery cards and a peek's background search. */
export function useGalleryFields() {
  const allFields = useFieldsSelector(GALLERY_FIELD_VISIBILITIES);
  const groupFieldId = useDatabaseGroupFieldIdSelector();

  return useMemo(
    () =>
      allFields.filter(
        (field) =>
          field.fieldId !== groupFieldId && (field.isPrimary || field.visibility !== FieldVisibility.AlwaysHidden)
      ),
    [allFields, groupFieldId]
  );
}

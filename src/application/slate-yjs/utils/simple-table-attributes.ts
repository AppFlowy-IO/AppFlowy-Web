/**
 * Attribute index remapping utilities for SimpleTable operations.
 *
 * When rows or columns are inserted, deleted, duplicated, or reordered,
 * all index-keyed attribute maps (colors, alignment, widths, bold, text colors)
 * must be updated to reflect the new structure.
 *
 * This logic must match the desktop Flutter `mapTableAttributes` exactly
 * for cross-platform data compatibility.
 */

type AttributeMap = Record<string, unknown>;

/**
 * Remap an index-keyed attribute map after a structural operation.
 */
export function remapAttributes(
  attrs: AttributeMap | undefined,
  operation: 'insert' | 'delete' | 'duplicate' | 'reorder',
  index: number,
  toIndex?: number
): AttributeMap {
  if (!attrs || Object.keys(attrs).length === 0) {
    if (operation === 'duplicate') {
      // When duplicating, copy the source value to the new index
      return {};
    }

    return {};
  }

  switch (operation) {
    case 'insert':
      return remapForInsert(attrs, index);
    case 'delete':
      return remapForDelete(attrs, index);
    case 'duplicate':
      return remapForDuplicate(attrs, index);
    case 'reorder':
      return remapForReorder(attrs, index, toIndex!);
    default:
      return { ...attrs };
  }
}

/**
 * Insert at index: shift all keys >= index by +1, leave a gap at index.
 */
function remapForInsert(attrs: AttributeMap, index: number): AttributeMap {
  const result: AttributeMap = {};

  for (const [key, value] of Object.entries(attrs)) {
    const numKey = Number(key);

    if (isNaN(numKey)) {
      result[key] = value;
      continue;
    }

    if (numKey >= index) {
      result[String(numKey + 1)] = value;
    } else {
      result[String(numKey)] = value;
    }
  }

  return result;
}

/**
 * Delete at index: remove key at index, shift all keys > index by -1.
 */
function remapForDelete(attrs: AttributeMap, index: number): AttributeMap {
  const result: AttributeMap = {};

  for (const [key, value] of Object.entries(attrs)) {
    const numKey = Number(key);

    if (isNaN(numKey)) {
      result[key] = value;
      continue;
    }

    if (numKey === index) {
      // Skip deleted index
      continue;
    } else if (numKey > index) {
      result[String(numKey - 1)] = value;
    } else {
      result[String(numKey)] = value;
    }
  }

  return result;
}

/**
 * Duplicate at index: copy value at index to index+1, shift all keys > index by +1.
 */
function remapForDuplicate(attrs: AttributeMap, index: number): AttributeMap {
  const result: AttributeMap = {};
  let sourceValue: unknown = undefined;

  for (const [key, value] of Object.entries(attrs)) {
    const numKey = Number(key);

    if (isNaN(numKey)) {
      result[key] = value;
      continue;
    }

    if (numKey === index) {
      sourceValue = value;
      result[String(numKey)] = value;
    } else if (numKey > index) {
      result[String(numKey + 1)] = value;
    } else {
      result[String(numKey)] = value;
    }
  }

  // Place the duplicated value at index + 1
  if (sourceValue !== undefined) {
    result[String(index + 1)] = sourceValue;
  }

  return result;
}

/**
 * Reorder from fromIndex to toIndex: move the value and shift everything in between.
 */
function remapForReorder(attrs: AttributeMap, fromIndex: number, toIndex: number): AttributeMap {
  if (fromIndex === toIndex) return { ...attrs };

  const result: AttributeMap = {};
  const movingValue = attrs[String(fromIndex)];

  for (const [key, value] of Object.entries(attrs)) {
    const numKey = Number(key);

    if (isNaN(numKey)) {
      result[key] = value;
      continue;
    }

    if (numKey === fromIndex) {
      // Will be placed at toIndex
      continue;
    }

    if (fromIndex < toIndex) {
      // Moving forward: items between (fromIndex, toIndex] shift -1
      if (numKey > fromIndex && numKey <= toIndex) {
        result[String(numKey - 1)] = value;
      } else {
        result[String(numKey)] = value;
      }
    } else {
      // Moving backward: items between [toIndex, fromIndex) shift +1
      if (numKey >= toIndex && numKey < fromIndex) {
        result[String(numKey + 1)] = value;
      } else {
        result[String(numKey)] = value;
      }
    }
  }

  if (movingValue !== undefined) {
    result[String(toIndex)] = movingValue;
  }

  return result;
}

/**
 * Column attribute keys that need remapping on column operations.
 */
export const COLUMN_ATTRIBUTE_KEYS = [
  'column_widths',
  'column_colors',
  'column_aligns',
  'column_bold_attributes',
  'column_text_colors',
] as const;

/**
 * Row attribute keys that need remapping on row operations.
 */
export const ROW_ATTRIBUTE_KEYS = [
  'row_colors',
  'row_aligns',
  'row_bold_attributes',
  'row_text_colors',
] as const;

/**
 * Remap all column attributes in a table's data after a column operation.
 */
export function remapColumnAttributes(
  data: Record<string, unknown>,
  operation: 'insert' | 'delete' | 'duplicate' | 'reorder',
  index: number,
  toIndex?: number
): Record<string, unknown> {
  const result = { ...data };

  for (const key of COLUMN_ATTRIBUTE_KEYS) {
    if (result[key]) {
      result[key] = remapAttributes(result[key] as AttributeMap, operation, index, toIndex);
    }
  }

  return result;
}

/**
 * Remap all row attributes in a table's data after a row operation.
 */
export function remapRowAttributes(
  data: Record<string, unknown>,
  operation: 'insert' | 'delete' | 'duplicate' | 'reorder',
  index: number,
  toIndex?: number
): Record<string, unknown> {
  const result = { ...data };

  for (const key of ROW_ATTRIBUTE_KEYS) {
    if (result[key]) {
      result[key] = remapAttributes(result[key] as AttributeMap, operation, index, toIndex);
    }
  }

  return result;
}

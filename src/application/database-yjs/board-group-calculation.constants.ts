/**
 * Generated from `__fixtures__/dashboard-parity/group-calculations.json`
 * (`supported_field_types`, `valid_types_by_field_type`, `calculation_to_aggregation`),
 * so the bundle does not ship the fixture. Do not edit by hand: change the fixture,
 * then copy its tables here; `board-group-calculation.test.ts` fails while they differ.
 */

/** FieldType ints that offer a board group calculation (WP09 §1.6). */
export const GROUP_CALCULATION_SUPPORTED_FIELD_TYPES: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** CalculationType ints valid for each supported field type, in menu order. */
export const GROUP_CALCULATION_VALID_TYPES_BY_FIELD_TYPE: Readonly<Record<string, readonly number[]>> = {
  '0': [17, 6, 7, 15, 16],
  '1': [17, 6, 7, 15, 16, 4, 0, 3, 1, 2, 11],
  '2': [17, 6, 7, 15, 16, 8, 9, 10],
  '3': [17, 6, 7, 15, 16],
  '4': [17, 6, 7, 15, 16],
  '5': [17, 13, 14, 19, 20],
  '6': [17],
  '7': [17, 6, 7, 15, 16],
  '8': [17, 8, 9, 10],
  '9': [17, 8, 9, 10],
};

/** The R-FORMAT aggregation (`formatChartValue` `aggregation`) of each CalculationType. */
export const GROUP_CALCULATION_TO_AGGREGATION: Readonly<Record<string, number>> = {
  '0': 2,
  '1': 4,
  '2': 5,
  '3': 3,
  '4': 1,
  '5': 0,
  '6': 8,
  '7': 7,
  '8': 13,
  '9': 14,
  '10': 15,
  '11': 16,
  '13': 7,
  '14': 7,
  '15': 9,
  '16': 10,
  '17': 6,
  '19': 11,
  '20': 12,
};

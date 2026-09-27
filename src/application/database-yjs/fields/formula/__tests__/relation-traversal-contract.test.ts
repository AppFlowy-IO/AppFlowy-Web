/**
 * Mirrored desktop/web contract for relation title lists. Rejection tests expose
 * the missing related-page traversal capability; they do not claim it works.
 */
import { FieldType } from '@/application/database-yjs/database.type';

import { compileFormula } from '../compile';
import { readFormulaSchema } from '../schema';

import { createFields } from './fixture';

function schema() {
  return readFormulaSchema(
    createFields([
      { id: 'tasks', name: 'Tasks', type: FieldType.Relation },
      { id: 'expenses', name: 'Expenses', type: FieldType.Relation },
      // Local properties cannot substitute for current's related-row properties.
      { id: 'done', name: 'Done', type: FieldType.Checkbox },
      { id: 'priority', name: 'Priority', type: FieldType.SingleSelect },
      { id: 'hours', name: 'Hours', type: FieldType.Number },
      { id: 'amount', name: 'Amount', type: FieldType.Number },
    ])
  );
}

describe('current relation title-list contract', () => {
  it.each([
    'prop("Tasks").filter(current.prop("Done") == true).length()',
    'prop("Expenses").map(current.prop("Amount")).sum()',
    'prop("Tasks").filter(current.prop("Priority") == "High").filter(current.prop("Done") == false).length()',
    'prop("Tasks").filter(current.prop("Done") == true).map(current.prop("Hours")).sum()',
  ])('reports unsupported related-page access: %s', (expression) => {
    const result = compileFormula(expression, schema());

    expect(result.error?.message).toBe('Unknown function "prop"');
    expect(result.resultType).toBe('any');
  });

  it.each(['prop("Tasks").length()', 'prop("Tasks").filter(current == "QA testing").length()'])(
    'allows relation title-list operations: %s',
    (expression) => {
      const result = compileFormula(expression, schema());

      expect(result.error).toBeUndefined();
      expect(result.resultType).toBe('number');
    }
  );
});

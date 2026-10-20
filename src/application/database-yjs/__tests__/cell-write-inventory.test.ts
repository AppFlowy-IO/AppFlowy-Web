/**
 * @jest-environment node
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative, resolve } from 'path';

import ts from 'typescript';

/**
 * Every web write to an existing cell must go through the rich text guard
 * (`checkExistingCellWrite`, rich text spec R49), or a cell formatted by a
 * newer version of AppFlowy could be overwritten. This inventory finds every
 * place that writes cell data or a cell's type, or adds or removes a cell, and
 * fails for one that is not listed here. A new writer must call the guard
 * (or build only new cells) and be added to the list with the reason.
 */

const SRC = resolve(__dirname, '../../..');

const WRITE_PATTERN =
  /\.set\(YjsDatabaseKey\.data\b|\.set\(YjsDatabaseKey\.rich_text\b|\.delete\(YjsDatabaseKey\.rich_text\b|\bsetCellStoredType\(|\.set\(YjsDatabaseKey\.field_type\b|\bcells\.delete\(|\bcells\.set\(/g;

/** `file:function` → why the write is safe. */
const ALLOWED: Record<string, string> = {
  // Guarded helpers: they call checkExistingCellWrite in the writing transaction.
  'application/database-yjs/dispatch/cell.ts:writeCellToRow': 'guarded',
  'application/database-yjs/dispatch/cell.ts:updateDateCell': 'called only by guarded writers',
  'application/database-yjs/dispatch/cell.ts:useUpdateStartEndTimeCells': 'guarded (whole drag)',
  'application/database-yjs/dispatch/row.ts:useMoveCardDispatch': 'guarded (board card move)',
  'application/database-yjs/dispatch/relation.ts:setRelationCellRowIds': 'guarded',
  'application/database-yjs/dispatch/relation.ts:getOrCreateRelationCell': 'called only by setRelationCellRowIds',
  'application/database-yjs/dispatch.ts:useClearCellsWithFieldDispatch': 'guarded (whole clear field)',
  // Bulk schema operations: they skip newer cells (R49b).
  'application/database-yjs/dispatch.ts:performSwitch': 'skips newer cells (field type switch)',
  'application/database-yjs/dispatch.ts:materializeFormulaResult': 'skips newer cells',
  'application/database-yjs/cell.field-type.ts:normalizeLegacyCellFieldType': 'skips newer cells',
  'application/database-yjs/cell.field-type.ts:setCellStoredType': 'the primitive; its callers are listed',
  // Copies into cells that do not exist yet (R47).
  'application/database-yjs/cell.clone.ts:cloneDatabaseCell': 'builds a new cell (verbatim copy)',
  'application/database-yjs/dispatch.ts:useDuplicatePropertyDispatch': 'new field: no existing cell',
  'application/database-yjs/dispatch/row.ts:useDuplicateRowDispatch': 'new row: no existing cell',
  // New-cell builders.
  'application/database-yjs/dispatch/new-row-cells.ts:populateNewRowCells': 'new row',
  'application/database-yjs/dispatch/relation.ts:createRowInRelatedDatabase': 'new related row',
  'application/database-yjs/template/cell.ts:createTemplateCell': 'new cell',
  'application/database-yjs/template/cell.ts:applyTemplateCellsToRow': 'new row from a template',
  'application/database-yjs/fields/checkbox/utils.ts:createCheckboxCell': 'new cell',
  'application/database-yjs/fields/select-option/utils.ts:createSelectOptionCell': 'new cell',
  // Not Text-written cells.
  'application/database-yjs/migrations/rollup_fieldtype.ts:migrateRowCells': 'touches Rollup cells only',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')
      ? [path]
      : [];
  });
}

/** The innermost named function around `position`. */
function enclosingFunction(source: ts.SourceFile, position: number) {
  let name = '<module>';

  const visit = (node: ts.Node) => {
    if (position < node.getStart(source) || position >= node.getEnd()) return;

    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
      name = node.name.getText(source);
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      name = node.name.getText(source);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return name;
}

function findWriteSites() {
  const sites = new Map<string, string[]>();

  sourceFiles(SRC).forEach((file) => {
    const text = readFileSync(file, 'utf8');

    if (!WRITE_PATTERN.test(text)) return;
    WRITE_PATTERN.lastIndex = 0;

    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

    for (const match of text.matchAll(WRITE_PATTERN)) {
      const key = `${relative(SRC, file)}:${enclosingFunction(source, match.index ?? 0)}`;
      const line = text.slice(0, match.index).split('\n').length;

      sites.set(key, [...(sites.get(key) ?? []), `${relative(SRC, file)}:${line} ${match[0]}`]);
    }
  });

  return sites;
}

describe('cell write inventory', () => {
  const sites = findWriteSites();

  it('finds every write site', () => {
    // Sanity check of the scanner itself.
    expect(sites.has('application/database-yjs/dispatch/cell.ts:writeCellToRow')).toBe(true);
  });

  it('lets only guarded helpers and new-cell builders write cells', () => {
    const unlisted = [...sites.entries()].filter(([key]) => !(key in ALLOWED)).flatMap(([, lines]) => lines);

    expect(unlisted).toEqual([]);
  });

  it('lists no writer that no longer exists', () => {
    expect(Object.keys(ALLOWED).filter((key) => !sites.has(key))).toEqual([]);
  });
});

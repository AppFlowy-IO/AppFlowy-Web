import fs from 'fs';
import path from 'path';

/**
 * `dispatch.ts` (the React hooks) and `dashboard-owned-view-ops.ts` used to
 * import each other. The hook-free view operations now live in
 * `database-view-doc-ops.ts`, which both import. These checks read the
 * sources, so the cycle cannot come back unnoticed: an import cycle still
 * runs, as long as nothing is read at module-evaluation time.
 */

const SRC = path.resolve(__dirname, '../../..');
const DATABASE_YJS = path.resolve(__dirname, '..');
const DISPATCH = path.join(DATABASE_YJS, 'dispatch.ts');
const BARREL = path.join(DATABASE_YJS, 'index.ts');

function resolveModule(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? path.join(SRC, specifier.slice(2))
    : specifier.startsWith('.')
    ? path.resolve(path.dirname(from), specifier)
    : null;

  if (!base) return null;
  return (
    [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')].find(
      (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    ) ?? null
  );
}

/** The modules a file imports or re-exports at runtime (`import type` / `export type` are erased). */
function runtimeImports(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8');
  const pattern = /^\s*(?:import|export)\s+(type\s+)?(?:[^;'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  const modules: string[] = [];

  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    if (match[1]) continue;
    const resolved = resolveModule(file, match[2]);

    if (resolved) modules.push(resolved);
  }

  return modules;
}

/** Every module of `database-yjs/` that `file` reaches through runtime imports inside that folder. */
function reachableDatabaseModules(file: string): Set<string> {
  const seen = new Set<string>([file]);
  const queue = [file];

  for (let current = queue.shift(); current; current = queue.shift()) {
    runtimeImports(current)
      .filter((module) => module.startsWith(DATABASE_YJS + path.sep) && !seen.has(module))
      .forEach((module) => {
        seen.add(module);
        queue.push(module);
      });
  }

  seen.delete(file);
  return seen;
}

const HOOK_FREE_MODULES = [
  'database-view-doc-ops.ts',
  'dashboard-owned-view-ops.ts',
  'dashboard-page.ts',
  'linked-view-creation.ts',
].map((name) => path.join(DATABASE_YJS, name));

describe('the database view operations and the hooks module', () => {
  it('reads the imports of a source file (the helper sees the known edges)', () => {
    const imports = runtimeImports(DISPATCH);

    expect(imports).toContain(path.join(DATABASE_YJS, 'database-view-doc-ops.ts'));
    expect(imports).toContain(path.join(DATABASE_YJS, 'dashboard-owned-view-ops.ts'));
    // A type-only import is not a runtime edge.
    expect(runtimeImports(path.join(DATABASE_YJS, 'database-view-doc-ops.ts'))).not.toContain(
      path.join(DATABASE_YJS, 'context.ts')
    );
  });

  it.each(HOOK_FREE_MODULES)('%s never reaches dispatch.ts or the barrel that re-exports it', (file) => {
    const reachable = reachableDatabaseModules(file);

    expect(reachable.has(DISPATCH)).toBe(false);
    expect(reachable.has(BARREL)).toBe(false);
  });

  it('keeps one direction between the two operation modules', () => {
    const docOps = path.join(DATABASE_YJS, 'database-view-doc-ops.ts');
    const ownedViewOps = path.join(DATABASE_YJS, 'dashboard-owned-view-ops.ts');

    expect(runtimeImports(ownedViewOps)).toContain(docOps);
    expect(reachableDatabaseModules(docOps).has(ownedViewOps)).toBe(false);
  });

  it('exports the layout table from the hooks module under its old name', async () => {
    const dispatch = await import('@/application/database-yjs/dispatch');
    const docOps = await import('@/application/database-yjs/database-view-doc-ops');

    expect(dispatch.DATABASE_VIEW_LAYOUT_TO_VIEW_LAYOUT).toBe(docOps.DATABASE_VIEW_LAYOUT_TO_VIEW_LAYOUT);
  });
});

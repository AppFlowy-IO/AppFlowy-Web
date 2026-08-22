/** @jest-environment node */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('Vite React dependency graph', () => {
  it('applies React deduplication and lazy chart pre-bundling to the resolved Vite configuration', async () => {
    const script = `
      import { loadConfigFromFile } from 'vite';
      import path from 'node:path';
      const loaded = await loadConfigFromFile(
        { command: 'serve', mode: 'test' },
        path.resolve('vite.config.ts')
      );
      console.log(JSON.stringify({
        dedupe: loaded?.config.resolve?.dedupe,
        include: loaded?.config.optimizeDeps?.include,
      }));
    `;
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: process.cwd(),
    });
    const resolvedConfig = JSON.parse(stdout) as { dedupe?: string[]; include?: string[] };

    expect(resolvedConfig.dedupe).toEqual(expect.arrayContaining(['react', 'react-dom']));
    expect(resolvedConfig.include).toEqual(expect.arrayContaining(['react', 'react-dom', 'recharts']));
  });
});

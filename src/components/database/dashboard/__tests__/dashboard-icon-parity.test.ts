/**
 * L1 static icon identity (VISUAL-PARITY.md §4.4): every dashboard icon's web
 * target asset must hash, under svg-norm/1, to the canonical glyph that the
 * desktop target hashes to as well. `enforced` icons fail this test;
 * `pending` icons are only reported; `waived` icons are skipped. The desktop
 * flutter unit test checks the desktop targets the same way.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import icons from '@/application/database-yjs/__fixtures__/dashboard-parity/icons.json';
import {
  IconEntry,
  IconsFixture,
  normalizeSvg,
  SVGR_SVGO_CONFIG_MARKERS,
  svgNormHash,
} from '@/application/database-yjs/visual-parity';

const fixture = icons as unknown as IconsFixture;
const ROOT = join(__dirname, '../../../../..');

interface IconVerdict {
  name: string;
  status: IconEntry['status'];
  wave: number;
  asset: string;
  problem: string | null;
  hash: string | null;
}

function webHash(asset: string): string | null {
  const path = join(ROOT, asset);

  return existsSync(path) ? svgNormHash(readFileSync(path, 'utf8')) : null;
}

function verdict(icon: IconEntry): IconVerdict {
  const { asset } = icon.web.target;
  const hash = webHash(asset);
  let problem: string | null = null;

  if (icon.canonical.sha256 === null) problem = 'no canonical glyph recorded yet';
  else if (hash === null) problem = 'web target asset does not exist';
  else if (hash !== icon.canonical.sha256) problem = `web target hashes to ${hash.slice(0, 12)}, canonical is ${icon.canonical.sha256.slice(0, 12)}`;
  return { name: icon.name, status: icon.status, wave: icon.wave, asset, problem, hash };
}

describe('svg-norm/1 normalization vectors', () => {
  it.each(fixture.normalizationVectors.map((vector) => [vector.name, vector]))('%s', (_name, vector) => {
    expect(normalizeSvg(vector.input)).toBe(vector.normalized);
    expect(svgNormHash(vector.input)).toBe(vector.sha256);
  });
});

describe('dashboard icon parity (web, L1)', () => {
  const verdicts = fixture.icons.filter((icon) => icon.status !== 'waived').map(verdict);

  it('every enforced icon renders its canonical glyph from the web target asset', () => {
    const failures = verdicts.filter((entry) => entry.status === 'enforced' && entry.problem);

    expect(failures.map((entry) => `${entry.name}: ${entry.problem} (${entry.asset})`)).toEqual([]);
  });

  it('reports pending icons that do not match yet', () => {
    const pending = verdicts.filter((entry) => entry.status === 'pending' && entry.problem);

    if (pending.length > 0) {
      // Reported, never failed: the owning wave flips them to enforced (§7).
      // eslint-disable-next-line no-console
      console.info(
        `dashboard icon parity: ${pending.length} pending icon(s) do not match yet\n` +
          pending.map((entry) => `  [W${entry.wave}] ${entry.name}: ${entry.problem} (${entry.asset})`).join('\n')
      );
    }

    expect(verdicts.length).toBe(fixture.icons.filter((icon) => icon.status !== 'waived').length);
  });

  it('the recorded web hashes are those of the files in this repo', () => {
    const stale: string[] = [];

    fixture.icons.forEach((icon) => {
      const refs = [icon.web.current, icon.web.target].filter(
        (ref): ref is NonNullable<typeof ref> => ref !== null && Boolean(ref.sha256)
      );

      refs.forEach((ref) => {
        const hash = webHash(ref.asset);

        if (hash !== null && hash !== ref.sha256) stale.push(`${icon.name}: ${ref.asset}`);
      });
    });
    expect(stale).toEqual([]);
  });

  it('the runtime probe runs the SVGO config SVGR uses (vite.config.ts)', () => {
    const viteConfig = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');

    expect(SVGR_SVGO_CONFIG_MARKERS.filter((marker) => !viteConfig.includes(marker))).toEqual([]);
  });
});

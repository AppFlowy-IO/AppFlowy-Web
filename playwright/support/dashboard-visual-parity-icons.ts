/**
 * Runtime icon identity for the web visual parity probe (VISUAL-PARITY.md
 * §4.4, L2): SVGR inlines every SVG after SVGO, so the DOM never holds the
 * asset bytes. The probe runs SVGR's SVGO config on each asset, hashes the
 * result with svg-norm/1 and compares it with svg-norm/1 of the rendered
 * `<svg>`'s outerHTML.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { createRequire } from 'module';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

import {
  IconEntry,
  IconsFixture,
  SVGR_SVGO_CONFIG,
  svgNormHash,
} from '../../src/application/database-yjs/visual-parity';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ICON_ROOT = join(REPO_ROOT, 'src/assets/icons');

type Optimize = (input: string, config: Record<string, unknown>) => { data: string };

let optimizeFn: Optimize | null = null;

/** SVGO as SVGR resolves it (`@svgr/plugin-svgo` → `svgo`), so the probe runs the same version. */
function optimize(): Optimize {
  if (optimizeFn) return optimizeFn;
  const fromSvgr = createRequire(createRequire(import.meta.url).resolve('@svgr/plugin-svgo'));

  optimizeFn = (fromSvgr('svgo') as { optimize: Optimize }).optimize;
  return optimizeFn;
}

/** svg-norm/1 of what SVGR would inline for an asset (repo-relative path), or `null` when the file is missing. */
export function runtimeAssetHash(asset: string): string | null {
  const path = join(REPO_ROOT, asset);

  try {
    const source = readFileSync(path, 'utf8');
    const { data } = optimize()(source, { ...SVGR_SVGO_CONFIG, path });

    return svgNormHash(data);
  } catch {
    return null;
  }
}

/** svg-norm/1 of a rendered inline `<svg>` (outerHTML), or `null` when it does not parse. */
export function renderedGlyphHash(outerHtml: string): string | null {
  try {
    return svgNormHash(outerHtml);
  } catch {
    return null;
  }
}

function listSvgFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);

    if (statSync(path).isDirectory()) return listSvgFiles(path);
    return name.endsWith('.svg') ? [path] : [];
  });
}

export interface GlyphIdentity {
  hash: string | null;
  /** Repo-relative web assets that render this glyph. */
  assets: string[];
  /** `icons.json` icons whose web target renders this glyph. */
  icons: string[];
}

/** Hash index of every web icon asset, built once per worker. */
export class IconRuntimeIndex {
  private byHash = new Map<string, string[]>();
  private targetHash = new Map<string, string | null>();
  private built = false;

  constructor(private readonly fixture: IconsFixture) {}

  private build() {
    if (this.built) return;
    this.built = true;
    const assets = new Set<string>(listSvgFiles(ICON_ROOT).map((path) => relative(REPO_ROOT, path)));

    this.fixture.icons.forEach((icon) => {
      if (icon.web.current?.asset) assets.add(icon.web.current.asset);
      if (icon.web.target.asset) assets.add(icon.web.target.asset);
    });
    assets.forEach((asset) => {
      const hash = runtimeAssetHash(asset);

      if (!hash) return;
      this.byHash.set(hash, [...(this.byHash.get(hash) ?? []), asset]);
    });
    this.fixture.icons.forEach((icon) => {
      this.targetHash.set(icon.name, icon.web.target.exists === false ? null : runtimeAssetHash(icon.web.target.asset));
    });
  }

  /** The runtime hash the icon's web target renders to (`null` while the target asset does not exist). */
  expectedHash(icon: IconEntry): string | null {
    this.build();
    return this.targetHash.get(icon.name) ?? null;
  }

  identify(outerHtml: string): GlyphIdentity {
    this.build();
    const hash = renderedGlyphHash(outerHtml);

    if (!hash) return { hash: null, assets: [], icons: [] };
    const icons = this.fixture.icons.filter((icon) => this.targetHash.get(icon.name) === hash).map((icon) => icon.name);

    return { hash, assets: this.byHash.get(hash) ?? [], icons };
  }

  /** A short human label for a rendered glyph. */
  describe(identity: GlyphIdentity): string {
    if (identity.icons.length > 0) return identity.icons.join(' | ');
    if (identity.assets.length > 0) return identity.assets.join(' | ');
    return identity.hash ? `unknown glyph ${identity.hash.slice(0, 12)}` : 'unparseable glyph';
  }
}

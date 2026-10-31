/**
 * The SVGO config SVGR runs on every `import { ReactComponent } from '*.svg'`
 * (`vite.config.ts`, `svgr({ svgrOptions: { svgoConfig } })`). The runtime icon
 * probe runs it on an asset before svg-norm/1, because the DOM only ever holds
 * SVGO's output (VISUAL-PARITY.md §4.4).
 *
 * It is a copy: editing `vite.config.ts` restarts every running dev server, so
 * the config is not imported from there yet. `dashboard-icon-parity.test.ts`
 * fails when the two drift apart; S2 may move `vite.config.ts` onto this
 * module in its first commit.
 */
export const SVGR_SVGO_CONFIG = {
  multipass: true,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          removeViewBox: false,
        },
      },
    },
    {
      name: 'prefixIds',
      params: {
        prefix: (_node: unknown, { path }: { path?: string }) => {
          const fileName = path?.split('/')?.pop()?.split('.')?.[0];

          return `${fileName}-`;
        },
      },
    },
  ],
};

/** The snippets of `vite.config.ts` this copy mirrors (checked by the icon parity test). */
export const SVGR_SVGO_CONFIG_MARKERS = [
  'multipass: true',
  "name: 'preset-default'",
  'removeViewBox: false',
  "name: 'prefixIds'",
  "const fileName = path?.split('/')?.pop()?.split('.')?.[0];",
  'return `${fileName}-`;',
  "plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx']",
];

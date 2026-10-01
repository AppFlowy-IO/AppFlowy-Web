# dashboard-parity

Golden inputs that the web client (`AppFlowy-Web`) and the desktop client (`AppFlowy-Premium`, Rust and Flutter) both test against. The web copy lives in `src/application/database-yjs/__fixtures__/dashboard-parity/`, the desktop copy in `frontend/resources/dashboard-parity/`. The two copies must be byte-identical.

## Files

Each file has one owning package. A later package adds its own line here.

| File | Owner | Contents |
| --- | --- | --- |
| `tokens.json` | WP01 | Dashboard and chart design tokens: colors with their resolved values per theme, shadows, chart palettes and chart geometry, layout limits, geometry, typography, motion. It also holds the known token leaves of WP09, WP10 and WP13, so no later package edits it. |
| `layouts/unknown-keys.json` | WP01 | Dashboard and chart layout maps written by a newer client, with unknown keys and unknown enum strings that every write must keep. |
| `mode-transitions.json` | WP14a | R-MODE: steps of the local Edit preference (`auto`, `auto_on`, `on`, `off`) through load, remote rows, local writes, pin, Edit/Done, access flickers and mobile context. |
| `layouts/chart-style-keys.json` | WP10 | The chart style keys `decimal_places`, `color_theme`, `show_data_labels` and `legend_position`: how they read, that each is written alone, that Auto writes `null`, and that unknown values are never rewritten. |
| `layouts/show-icons-in-heading.json` | WP03 | The dashboard `show_icons_in_heading` flag: how it reads (absent or wrong type is `false`) and a toggle that keeps every other key. |
| `layouts/remap.json` | WP05 | `remapDashboardLayout` for a database copy and a dashboard duplicate (widgets, global filter targets, unknown keys, malformed values, no-op identity) and `remapDashboardOwner` vectors. |
| `layouts/converted-seed.json` | WP05 | The rows a view converted to Dashboard starts with (its owned copy as one full-width widget, ids masked) and when the seed is written. |
| `visual-metrics.json` | VP | The visual parity contract: every measurable dashboard element by its stable `dash-*` parity id, with its box, typography, colour and spacing metrics per state (View/Edit × light/dark) as `tokens.json` references, `ref:` colour variables, `calc` expressions or literals, plus scenes (with the Notion reference captures the comparator shows beside each state, scene and interaction), interactions, element order checks, text checks, the wave that makes each entry match and its status. Design: `parity-plan/VISUAL-PARITY.md`. |
| `icons.json` | VP | Every dashboard chrome icon: its contexts (parity id and rendered size), the web asset and desktop `FlowySvgs` symbol in use today and the target each client must render, the svg-norm/1 hash of each and of the canonical glyph, and the normalization vectors both probes must reproduce. |
| `FIXTURES.sha256` | generated | The manifest below. Never edit it by hand. |

## Byte rules

- UTF-8 without a BOM, LF line endings, exactly one trailing newline, 2-space JSON indentation.
- Both repos mark this folder `text eol=lf` in `.gitattributes`. Nothing formats these files automatically.

## Manifest

`FIXTURES.sha256` lists the SHA-256 of every file in this folder except itself, sorted by path in byte order. The web Jest test and the desktop `cargo test` recompute it, compare it line by line, and print the full expected manifest on failure. Regenerate it from inside this folder (macOS and Linux):

```sh
{ echo '# dashboard-parity v1: sha256 of every file here except this one, LC_ALL=C path order. Regenerate: see README.md'; \
  find . -type f ! -name FIXTURES.sha256 | sed 's|^\./||' | LC_ALL=C sort | xargs shasum -a 256; } > FIXTURES.sha256
```

## Layout case format (`layouts/*.json`)

- `stored`: the layout-settings map as another (newer) client left it. `{"$bigint": "N"}` is an integer written by a native client (yrs `Any::BigInt`, JS `bigint`). A plain JSON number is a JS number (`Any::Number`). Readers accept both, and every comparison is by numeric value.
- `parsed` (optional): the typed projection every client must read from `stored`, in the persisted snake_case shape.
- `write`: the typed value the client submits for the named top-level keys, in the persisted shape.
- `writtenKeys`: exactly the top-level keys the write may touch.
- `expected`: the map after the write. Key order does not matter. The legacy camelCase chart keys listed in `ignoreOnCompare` are ignored (the web client mirrors them, desktop does not).

## Changing a file

Never edit a value on one side only. Change the web copy, regenerate the manifest, copy the folder to desktop with `rsync -a --delete <web>/src/application/database-yjs/__fixtures__/dashboard-parity/ <premium>/frontend/resources/dashboard-parity/`, and land both PRs together. Both PR descriptions paste the same `FIXTURES.sha256`.

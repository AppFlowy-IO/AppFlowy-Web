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
| `visual-metrics.json` | VP | The visual parity contract: every measurable dashboard element by its stable `dash-*` parity id, with its box, typography, colour and spacing metrics per state (View/Edit × light/dark) as `tokens.json` references, `ref:` colour variables, `calc` expressions or literals, plus scenes (with the Notion reference captures the comparator shows beside each state, scene and interaction), interactions, element order checks, text checks, the wave that makes each entry match and its status (`pending`, `enforced` once its wave has closed, or `waived` with a reason; `clientWaivers` waives one client's measurement or only the web ↔ desktop comparison). Design: `parity-plan/VISUAL-PARITY.md`. |
| `icons.json` | VP | Every dashboard chrome icon: its contexts (parity id and rendered size), the web asset and desktop `FlowySvgs` symbol in use today and the target each client must render, the svg-norm/1 hash of each and of the canonical glyph, the status of the icon and of each context, and the normalization vectors both probes must reproduce. |
| `view-names.json` | WP05 | `nextViewName` (the first free `"<base> (n)"` for a new or duplicated widget view, trimmed, case-sensitive) and `duplicateBaseName` (one trailing `" (n)"` removed) vectors. |
| `tab-visibility.json` | WP05 | `readDashboardOwner` precedence (folder extra over the collab mirror, empty strings ignored) and `filterOwnedTabViewIds` cases: owned views hidden from folder-derived tab lists, an opened owned view as the only tab. |
| `tab-reveal.json` | WP05 | `tabRevealScrollOffset` vectors: the tab strip offset that reveals the active tab (visible, cut off at either end, wider than the viewport, clamped at 0 and at the maximum). |
| `wrap-and-split.json` | WP02, WP04 | Grid geometry (WP02): the wrap rule (4 → 2×2, 3 → 2 + 1, 2 → 1), the resize minimum in columns, pixel-to-column rounding, the width-delta clamp, the 20px height snap and whole-row layouts with box rects and handle boundaries. Arrangement (WP04): the equal-split vectors of add, remove, move, duplicate and height changes (`split`) and the row moves (`row_moves`); WP04 adds `row_controls`, `drop` and `menu`. |
| `widget-tools.json` | WP03 | The widget header tool sets per layout, mode, role and capability set (`dashboardWidgetTools`), the WP03 and WP09 capabilities, and the tool visibility rule (`widgetToolVisible`). WP07, WP09 and WP14b add their rows. |
| `widget-content.json` | WP03 (A5) | Content geometry inside a widget card: the start inset of an editable grid widget and of every other widget, the end and top insets, the compact row handle and the one-line grid row height and divider. T4 adds `labels` (A6). |
| `format-vectors.json` | WP10 | R-FORMAT: `formatChartValue(value, ctx)` vectors for every mode (axis, label, tooltip, center, card), aggregation kind, currency, percent, locale, decimal places, half-away-from-zero rounding and date aggregations, plus the compact-path currency affixes. |
| `chart-geometry.json` | WP10 | Chart scales and layout with a fake text measurer: nice ticks, value domains, axis widths, bar widths, category label fitting and thinning, truncation, donut geometry and outside labels, legend pagination, category and series colors per `color_theme`, and `resolveLegend`. |
| `bdd/chart-fixtures.json` | WP10 | The Deals and Archive databases (properties, option colors, number and date formats, rows, chart views) the shared `dashboard-chart-render` feature seeds on both clients. |
| `private-state.json` | WP07 | Private widget and global-filter state: the device-local storage key, canonical filter equality (ids, order and select-content order ignored; numeric-string enums) and sort equality (order significant), global value equality with `option_names`, the payload decode and encode rules (`{condition, content, option_names?}` global values, per-widget `filters`/`sorts` parts), and restore sanitizing for global values and widget parts. |
| `aggregations.json` | WP11 | Chart aggregations: per-Y-type cell sets and the value of every `aggregation_type` 0–16 valid for the type (plus legacy combinations, empty groups and all-empty cells), `effectiveChartAggregation`, `defaultAggregationFor`, the Calculate menu sections per chart type and `supportsCumulative`. Rust reads the numeric cases. |
| `layouts/chart-config.json` | WP11 | The chart data configuration keys (`x_sort`, `x_manual_order`, `hidden_groups`, the three bucket keys, `x_text_grouping`, `show_title`, `number_color`, `number_conditional_color`, `aggregation_type` 7–16): how they read, which keys each write touches, unknown keys kept through a conditional color edit, bucket clears written as `null`, and a legacy Min over a date read as Earliest without a rewrite. |
| `relative-dates.json` | WP08 | Parameterized relative date filters (conditions 28 and 29): the reader defaults of the `relative_direction`/`relative_amount`/`relative_unit` content, the inclusive local-date range of each spec on a given day (ISO weeks, calendar months and years with month-end clamping), and which cells match, including the end-date fallback of 29. |
| `layouts/global-filters.json` | WP08 | Dashboard global filters with `option_names` (read only as an array of strings, written only for select filters and only when non-empty), a relative date filter (condition 28), a stale target and filter-level unknown keys, and filters of a type not every client knows (`ty` 99), which every write keeps in their place. |
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

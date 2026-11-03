/**
 * Tailwind color names for the dashboard and chart tokens of
 * `src/styles/dashboard-tokens.css` (`bg-dash-edit-tint`, `text-chart-tick`, ...).
 * Each maps to its CSS variable, so light and dark follow the theme.
 * `dashboard-tokens.test.ts` checks every entry against `dashboard-parity/tokens.json`.
 */
module.exports = {
  dash: {
    'accent': 'var(--dash-accent)',
    'edit-title': 'var(--dash-edit-title)',
    'edit-icon': 'var(--dash-edit-icon)',
    'edit-tint': 'var(--dash-edit-tint)',
    'edit-ring': 'var(--dash-edit-ring)',
    'row-control-bg': 'var(--dash-row-control-bg)',
    'card-bg': 'var(--dash-card-bg)',
    'card-ring': 'var(--dash-card-ring)',
    'title': 'var(--dash-title)',
    'tool-icon': 'var(--dash-tool-icon)',
    'hover-fill': 'var(--dash-hover-fill)',
    'unsaved-dot': 'var(--dash-unsaved-dot)',
    'save-bg': 'var(--dash-save-bg)',
    'save-fg': 'var(--dash-save-fg)',
    'pill-bg-active': 'var(--dash-pill-bg-active)',
    'pill-fg-active': 'var(--dash-pill-fg-active)',
    'pill-bg': 'var(--dash-pill-bg)',
    'pill-fg': 'var(--dash-pill-fg)',
    'toast-bg': 'var(--dash-toast-bg)',
  },
  chart: {
    'grid': 'var(--chart-grid)',
    'tick': 'var(--chart-tick)',
    'data-label': 'var(--chart-data-label)',
    'outside-label': 'var(--chart-outside-label)',
    'hover-band': 'var(--chart-hover-band)',
    'empty': 'var(--chart-empty)',
    'tooltip-bg': 'var(--chart-tooltip-bg)',
    'tooltip-border': 'var(--chart-tooltip-border)',
    'number-default': 'var(--chart-number-default)',
  },
};

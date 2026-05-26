const newColors = require('./new-colors.cjs');

module.exports = {
  // Existing AppFlowy colors
  'bg': {
    'selection': 'var(--bg-selection)',
    'body': 'var(--bg-body)',
    'base': 'var(--bg-base)',
    'mask': 'var(--bg-mask)',
    'tips': 'var(--bg-tips)',
    'brand': 'var(--bg-brand)',
    'header': 'var(--bg-header)',
    'footer': 'var(--bg-footer)',
  },
  'line': {
    'border': 'var(--line-border)',
    'divider': 'var(--line-divider)',
    'default': 'var(--line-default)',
    'on-toolbar': 'var(--line-on-toolbar)',
    'card': 'var(--line-card)',
  },
  'content': {
    'blue-400': 'var(--content-blue-400)',
    'blue-300': 'var(--content-blue-300)',
    'blue-600': 'var(--content-blue-600)',
    'blue-700': 'var(--content-blue-700)',
    'blue-800': 'var(--content-blue-800)',
    'blue-900': 'var(--content-blue-900)',
    'blue-100': 'var(--content-blue-100)',
    'blue-200': 'var(--content-blue-200)',
    'blue-50': 'var(--content-blue-50)',
    'on-fill-hover': 'var(--content-on-fill-hover)',
    'on-fill': 'var(--content-on-fill)',
    'on-tag': 'var(--content-on-tag)',
  },
  'function': {
    'error': 'var(--function-error)',
    'error-hover': 'var(--function-error-hover)',
    'warning': 'var(--function-warning)',
    'warning-hover': 'var(--function-warning-hover)',
    'success': 'var(--function-success)',
    'success-hover': 'var(--function-success-hover)',
    'info': 'var(--function-info)',
  },
  'tint': {
    'purple': 'var(--tint-purple)',
    'pink': 'var(--tint-pink)',
    'red': 'var(--tint-red)',
    'lime': 'var(--tint-lime)',
    'green': 'var(--tint-green)',
    'aqua': 'var(--tint-aqua)',
    'blue': 'var(--tint-blue)',
    'orange': 'var(--tint-orange)',
    'yellow': 'var(--tint-yellow)',
  },

  'scrollbar': {
    'thumb': 'var(--scrollbar-thumb)',
    'track': 'var(--scrollbar-track)',
  },
  'note': {
    'header': 'var(--note-header)',
  },
  'billing': {
    'primary': 'var(--billing-primary)',
    'primary-hover': 'var(--billing-primary-hover)',
  },
  'ai': {
    'primary': 'var(--ai-primary)',
  },
  'writer': {
    'placeholder': 'var(--writer-placeholder)',
  },
  ...newColors,
  'fill': {
    'toolbar': 'var(--fill-toolbar)',
    'default': 'var(--fill-default)',
    'hover': 'var(--fill-hover)',
    'pressed': 'var(--fill-pressed)',
    'active': 'var(--fill-active)',
    'list-hover': 'var(--fill-list-hover)',
    'list-active': 'var(--fill-list-active)',
    ...newColors['fill'],
  },
  'text': {
    'title': 'var(--text-title)',
    'caption': 'var(--text-caption)',
    'placeholder': 'var(--text-placeholder)',
    'disabled': 'var(--text-disabled)',
    'link-default': 'var(--text-link-default)',
    'link-hover': 'var(--text-link-hover)',
    'link-pressed': 'var(--text-link-pressed)',
    'link-disabled': 'var(--text-link-disabled)',
    ...newColors['text'],
  },
  'icon': {
    DEFAULT: 'hsl(var(--icon))',
    'primary': 'var(--icon-primary)',
    'secondary': 'var(--icon-secondary)',
    'disabled': 'var(--icon-disabled)',
    'on-toolbar': 'var(--icon-on-toolbar)',
    ...newColors['icon'],
  },
  'border': {
    DEFAULT: 'hsl(var(--border))',
    ...newColors['border'],
  },
  'badge': {
    'purple': 'var(--badge-purple)',
    'pink': 'var(--badge-pink)',
    'red': 'var(--badge-red)',
    'lime': 'var(--badge-lime)',
    'green': 'var(--badge-green)',
    'aqua': 'var(--badge-aqua)',
    'blue': 'var(--badge-blue)',
    'orange': 'var(--badge-orange)',
    'yellow': 'var(--badge-yellow)',
    ...newColors['badge'],
  },
  background: {
    DEFAULT: 'hsl(var(--background))',
    ...newColors['background'],
  },
  foreground: 'hsl(var(--foreground))',
  card: {
    DEFAULT: 'hsl(var(--card))',
    foreground: 'hsl(var(--card-foreground))',
  },
  popover: {
    DEFAULT: 'hsl(var(--popover))',
    foreground: 'hsl(var(--popover-foreground))',
  },
  primary: {
    DEFAULT: 'hsl(var(--primary))',
    foreground: 'hsl(var(--primary-foreground))',
  },
  secondary: {
    DEFAULT: 'hsl(var(--secondary))',
    foreground: 'hsl(var(--secondary-foreground))',
    background: 'var(--secondary-background)',
  },
  muted: {
    DEFAULT: 'hsl(var(--muted))',
    foreground: 'hsl(var(--muted-foreground))',
  },
  accent: {
    DEFAULT: 'hsl(var(--accent))',
    foreground: 'hsl(var(--accent-foreground))',
  },
  destructive: {
    DEFAULT: 'hsl(var(--destructive))',
    foreground: 'hsl(var(--destructive-foreground))',
  },
  button: {
    disabled: 'hsl(var(--button-disabled))',
  },
  placeholder: {
    DEFAULT: 'hsl(var(--placeholder))',
  },
  success: {
    DEFAULT: 'hsl(var(--success))',
  },
  input: {
    DEFAULT: 'hsl(var(--input))',
    background: 'var(--input-background)',
  },
  ring: 'hsl(var(--ring))',
  tooltip: {
    DEFAULT: 'hsl(var(--tooltip))',
    foreground: 'hsl(var(--tooltip-foreground))',
  },
};

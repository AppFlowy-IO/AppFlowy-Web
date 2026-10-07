const tailwindcss = require('tailwindcss');
const autoprefixer = require('autoprefixer');

const scopeScrollbarHover = require('./postcss/scope-scrollbar-hover.cjs');
const unwrapSiblingIs = require('./postcss/unwrap-sibling-is.cjs');

module.exports = {
  plugins: [
    tailwindcss(),
    // After tailwindcss: un-nests the `#body :is(... ~ ...)` rules that the
    // `important: '#body'` option emits (see the plugin's header).
    unwrapSiblingIs(),
    // Scopes `X:hover *::-webkit-scrollbar-thumb` rules of dependency CSS to
    // scroll containers (see the plugin's header).
    scopeScrollbarHover(),
    autoprefixer(),
  ],
};

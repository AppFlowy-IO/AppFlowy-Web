// The PostCSS plugins and their tests are outside the app's tsconfig
// (tsconfig.json includes src/): type-aware rules read this folder's own.
module.exports = {
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  overrides: [
    {
      // PostCSS loads these as CommonJS modules.
      files: ['*.cjs'],
      rules: { '@typescript-eslint/no-var-requires': 'off' },
    },
  ],
};

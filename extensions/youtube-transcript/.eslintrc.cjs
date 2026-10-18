// This independently packaged, dependency-free extension is JavaScript, outside tsconfig.web.json.
module.exports = {
  root: true,
  env: { browser: true, node: true, es2022: true, webextensions: true },
  extends: ['eslint:recommended'],
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  rules: { 'no-constant-condition': ['error', { checkLoops: false }] },
};

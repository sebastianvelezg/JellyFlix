import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

const browserOnlyGlobals = ['window', 'document', 'localStorage', 'sessionStorage', 'location', 'navigator', 'history']

export default tseslint.config(
  { ignores: ['dist', 'public', 'node_modules', 'test-media', 'coverage', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['scripts/sw.template.js'],
    languageOptions: { sourceType: 'script', globals: globals.serviceworker },
  },
  {
    files: ['public/config.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },

  // Architecture boundary 1: src/core is platform-independent (no React, no DOM, no UI/platform imports).
  // Type-level DOM use is caught separately by tsconfig.core.json.
  {
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...browserOnlyGlobals.map((name) => ({ name, message: 'src/core must not use browser globals; put it in src/platform/web.' })),
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSTypeReference[typeName.name=/^(HTML[A-Za-z]*Element|MediaSource|MediaError|TextTrack|Document|Window|Storage)$/]',
          message: 'src/core must not reference DOM types; put it in src/platform/web.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-dom', 'react-dom/*', 'react/*'], message: 'src/core must not depend on React.' },
            { group: ['**/components/**', '**/platform/**', '**/App'], message: 'src/core must not import UI or platform code.' },
          ],
        },
      ],
    },
  },

  // Architecture boundary 2: UI and platform code use core only through its public index.
  {
    files: ['src/components/**/*.{ts,tsx}', 'src/platform/**/*.ts', 'src/App.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/core/*'], message: "Import from the core index ('../core'), not its internal files." }] },
      ],
    },
  },
)

import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // renderer was authored under apps/desktop's eslintrc, which ignores both
      // unused args and unused vars prefixed with `_` (positional/rest-exclusion
      // destructuring, intentional placeholders). Mirror it so those stay valid.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // This package was relocated from apps/desktop's src/renderer and carries
      // pre-existing `any` usages. Downgraded to warn (legacy carve-out) so the gate
      // blocks new hard errors without forcing a large `any`-rewrite refactor here.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
)

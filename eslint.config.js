import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'tests/fixture/.next/**',
      'tests/fixture/node_modules/**',
      'tests/fixture/playwright-report/**',
      'tests/fixture/test-results/**',
      'tests/fixture/tests/visual/__screenshots__/**',
      '.visual-regression/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);

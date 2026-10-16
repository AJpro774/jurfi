import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
export default tseslint.config(
  { ignores: ['**/dist/**','**/pkg/**','**/node_modules/**','**/target/**','apps/docs/public/api/**','**/.turbo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { '@typescript-eslint/consistent-type-imports': 'error' } },
);

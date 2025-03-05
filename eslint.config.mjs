// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import html from 'eslint-plugin-html';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({});

export default tseslint.config(
  {
    files: ['**/*.{js,mjs,ts}'],
    ignores: [
      'packages/*/docs/',
      'packages/*/lib/',
      'packages/*/node_modules/',
      'packages/*/types/',

      'packages/*/examples/**/*.{js,html}',

      '**/jest.config.js',
    ],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
    ],
    rules: {
      curly: ['error', 'multi-line'],

      ['no-console']: ['error', {
        allow: ['info', 'warn', 'error'],
      }],

      ['@typescript-eslint/naming-convention']: ['error', {
        selector: 'default',
        format: ['camelCase'],
      }, {
        selector: 'variable',
        format: ['camelCase', 'UPPER_CASE'],
        leadingUnderscore: 'allow',
      }, {
        selector: 'typeLike',
        format: ['PascalCase'],
      }, {
        selector: 'memberLike',
        modifiers: ['public'],
        format: ['camelCase', 'UPPER_CASE'],
        leadingUnderscore: 'forbid',
      }, {
        selector: 'memberLike',
        modifiers: ['protected'],
        format: ['camelCase', 'UPPER_CASE'],
        leadingUnderscore: 'require',
      }, {
        selector: 'memberLike',
        modifiers: ['private'],
        format: ['camelCase', 'UPPER_CASE'],
        leadingUnderscore: 'require',
      }, {
        selector: 'enumMember',
        format: ['PascalCase'],
      }, {
        selector: 'import',
        format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
      }],

      ['@typescript-eslint/no-unused-vars']: ['warn', {
        args: 'none',
      }],

      ['@typescript-eslint/no-explicit-any']: 'off',
      ['@typescript-eslint/no-non-null-assertion']: ['off'],
    },
  },

  {
    files: ['packages/*/examples/**/*.{js,html}'],
    extends: [
      eslint.configs.recommended,
      ...compat.extends('mdcs'),
    ],
    plugins: {
      html,
    },
    rules: {
      ['padded-blocks']: 'off',
      ['no-unused-vars']: 'off',
    },
  },
);

// Raw colors (hex, rgb(), hsl(), ...) are banned everywhere except inside a tokens/ directory.
const rawColor = { 'color-no-hex': true, 'function-disallowed-list': ['rgb','rgba','hsl','hsla','hwb','lab','lch','oklab','oklch','color'] };
export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['**/dist/**','**/node_modules/**','**/pkg/**','apps/docs/public/api/**'],
  rules: {
    ...rawColor,
    'custom-property-pattern': null,
    'selector-class-pattern': null,
    'custom-media-pattern': null,
    'import-notation': null,
    'at-rule-no-unknown': [true, { ignoreAtRules: ['custom-media'] }],
  },
  overrides: [{ files: ['**/tokens/**/*.css'], rules: { 'color-no-hex': null, 'function-disallowed-list': null } }],
};

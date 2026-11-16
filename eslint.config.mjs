// Pragmatische lintconfiguratie: alleen echte fouten blokkeren CI; stijl regelt Prettier.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.expo/**",
      "apps/mobile/android/**",
      "apps/mobile/ios/**",
      "playwright-report/**",
      "test-results/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      // Bestaande code gebruikt bewust `any`, lege catch-blokken en require().
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off",
      "no-cond-assign": "off",
      "no-async-promise-executor": "off",
      "prefer-const": "off",
    },
  },
);

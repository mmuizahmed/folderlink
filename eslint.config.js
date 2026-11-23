import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "**/coverage/**",
      "apps/bridge/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        TextEncoder: "readonly",
        URL: "readonly",
        WebSocket: "readonly",
      },
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);

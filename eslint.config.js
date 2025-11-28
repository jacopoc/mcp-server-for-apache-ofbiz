import prettier from "eslint-config-prettier";
import eslintPluginPrettier from "eslint-plugin-prettier";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";

export default [
  {
    files: ["**/*.ts"],
    ignores: ["build/**", "node_modules/**"],

    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        sourceType: "module",
        ecmaVersion: "latest"
      }
    },

    plugins: {
      "@typescript-eslint": tseslint,
      import: importPlugin,
      prettier: eslintPluginPrettier
    },

    rules: {
      // ---- TypeScript ----
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" }
      ],

      // ---- Import Rules ----
      "import/no-unresolved": "error",
      "import/order": [
        "warn",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          "newlines-between": "always"
        }
      ],

      // ---- Prettier ----
      // This turns Prettier formatting differences into ESLint errors
      "prettier/prettier": "error",

      // ---- Disable rules overridden by Prettier ----
      ...prettier.rules
    }
  }
];

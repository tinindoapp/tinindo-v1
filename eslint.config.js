import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "coverage",
      "playwright-report",
      "test-results",
      "node_modules",
      "brand",
      "supabase/.temp",
      "scripts/**/*.py",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/sb_secret_|service_role/]",
          message: "Chave secreta/service role não pode aparecer no código do app.",
        },
      ],
    },
  },
  {
    // Deno (Edge Functions) e Node (configs/testes).
    files: ["supabase/functions/**/*.ts", "*.config.ts", "tests/**/*.ts"],
    languageOptions: { globals: { ...globals.node, Deno: "readonly" } },
  },
  {
    // Módulos não importam outros módulos: comunicação via contratos e API.
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["../*/*", "!../../*", "**/features/**"], message: "Módulo não importa outro módulo; use @contracts." },
          ],
        },
      ],
    },
  },
);

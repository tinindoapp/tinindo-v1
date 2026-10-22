/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { BaseSequencer, type TestSpecification } from "vitest/node";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Integração: arquivos em ordem alfabética (00 segurança → 1x UATs → 20 fase 2), sempre a mesma, num banco só. */
class AlphabeticalSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@contracts": r("./supabase/functions/_shared/contracts"),
      "@brand": r("./brand"),
    },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { sourcemap: true },
  test: {
    // Ordem alfabética dos arquivos em todos os projetos: a integração depende dela (banco compartilhado).
    sequence: { sequencer: AlphabeticalSequencer },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}", "supabase/functions/**/*.test.ts"],
          setupFiles: ["./src/test/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "contracts",
          environment: "node",
          include: ["tests/contracts/**/*.test.ts"],
        },
      },
      // Handler ↔ banco real: só existe quando scripts/db-integration.sh preparou o Postgres (TINIDO_INTEGRATION=1),
      // para `vitest run` sem banco continuar verde.
      ...(process.env.TINIDO_INTEGRATION
        ? [{
          extends: true as const,
          test: {
            name: "integration",
            environment: "node" as const,
            include: ["tests/integration/**/*.test.ts"],
            fileParallelism: false,
            testTimeout: 30_000,
            hookTimeout: 60_000,
          },
        }]
        : []),
    ],
  },
});

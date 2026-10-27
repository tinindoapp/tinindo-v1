/// <reference types="vitest/config" />
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { BaseSequencer, type TestSpecification } from "vitest/node";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Versão exibida: commit e branch do build. No Workers Builds da Cloudflare vêm de WORKERS_CI_COMMIT_SHA/WORKERS_CI_BRANCH;
 * localmente, do git. Sai no banner da demonstração e em /version.json, para saber qual versão cada endereço serve.
 */
function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
  } catch {
    return null;
  }
}
const BUILD = {
  commit: process.env.WORKERS_CI_COMMIT_SHA || git("rev-parse HEAD") || "desconhecido",
  branch: process.env.WORKERS_CI_BRANCH || git("rev-parse --abbrev-ref HEAD") || "desconhecida",
  built_at: new Date().toISOString(),
};
function versionFile(): Plugin {
  return {
    name: "tinindo-version",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: `${JSON.stringify(BUILD, null, 2)}\n` });
    },
  };
}

/**
 * Configuração pública da prévia do link (worker/og.ts): a mesma URL do Supabase e a mesma chave pública que já vão no
 * bundle. Sem Supabase (demonstração), os campos ficam null e o Worker usa a prévia genérica.
 */
function ogConfigFile(mode: string): Plugin {
  return {
    name: "tinindo-og-config",
    apply: "build",
    generateBundle() {
      const env = loadEnv(mode, process.cwd(), "VITE_");
      const config = { supabase_url: env.VITE_SUPABASE_URL || null, publishable_key: env.VITE_SUPABASE_PUBLISHABLE_KEY || null };
      this.emitFile({ type: "asset", fileName: "og-config.json", source: `${JSON.stringify(config, null, 2)}\n` });
    },
  };
}

/** Integração: arquivos em ordem alfabética (00 segurança → 1x UATs → 20 fase 2), sempre a mesma, num banco só. */
class AlphabeticalSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), versionFile(), ogConfigFile(mode)],
  define: { __TININDO_BUILD__: JSON.stringify(BUILD) },
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
          include: ["src/**/*.test.{ts,tsx}", "worker/**/*.test.ts", "supabase/functions/**/*.test.ts"],
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
}));

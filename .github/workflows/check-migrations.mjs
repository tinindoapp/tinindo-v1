#!/usr/bin/env node
// Conferência da ordem das migrations e dos números de teste repetidos (revisão de 10/11, linha R; P56/P58).
// O defeito que isto trava: dois PRs em paralelo criam migrations com data anterior às que já estão na main, ou
// pgTAP com o mesmo número (aconteceu nos PRs #91 e #92, com os números 31 e 32). Cada PR passava sozinho.
//
// Uso (não é um workflow; fica aqui para morar junto do CI que o chama):
//   node .github/workflows/check-migrations.mjs                 confere só o que está na árvore
//   node .github/workflows/check-migrations.mjs --base <ref>    confere também contra a base (main ou commit anterior)
//   node .github/workflows/check-migrations.mjs --self-test     roda os casos de teste das regras
//
// Regras:
//  1. Migration: nome `AAAAMMDDHHMMSS_nome.sql`, carimbo único.
//  2. Com --base: migration que já existe na base não muda, não some e não troca de nome (append-only); migration
//     nova tem carimbo posterior a TODAS as da base.
//  3. pgTAP (`supabase/tests/database/NN_nome.test.sql`), concorrência (`tests/db-concurrency/NN_nome.sh`) e
//     integração (`tests/integration/NN_nome.test.ts`): número único dentro de cada pasta.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIGRATIONS = "supabase/migrations";
const NUMBERED = [
  { dir: "supabase/tests/database", pattern: /^(\d{2,3})_[a-z0-9_]+\.test\.sql$/, label: "pgTAP", strict: true },
  { dir: "tests/db-concurrency", pattern: /^(\d{2,3})_[a-z0-9_]+\.sh$/, label: "concorrência", strict: false },
  { dir: "tests/integration", pattern: /^(\d{2,3})_[a-z0-9_]+\.test\.ts$/, label: "integração", strict: false },
];
const MIGRATION_NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;

/** Regra 1: nomes e carimbos das migrations da árvore. */
export function checkMigrationNames(files) {
  const problems = [];
  const seen = new Map();
  for (const f of files) {
    const m = MIGRATION_NAME.exec(f);
    if (!m) {
      problems.push(`${MIGRATIONS}/${f}: nome fora do padrão AAAAMMDDHHMMSS_nome.sql`);
      continue;
    }
    if (seen.has(m[1])) problems.push(`${MIGRATIONS}/${f}: carimbo ${m[1]} repetido (também em ${seen.get(m[1])})`);
    else seen.set(m[1], f);
  }
  return problems;
}

/**
 * Regra 2. `baseFiles`: migrations na ponta da base. `changes`: saída de `git diff --name-status` entre o ponto de
 * partida do branch e o HEAD, como pares [estado, arquivo].
 */
export function checkAgainstBase(baseFiles, changes) {
  const problems = [];
  const stamps = baseFiles.map((f) => MIGRATION_NAME.exec(f)?.[1]).filter(Boolean).sort();
  const last = stamps.at(-1) ?? "";
  for (const [status, file] of changes) {
    if (status !== "A") {
      problems.push(`${MIGRATIONS}/${file}: migration já publicada foi ${status.startsWith("D") ? "removida" : status.startsWith("R") ? "renomeada" : "alterada"}. Migrations são append-only: crie uma nova.`);
      continue;
    }
    const stamp = MIGRATION_NAME.exec(file)?.[1];
    if (stamp && stamp <= last) {
      problems.push(`${MIGRATIONS}/${file}: carimbo ${stamp} não é posterior à última migration da base (${last}). Renomeie com a data e a hora do PR.`);
    }
  }
  return problems;
}

/** Regra 3: números repetidos numa pasta de testes numerados. */
export function checkNumbered(files, { dir, pattern, label, strict }) {
  const problems = [];
  const seen = new Map();
  for (const f of files) {
    const m = pattern.exec(f);
    if (!m) {
      if (strict) problems.push(`${dir}/${f}: nome fora do padrão NN_nome (${label})`);
      continue;
    }
    if (seen.has(m[1])) problems.push(`${dir}/${f}: número ${m[1]} repetido em ${label} (também em ${seen.get(m[1])}). Renumere para o próximo livre.`);
    else seen.set(m[1], f);
  }
  return problems;
}

function selfTest() {
  const eq = (name, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      console.error(`self-test FALHOU: ${name}\n  obtido:   ${JSON.stringify(got)}\n  esperado: ${JSON.stringify(want)}`);
      process.exit(1);
    }
  };
  const count = (name, got, want) => eq(name, got.length, want);
  count("nomes válidos", checkMigrationNames(["20261017120000_foundation.sql", "20261018120000_p01.sql"]), 0);
  count("nome fora do padrão", checkMigrationNames(["2026_fix.sql"]), 1);
  count("carimbo repetido", checkMigrationNames(["20261018120000_a.sql", "20261018120000_b.sql"]), 1);
  const base = ["20261103150000_p45.sql", "20261110100000_onda0.sql"];
  count("nova depois da última", checkAgainstBase(base, [["A", "20261120030000_p56.sql"]]), 0);
  // O caso da linha R: PR aberto em 29/10 com migration de 29/10, main já em 10/11.
  count("nova com data anterior à da main", checkAgainstBase(base, [["A", "20261029030000_antiga.sql"]]), 1);
  count("nova com o mesmo carimbo da última", checkAgainstBase(base, [["A", "20261110100000_outra.sql"]]), 1);
  count("migration publicada alterada", checkAgainstBase(base, [["M", "20261103150000_p45.sql"]]), 1);
  count("migration publicada removida", checkAgainstBase(base, [["D", "20261103150000_p45.sql"]]), 1);
  count("migration publicada renomeada", checkAgainstBase(base, [["R100", "20261103150000_p45.sql"]]), 1);
  count("base vazia aceita qualquer carimbo", checkAgainstBase([], [["A", "20261017120000_foundation.sql"]]), 0);
  const tap = NUMBERED[0];
  count("pgTAP sem repetição", checkNumbered(["31_setup.test.sql", "32_insights.test.sql"], tap), 0);
  // O outro caso da linha R: dois pacotes com o número 31.
  count("pgTAP repetido", checkNumbered(["31_setup.test.sql", "31_finance_advanced.test.sql"], tap), 1);
  count("pgTAP fora do padrão", checkNumbered(["setup.test.sql"], tap), 1);
  count("concorrência: lib.sh não é teste numerado", checkNumbered(["lib.sh", "01_identity.sh"], NUMBERED[1]), 0);
  count("integração repetida", checkNumbered(["50_a.test.ts", "50_b.test.ts", "harness.ts"], NUMBERED[2]), 1);
  console.log("check-migrations: self-test ok (15 casos)");
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();
  const baseAt = args.indexOf("--base");
  const base = baseAt >= 0 ? args[baseAt + 1] : null;
  const root = fileURLToPath(new URL("../../", import.meta.url));
  process.chdir(root);

  const problems = [...checkMigrationNames(readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort())];
  for (const spec of NUMBERED) problems.push(...checkNumbered(readdirSync(spec.dir).sort(), spec));

  // Base ausente ou zerada (primeiro push de um branch) não tem com o que comparar.
  if (base && !/^0+$/.test(base)) {
    let baseFiles;
    try {
      baseFiles = git("ls-tree", "--name-only", `${base}:${MIGRATIONS}`).split("\n").filter(Boolean);
    } catch (e) {
      console.error(`check-migrations: não achei a base "${base}" (faltou fetch do histórico?).\n${e.stderr ?? e.message}`);
      process.exit(2);
    }
    // Ponto de partida do branch: o que mudou DESDE a base, sem contar o que a base ganhou depois. No CI de PR o
    // checkout é o merge do PR na main, então a própria base é o ponto de partida.
    let from = base;
    try {
      from = git("merge-base", base, "HEAD");
    } catch {
      // histórico raso: compara direto com a base
    }
    const changes = git("diff", "--name-status", "--no-renames", from, "HEAD", "--", MIGRATIONS)
      .split("\n").filter(Boolean)
      .map((line) => {
        const [status, ...rest] = line.split("\t");
        return [status, rest.at(-1).slice(MIGRATIONS.length + 1)];
      });
    problems.push(...checkAgainstBase(baseFiles, changes));
  }

  if (problems.length) {
    console.error(`check-migrations: ${problems.length} problema(s)\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`check-migrations: ok${base ? ` (contra ${base})` : ""}`);
}

main();

import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// ---------------------------------------------------------------------------------------------------------------
// Camada comum (P52, doc 15 da revisão de 10/11/2026): dinheiro, chave de idempotência e relógio têm um dono só,
// em src/lib. As regras abaixo impedem que um módulo crie a sua cópia de novo.
const SECRET_KEY = {
  selector: "Literal[value=/sb_secret_|service_role/]",
  message: "Chave secreta/service role não pode aparecer no código do app.",
};

/** Novo leitor ou formatador de dinheiro fora de src/lib/money.ts (D13: a regra do Caixa vale no app inteiro). */
const NO_MONEY_COPY = [
  {
    selector: ":matches(FunctionDeclaration, VariableDeclarator)[id.name=/^(formatCents|centsToInput|parseBRL|parseMoney|parseCents|toCents|formatBRL)$/]",
    message: "Dinheiro tem um leitor e um formatador só: importe de src/lib/money.ts (formatCents, parseBRL, centsToInput).",
  },
  {
    selector: "NewExpression[callee.object.name='Intl'][callee.property.name='NumberFormat'] Property[key.name='style'][value.value='currency']",
    message: "Não monte formatador de moeda no módulo: use formatCents de src/lib/money.ts.",
  },
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='round'] > BinaryExpression[operator='*'][right.value=100]:has(CallExpression[callee.name=/^(Number|parseFloat)$/])",
    message: "Texto digitado × 100 lê \"10.50\" como R$ 1.050,00 e usa float (ADR-0004). Dinheiro: parseBRL de src/lib/money.ts.",
  },
];

/** Novo gerador de chave fora de src/lib/idempotency.ts. */
const NO_KEY_GENERATOR = [
  {
    selector: "CallExpression[callee.object.name='crypto'][callee.property.name='randomUUID']",
    message: "Chave de idempotência só nasce em src/lib/idempotency.ts: use useCommand, useIdempotencyKey ou newIdempotencyKey.",
  },
  {
    selector: ":matches(FunctionDeclaration, VariableDeclarator)[id.name=/^(newKey|newIdempotencyKey|createKeyRing|useKeyFor|useAttemptKey)$/]",
    message: "Não declare gerador de chave no módulo: use useCommand, useIdempotencyKey ou newIdempotencyKey de src/lib/idempotency.ts.",
  },
];

/** `new Date()` sem argumento e `Date.now()` em tela: o relógio é um só, e o dia depende do fuso do negócio. */
const NO_LOOSE_CLOCK = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: "Tela não lê o relógio direto: use now() ou today(fuso) de src/lib/time.ts (ou o instante que a porta entrega).",
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: "Tela não lê o relógio direto: use now() de src/lib/time.ts (ou o instante que a porta entrega).",
  },
];

const restricted = (...groups) => ["error", SECRET_KEY, ...groups.flat()];

// Arquivos que ainda têm a cópia antiga. Ficam fora da regra até a migração deles; a lista só pode diminuir.
// Parte 1 (P52) esvazia os módulos da área dela; o resto é da parte 2 (P53). Não acrescente arquivo aqui.
const LEGACY_MONEY = [
  // Parte 1 (sai nos PRs de troca por grupo de módulos)
  // Parte 2
  "src/features/identity/MyBookingsPage.tsx",
  "src/features/network/PublicProfileView.tsx",
  "src/features/scheduling/agenda.ts",
  "src/features/setup/labels.ts",
];
const LEGACY_KEY = [
  // Parte 1 (sai nos PRs de troca por grupo de módulos)
  // Parte 2
  "src/features/agent/port.ts",
  "src/features/discovery/port.ts",
  "src/features/network/api.ts",
  "src/features/network/useNetworkApi.ts",
  "src/features/payments/port.ts",
  "src/features/presence/port.ts",
  "src/features/reputation/port.ts",
  "src/features/scheduling/port.ts",
  "src/features/setup/port.ts",
];
const LEGACY_CLOCK = [
  // Parte 1 (sai nos PRs de troca por grupo de módulos)
  // Parte 2
  "src/features/analytics/module.tsx",
  "src/features/identity/services.tsx",
  "src/features/network/PublicProfileView.tsx",
  "src/features/scheduling/attendance.tsx",
];

// P53 (R4): um cliente de API por sessão (src/app/session.tsx). Módulo usa useApi/usePort de src/app/api.tsx e só
// importa o TIPO do cliente. Estes arquivos ainda criam o próprio cliente: são de áreas que não entraram no P53 (recado).
const LEGACY_CLIENT = [
  "src/features/agent/module.tsx",
  "src/features/crm/module.tsx",
  "src/features/finance/module.tsx",
  "src/features/lifecycle/module.tsx",
  "src/features/messaging/unread.ts",
  "src/features/sales/owner-slug.ts",
  "src/features/sales/public-kit.tsx",
  "src/features/scheduling/SchedulingLayout.tsx",
  // Kit público copiado: sai quando o kit único (src/components/public) substituir as cópias.
  "src/features/network/public-kit.tsx",
  "src/features/payments/public-kit.tsx",
  "src/features/reputation/public-kit.tsx",
];

const APP_CODE = ["src/features/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"];
const SCREENS = ["src/features/**/*.tsx", "src/app/**/*.tsx", "src/components/**/*.tsx"];
const TESTS = ["**/*.test.{ts,tsx}", "src/test/**"];
// A emulação da demonstração gera ids de registros e de pedidos, que não são chave de idempotência.
const DEMO = ["src/features/**/demoPort.ts", "src/features/**/fixturePort.ts", "src/features/**/demo*.ts", "src/features/**/demo-*.ts"];

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
      "no-restricted-syntax": restricted(),
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
  {
    // P53: módulo não cria cliente de API (um por sessão). Importar só o tipo continua permitido.
    files: ["src/features/**/*.{ts,tsx}"],
    ignores: [...TESTS, ...LEGACY_CLIENT],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/lib/api/client.ts"],
              importNames: ["createApiClient"],
              allowTypeImports: true,
              message: "Módulo não cria cliente de API: use useApi()/usePort() de src/app/api.tsx (um cliente por sessão).",
            },
          ],
        },
      ],
    },
  },
  // Camada comum: uma regra por combinação, porque `no-restricted-syntax` não soma entre blocos (o último vence).
  // Ordem: do mais geral para o mais específico.
  {
    files: APP_CODE,
    ignores: [...TESTS, ...DEMO],
    rules: { "no-restricted-syntax": restricted(NO_MONEY_COPY, NO_KEY_GENERATOR) },
  },
  {
    files: SCREENS,
    ignores: TESTS,
    rules: { "no-restricted-syntax": restricted(NO_MONEY_COPY, NO_KEY_GENERATOR, NO_LOOSE_CLOCK) },
  },
  // Dinheiro vale também dentro da emulação da demonstração (ela mostra valor na tela).
  {
    files: DEMO,
    rules: { "no-restricted-syntax": restricted(NO_MONEY_COPY) },
  },
  ...legacyOverrides(),
);

/**
 * Para cada arquivo legado, a regra sem os grupos de que ele está dispensado. Um arquivo pode estar em mais de
 * uma lista; por isso a regra é montada por arquivo.
 */
function legacyOverrides() {
  const files = [...new Set([...LEGACY_MONEY, ...LEGACY_KEY, ...LEGACY_CLOCK])];
  return files.map((file) => {
    const isScreen = file.endsWith(".tsx");
    const isDemo = /\/(demoPort|fixturePort|demo[^/]*)\.ts$/.test(file);
    const groups = [];
    if (!LEGACY_MONEY.includes(file)) groups.push(NO_MONEY_COPY);
    if (!isDemo && !LEGACY_KEY.includes(file)) groups.push(NO_KEY_GENERATOR);
    if (isScreen && !LEGACY_CLOCK.includes(file)) groups.push(NO_LOOSE_CLOCK);
    return { files: [file], rules: { "no-restricted-syntax": restricted(...groups) } };
  });
}

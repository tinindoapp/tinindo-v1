import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import ts from "typescript";

// Rotas para as varreduras de padrões (padroes.spec.ts) e de acessibilidade (a11y.spec.ts).
// A lista sai de dois lugares, sem digitar caminho: os links do menu (o que a pessoa vê) e a árvore de rotas de
// src/app/router.tsx, lida como texto (AST do TypeScript). Importar o roteador aqui não serve: ele puxa CSS e JSX das
// telas, que o Playwright não carrega. Forma de rota que o leitor não reconhece lança erro, em vez de sumir da varredura.

const ROUTER = fileURLToPath(new URL("../../../src/app/router.tsx", import.meta.url));

/** Página não encontrada: o curinga do roteador é varrido por um caminho que não existe. */
export const NOT_FOUND = "/nao-existe";

/**
 * Rotas com parâmetro, fora da varredura: precisam de um id, slug ou cidade que exista na demonstração e são cobertas
 * pelos specs dos módulos. `routerRoutes()` confere esta lista contra o roteador: rota nova com parâmetro tem de
 * entrar aqui (ou a varredura falha), e linha que sobrou tem de sair.
 */
export const PARAM_ROUTES: readonly string[] = [
  "/app/agenda/atendimento/:bookingId",
  "/app/agenda/atendimento/:bookingId/reagendar",
  "/app/clientes/:customerId",
  "/app/mensagens/:contactId",
  "/avaliacoes/:slug",
  "/diretorio/:uf/:cidade",
  "/diretorio/:uf/:cidade/:categoria",
  "/p/:slug",
  "/s/:slug",
];

type Source = { file: string; ast: ts.SourceFile };
const sources = new Map<string, Source>();

function load(file: string): Source {
  let src = sources.get(file);
  if (!src) {
    src = { file, ast: ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) };
    sources.set(file, src);
  }
  return src;
}

function fail(src: Source, node: ts.Node, what: string): never {
  const { line } = src.ast.getLineAndCharacterOfPosition(node.getStart());
  throw new Error(`rotas.ts não sabe ler ${what} em ${src.file}:${line + 1}: ${node.getText().slice(0, 80)}`);
}

/** Valor de uma constante pelo nome: declarada no arquivo ou importada (segue o import até a declaração). */
function resolveName(src: Source, name: string, at: ts.Node = src.ast): { src: Source; value: ts.Expression } {
  for (const st of src.ast.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) return { src, value: d.initializer };
      }
    }
    if (ts.isImportDeclaration(st) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
      for (const el of st.importClause.namedBindings.elements) {
        if (el.name.text !== name || !ts.isStringLiteral(st.moduleSpecifier)) continue;
        const target = load(resolve(dirname(src.file), st.moduleSpecifier.text));
        return resolveName(target, (el.propertyName ?? el.name).text);
      }
    }
  }
  return fail(src, at, `a constante ${name}`);
}

function unwrap(e: ts.Expression): ts.Expression {
  while (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

function arrayOf(src: Source, e: ts.Expression): { src: Source; items: readonly ts.Expression[] } {
  const v = unwrap(e);
  if (ts.isArrayLiteralExpression(v)) return { src, items: v.elements };
  if (ts.isIdentifier(v)) {
    const r = resolveName(src, v.text, v);
    return arrayOf(r.src, r.value);
  }
  return fail(src, e, "a lista de rotas");
}

function objectOf(src: Source, e: ts.Expression): { src: Source; obj: ts.ObjectLiteralExpression } {
  const v = unwrap(e);
  if (ts.isObjectLiteralExpression(v)) return { src, obj: v };
  if (ts.isIdentifier(v)) {
    const r = resolveName(src, v.text, v);
    return objectOf(r.src, r.value);
  }
  return fail(src, e, "a rota");
}

function prop(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name) return p.initializer;
  }
  return undefined;
}

const join = (base: string, path: string) => (path.startsWith("/") || path === "*" ? path : `${base.replace(/\/$/, "")}/${path}`);

function walk(src: Source, list: ts.Expression, base: string, out: Set<string>) {
  const arr = arrayOf(src, list);
  for (const item of arr.items) {
    if (ts.isSpreadElement(item)) {
      const inner = unwrap(item.expression);
      // ...MODULES.map((m) => ({ path: m.path, children: m.routes })): cada módulo vira uma rota com o próprio segmento.
      if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression) && inner.expression.name.text === "map") {
        const modules = arrayOf(arr.src, inner.expression.expression);
        for (const m of modules.items) {
          const mod = objectOf(modules.src, m);
          const path = prop(mod.obj, "path");
          const routes = prop(mod.obj, "routes");
          if (!path || !ts.isStringLiteralLike(path) || !routes) return fail(mod.src, mod.obj, "o módulo (path e routes)");
          walk(mod.src, routes, join(base, path.text), out);
        }
        continue;
      }
      walk(arr.src, inner, base, out);
      continue;
    }
    const { src: at, obj } = objectOf(arr.src, item);
    const path = prop(obj, "path");
    if (path && !ts.isStringLiteralLike(path)) return fail(at, path, "o caminho (precisa ser texto literal)");
    const full = path ? join(base, path.text) : base;
    const children = prop(obj, "children");
    if (children) {
      walk(at, children, full, out);
      continue;
    }
    // Redirecionamento (<Navigate>) não é tela.
    const element = prop(obj, "element");
    if (element && /^<Navigate\b/.test(element.getText())) continue;
    if (path || prop(obj, "index")) out.add(full);
    else return fail(at, obj, "a rota (sem path, index nem children)");
  }
}

/** Todos os caminhos de tela do roteador, com os parâmetros como estão declarados (ex.: "/p/:slug") e o curinga "*". */
export function routerPatterns(): string[] {
  const src = load(ROUTER);
  const routes = resolveName(src, "routes");
  const out = new Set<string>();
  walk(routes.src, routes.value, "", out);
  return [...out].sort();
}

/** Rotas do roteador que abrem sem parâmetro. O curinga entra como NOT_FOUND. */
export function routerRoutes(): string[] {
  const patterns = routerPatterns();
  const withParam = patterns.filter((p) => p.includes(":"));
  const listed = [...PARAM_ROUTES].sort();
  if (JSON.stringify(withParam) !== JSON.stringify(listed)) {
    throw new Error(
      `PARAM_ROUTES (tests/e2e/foundation/rotas.ts) não bate com o roteador.\n  roteador: ${withParam.join(", ")}\n  lista: ${listed.join(", ")}`,
    );
  }
  return patterns.filter((p) => !p.includes(":")).map((p) => (p === "*" ? NOT_FOUND : p));
}

/** Links do menu principal (o que a pessoa alcança sem digitar endereço), com a Hoje na frente. */
export async function menuRoutes(page: Page): Promise<string[]> {
  await page.goto("/app");
  const hrefs = await page.locator("#tn-menu a[href^='/app']").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  return [...new Set(["/app", ...hrefs])];
}

/** Menu + roteador, sem repetição: primeiro o menu, na ordem em que aparece, depois o que só existe no roteador. */
export async function sweepRoutes(page: Page): Promise<string[]> {
  return [...new Set([...(await menuRoutes(page)), ...routerRoutes()])];
}

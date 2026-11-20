// O kit das páginas do cliente é um só (este diretório), mas `sales` ainda tem a sua cópia (o lint não deixava módulo
// importar módulo, e sales é de outra área). Este teste lê os arquivos do disco, sem importar nada, e falha se a cópia
// de sales divergir do kit além das diferenças listadas abaixo.
// SAI QUANDO SALES TROCAR A CÓPIA POR `src/components/public/public-kit.tsx` (e então `sales/public-kit.*` some).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const SALES = "../../features/sales/";

/** Comentário de abertura (até o primeiro import): diz onde o arquivo mora, então é diferente em cada um. */
const withoutHeader = (text: string) => text.slice(text.indexOf("\nimport ") + 1);

/**
 * Diferenças conhecidas entre o kit e a cópia de sales: [trecho do kit, trecho da cópia]. Cada uma tem que existir no
 * kit (a lista não pode esconder coisa que já saiu). A leitura própria do Perfil (`own`) entrou quando network,
 * payments e reputation passaram a dividir um kit só: antes, cada cópia tinha o seu leitor.
 */
const KNOWN: Array<[string, string]> = [
  ["export type BusinessReader =", "type BusinessReader ="],
  [
    `/** Troca a leitura padrão (testes). null volta ao padrão. */`,
    `/** O módulo Perfil troca a leitura pela própria (inclui a demonstração); também usado em testes. null volta ao padrão. */`,
  ],
  [
    `// Leitura própria de um módulo, com cache à parte. O Perfil lê pela API dele (vale também na demonstração); quando
// cada módulo tinha a sua cópia do kit, essa troca só valia para as páginas do Perfil, e continua assim.
const ownCaches = new WeakMap<BusinessReader, Map<string, Promise<PublicBusiness | null>>>();
`,
    "",
  ],
  [
    ` * perfil publicado. As páginas com token usam isto para ter cabeçalho e saída mesmo quando o token não vale mais.
 * \`own\`: leitura própria do módulo (só o Perfil usa); sem ela, a leitura padrão.
 */
export function usePublicBusiness(slug: string | null | undefined, own?: BusinessReader): PublicBusiness | null | undefined {`,
    ` * perfil publicado. As páginas com token usam isto para ter cabeçalho e saída mesmo quando o token não vale mais.
 */
export function usePublicBusiness(slug: string | null | undefined): PublicBusiness | null | undefined {`,
  ],
  [
    `    let store = cache;
    if (own) {
      store = ownCaches.get(own) ?? new Map();
      ownCaches.set(own, store);
    }
    const read = own ?? reader;
    let hit = store.get(valid);
    if (!hit) {
      hit = read(valid).catch(() => null);
      store.set(valid, hit);
    }`,
    `    let hit = cache.get(valid);
    if (!hit) {
      hit = reader(valid).catch(() => null);
      cache.set(valid, hit);
    }`,
  ],
  ["  }, [valid, own]);", "  }, [valid]);"],
];

describe("public-kit: a cópia de sales acompanha o kit único", () => {
  it("public-kit.css de sales é igual ao kit", () => {
    expect(read(`${SALES}public-kit.css`)).toBe(read("./public-kit.css"));
  });

  it("public-kit.tsx de sales é igual ao kit, fora o comentário de abertura e as diferenças conhecidas", () => {
    let kit = withoutHeader(read("./public-kit.tsx"));
    for (const [ours, theirs] of KNOWN) {
      expect(kit, `diferença conhecida que não está mais no kit: ${ours.slice(0, 60)}`).toContain(ours);
      kit = kit.replace(ours, theirs);
    }
    expect(withoutHeader(read(`${SALES}public-kit.tsx`))).toBe(kit);
  });

  // owner-slug.ts não é mais comparado: payments usa o cliente da sessão desde o P53; sales troca no recado do P53.
});

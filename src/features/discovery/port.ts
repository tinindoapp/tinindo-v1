// Portas do módulo Diretório (P23). Demonstração: emulação na aba, sempre rotulada; servidor: Edge Function `discovery`.
import type { DirectoryCard, DirectoryCities, DirectorySearch, DirectorySearchInput, DiscoveryOverview, DiscoverySaveInput } from "@contracts";
import type { z } from "zod";

export type ListingDraft = z.input<typeof DiscoverySaveInput>;
export type SearchQuery = z.input<typeof DirectorySearchInput>;
export type { DirectoryCard, DirectoryCities, DirectorySearch, DiscoveryOverview };

export interface DiscoveryPort {
  readonly kind: "demo" | "server";
  overview(): Promise<DiscoveryOverview>;
  save(draft: ListingDraft, key: string): Promise<DiscoveryOverview>;
}

/** Leitura pública do diretório (sem login). */
export interface DirectoryPort {
  readonly kind: "demo" | "server";
  search(q: SearchQuery): Promise<DirectorySearch>;
  cities(category?: DirectoryCard["category"] | null): Promise<DirectoryCities>;
}

export const newKey = () => crypto.randomUUID();

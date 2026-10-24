// Rótulos do Diretório (P23).
export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;
export const CATEGORY_LABEL = { barber: "Barbearia", hairdresser: "Cabeleireira", personal_trainer: "Personal trainer", other: "Serviços" } as const;
export const CATEGORY_PLURAL = { barber: "Barbearias", hairdresser: "Cabeleireiras", personal_trainer: "Personal trainers", other: "Serviços" } as const;
export const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const WEEKDAY = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const STATUS_LABEL = { listed: "No diretório", unlisted: "Fora do diretório", suspended: "Suspenso pela moderação" } as const;
export const directoryPath = (uf: string, citySlug: string, category?: string | null) => `/diretorio/${uf.toLowerCase()}/${citySlug}${category ? `/${category}` : ""}`;

export function explain(err: unknown): string {
  const e = err as { code?: string; field?: string } | null;
  switch (e?.code) {
    case "POLICY_REJECTED":
      return e.field === "profile" ? "Publique seu perfil público primeiro: o diretório mostra só o que o perfil mostra." : "As regras não permitem esta ação agora.";
    case "VALIDATION_ERROR":
      if (e.field === "uf") return "Escolha a UF.";
      if (e.field === "city_name") return "Informe a cidade.";
      return "Confira os campos e tente de novo.";
    case "STALE_VERSION":
      return "Isto mudou em outro lugar. Atualizamos a tela: confira e tente de novo.";
    case "FORBIDDEN":
      return "Só o dono do negócio decide sobre o diretório.";
    default:
      return "Não deu certo agora. Nada foi alterado; tente de novo.";
  }
}

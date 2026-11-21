// Tela do dono que monta um link para o cliente: o endereço do perfil publicado entra no caminho do link
// (`withBusinessSlug` do kit público), para a prévia no WhatsApp dizer o nome do negócio. Sem perfil publicado → null e o
// link fica como era. Cópia idêntica em payments (módulo não importa módulo): lê `network/profile.get` pela API.
import { OwnerProfileOutput } from "@contracts";
import { useEffect, useState } from "react";
import { useApi } from "../../app/api.tsx";
import { getPublishedSlug } from "../../lib/demo/journey.ts";

export function usePublishedSlug(): string | null {
  const { demo, call, tenantId } = useApi();
  const [slug, setSlug] = useState<string | null>(() => (demo ? getPublishedSlug() : null));
  useEffect(() => {
    if (demo || !call || !tenantId) return;
    let alive = true;
    call("/network/profile.get", OwnerProfileOutput, { tenantId }).then(
      (r) => alive && setSlug(r.data.profile?.published_at ? r.data.profile.slug : null),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [demo, call, tenantId]);
  return slug;
}

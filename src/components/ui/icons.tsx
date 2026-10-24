// Ícones de interface. Os 12 da marca vêm do arquivo oficial (brand/assets/icons/ui-icons-sprite.svg), injetado uma vez
// no documento e referenciado por <use>, sem redesenho. Os que a marca ainda não tem seguem a mesma especificação do
// manual (grade 24 px, traço 2 px, pontas arredondadas, currentColor) e evitam robô, cérebro, faísca de "IA" e afins.
// ADR-0024 registra a lista para entrar no sprite oficial quando a marca for revisada.
import brandSprite from "@brand/assets/icons/ui-icons-sprite.svg?raw";
import type { ReactNode } from "react";

const BRAND = ["agenda", "cliente", "orcamento", "receber", "mensagem", "espera", "avaliacao", "local", "aprovar", "alerta", "info", "bloqueio"] as const;
type BrandIcon = (typeof BRAND)[number];

const APP: Record<string, ReactNode> = {
  home: <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19Z" />,
  assistente: (
    <>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5Z" />
      <path d="M8.5 10h.01M12 10h.01M15.5 10h.01" />
    </>
  ),
  crescer: (
    <>
      <path d="M4 19.5h16" />
      <path d="m5 15 4.5-4.5 3.5 3.5L19 8" />
      <path d="M15 8h4v4" />
    </>
  ),
  negocio: (
    <>
      <path d="M4 9.5 5.5 4.5h13L20 9.5" />
      <path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" />
      <path d="M5.5 11.5V20h13v-8.5M10 20v-4.5h4V20" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  ajustes: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  lista: <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />,
  fechar: <path d="M6 6l12 12M18 6 6 18" />,
  seta: <path d="m9 6 6 6-6 6" />,
  mais: <path d="M12 5v14M5 12h14" />,
  preco: (
    <>
      <path d="M3.5 12.2V5A1.5 1.5 0 0 1 5 3.5h7.2l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-7 7a1.5 1.5 0 0 1-2.1 0Z" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
  pagamento: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3 10h18M7 15h4" />
    </>
  ),
  assinatura: (
    <>
      <path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19" />
      <path d="m16 3 3 3-3 3" />
      <path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5" />
      <path d="m8 21-3-3 3-3" />
    </>
  ),
  relacionamento: (
    <>
      <path d="M6 10a6 6 0 0 1 12 0c0 4.5 1.5 6 2 6.5H4c.5-.5 2-2 2-6.5Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  campanha: (
    <>
      <path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1Z" />
      <path d="M17 9a4 4 0 0 1 0 6" />
    </>
  ),
  indicacao: (
    <>
      <circle cx="10" cy="8.5" r="3.5" />
      <path d="M3.5 20c.8-3.6 3.3-5.5 6.5-5.5 1.6 0 3 .4 4.2 1.3M18.5 14v6M15.5 17h6" />
    </>
  ),
  metas: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12h.01" />
    </>
  ),
  resultado: <path d="M5 20v-8M12 20V5M19 20v-9" />,
  perfil: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6 16c.5-1.5 1.6-2.3 3-2.3s2.5.8 3 2.3M14.5 10H18M14.5 13.5H18" />
    </>
  ),
  plano: (
    <>
      <path d="m12 4 8.5 4.5L12 13 3.5 8.5Z" />
      <path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" />
    </>
  ),
  conta: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6" />
    </>
  ),
  nota: (
    <>
      <path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4Z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </>
  ),
  site: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5Z" />
    </>
  ),
  sair: (
    <>
      <path d="M14 4.5h3.5A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5H14" />
      <path d="m10 16-4-4 4-4M6 12h9" />
    </>
  ),
};

export type IconName = BrandIcon | keyof typeof APP;
const isBrand = (n: string): n is BrandIcon => (BRAND as readonly string[]).includes(n);

/** Sprite oficial da marca, montado uma vez (o shell e as telas com ícone o incluem). */
export function IconSprite() {
  return <div hidden aria-hidden="true" dangerouslySetInnerHTML={{ __html: brandSprite }} />;
}

/** Ícone decorativo: o significado vem sempre do texto ao lado (estado nunca só por ícone ou cor). */
export function Icon({ name, size = 24, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className ? `tn-icon ${className}` : "tn-icon"} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {isBrand(name) ? <use href={`#ti-${name}`} /> : APP[name]}
    </svg>
  );
}

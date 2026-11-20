// Peças do cartão e da ficha do cliente: ligar e WhatsApp (auditoria de UX, item 35). O menu "⋯" das ações de cadastro
// foi para o sistema (ActionsMenu em components/ui/menu.tsx) na onda 3.
// P54: na ficha os dois são secundários (fantasma, "Agendar" é a principal); na lista, só o WhatsApp fica à vista.
import { telHref, whatsappHref } from "./format.ts";

type Look = { variant?: "secondary" | "ghost"; compact?: boolean };

/** "WhatsApp" (wa.me) numa aba nova. Sem telefone válido, nada. */
export function WhatsAppButton({ name, phone, variant = "secondary", compact }: { name: string; phone: string | null } & Look) {
  const wa = whatsappHref(phone);
  if (!wa) return null;
  return (
    <a
      className="tn-button crm-contact"
      data-variant={variant}
      data-size={compact ? "compact" : undefined}
      href={wa}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`WhatsApp de ${name} (abre o WhatsApp)`}
    >
      WhatsApp
    </a>
  );
}

/** "Ligar" (tel:) e "WhatsApp" (wa.me). Sem telefone cadastrado, nenhum dos dois aparece. */
export function ContactButtons({ name, phone, variant = "secondary", compact }: { name: string; phone: string | null } & Look) {
  const tel = telHref(phone);
  if (!tel || !whatsappHref(phone)) return null;
  return (
    <>
      <WhatsAppButton name={name} phone={phone} variant={variant} compact={compact} />
      <a className="tn-button crm-contact" data-variant={variant} data-size={compact ? "compact" : undefined} href={tel} aria-label={`Ligar para ${name}`}>
        Ligar
      </a>
    </>
  );
}

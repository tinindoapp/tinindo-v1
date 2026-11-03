// Peças do cartão e da ficha do cliente: ligar e WhatsApp (auditoria de UX, item 35). O menu "⋯" das ações de cadastro
// foi para o sistema (ActionsMenu em components/ui/menu.tsx) na onda 3.
import { telHref, whatsappHref } from "./format.ts";

/** "Ligar" (tel:) e "WhatsApp" (wa.me). Sem telefone cadastrado, nenhum dos dois aparece. */
export function ContactButtons({ name, phone }: { name: string; phone: string | null }) {
  const tel = telHref(phone);
  const wa = whatsappHref(phone);
  if (!tel || !wa) return null;
  return (
    <>
      <a className="tn-button crm-contact" data-variant="secondary" href={tel} aria-label={`Ligar para ${name}`}>
        Ligar
      </a>
      <a
        className="tn-button crm-contact"
        data-variant="secondary"
        href={wa}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`WhatsApp de ${name} (abre o WhatsApp)`}
      >
        WhatsApp
      </a>
    </>
  );
}

// Catálogo dos passos da configuração guiada (P44): ordem, obrigatoriedade, rótulo, porquê, tela que resolve e verbo
// do botão. Espelha app.setup_steps() da migration; o servidor é a fonte do estado (feito, dispensado), aqui só a
// apresentação. Fica em `lib` porque dois módulos o leem: a tela de Configuração (setup) e o "Me ajuda a configurar"
// do Assistente (agent), que não podem importar um ao outro.
import type { SetupStepCode } from "@contracts";

export interface SetupStepSpec {
  step: SetupStepCode;
  required: boolean;
  title: string;
  why: string;
  link: string;
  /** Verbo curto do botão ("Definir horários"). */
  cta: string;
}

export const SETUP_STEPS: readonly SetupStepSpec[] = [
  { step: "hours", required: true, title: "Definir seus horários de atendimento", why: "Sem expediente, o link público não mostra horários e ninguém consegue reservar.", link: "/app/agenda/horarios", cta: "Definir horários" },
  { step: "service", required: true, title: "Cadastrar um serviço com duração e preço", why: "O cliente escolhe o serviço no link: a duração vira o horário e o preço vira o valor combinado.", link: "/app/clientes/servicos", cta: "Cadastrar serviço" },
  { step: "cancellation_policy", required: true, title: "Definir a antecedência para cancelar", why: "A política aparece para o cliente antes de reservar e evita discussão depois.", link: "/app/conta", cta: "Definir antecedência" },
  { step: "profile", required: true, title: "Publicar seu perfil e mandar o link", why: "O link público é como o cliente reserva com você. Sem ele, só por mensagem.", link: "/app/perfil", cta: "Publicar perfil" },
  { step: "first_customer", required: false, title: "Cadastrar seu primeiro cliente", why: "Com o cliente na lista, o atendimento já sai com nome e WhatsApp.", link: "/app/clientes", cta: "Cadastrar cliente" },
  { step: "photo_whatsapp", required: false, title: "Pôr foto e WhatsApp no perfil", why: "Foto e WhatsApp passam confiança a quem chega pelo link.", link: "/app/perfil", cta: "Pôr foto e WhatsApp" },
  { step: "channel", required: false, title: "Conectar e verificar seu número", why: "Com o número verificado, o código da reserva pelo link e os lembretes saem pelo canal.", link: "/app/mensagens", cta: "Conectar número" },
  { step: "first_cash", required: false, title: "Registrar o primeiro recebimento", why: "O Caixa mostra o que entrou e o que falta cobrar a partir do primeiro registro.", link: "/app/caixa", cta: "Registrar recebimento" },
];

export const setupStepSpec = (step: SetupStepCode): SetupStepSpec => SETUP_STEPS.find((s) => s.step === step)!;

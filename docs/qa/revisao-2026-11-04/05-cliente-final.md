# Revisão 05 · Experiência do cliente final

Repositório `/home/user/tinindo-v1`, `main` b7b58fc, build servido com `vite preview` na porta 4305, modo demonstração (sem Supabase). Playwright/Chromium em 375×812, toque, pt-BR, fuso America/Sao_Paulo. Scripts e screenshots: `scratchpad/a5/` (`s01.cjs` a `s11.cjs`, PNGs numerados). Nada foi alterado no repositório.

**Como a demonstração funciona (limita o teste):** os links públicos só funcionam na mesma aba em que o "dono" criou o perfil, o orçamento, a cobrança ou a oferta (a memória é da aba). Abrir `/p/:slug` direto, como alguém que vem do WhatsApp, mostra "Perfil não encontrado". Por isso fiz cada fluxo assim: o dono publica em `/app/...` e eu entro no link público pelo roteador da aba (pushState). Não testei com servidor, envio de código, webhook do Pix nem o Worker da prévia do link. Esses pontos analisei lendo o código e as migrations, e marco isso em cada achado.

## 1. Resumo

O caminho principal funciona e está claro no celular. No perfil a pessoa vê o nome, a categoria e a região. Depois escolhe o serviço (com "a partir de R$", se o dono ligar os preços), o dia e a hora, informa nome e WhatsApp, digita o código e vê "Horário confirmado", com opção de pôr na agenda e falar com o profissional. Os textos de conflito, prazo vencido e código errado são humanos, e o "ver não aceita nada" do orçamento e da oferta passa segurança. Não houve rolagem horizontal, os alvos de toque têm 44 px ou mais, e não vi dado de outro cliente nas páginas públicas.

Os problemas graves estão nos caminhos de exceção e no que vem depois:

- **Bloqueio por código.** Depois de 5 códigos errados, a tela manda "Peça o horário de novo". Quem obedece fica preso em "Muitas tentativas" mesmo digitando o código certo. Reproduzido na demo, e o servidor tem a mesma regra.
- **Corrigir o número.** Usar "Corrigir" no número faz a pessoa perder o próprio horário ("reservado por outra pessoa"), e o código vai para o número errado. Reproduzido.
- **Código que não chega.** A tela sempre diz "Enviamos um código", mesmo quando o envio falhou, e não existe "reenviar código".
- **"Minhas reservas" e "Avaliar" não servem para quem reservou pelo link.** Os dois pedem login. O cadastro é voltado ao profissional, e depois de entrar a pessoa cai em "Vamos começar · Criar meu negócio". Além disso, nenhuma tela do dono gera o código de vínculo (`customer_link.issue` não é chamado no frontend). Sem vínculo, a lista fica vazia e não há o que avaliar.
- **Informação que falta.** Nenhuma etapa da reserva nem a confirmação mostram preço ou endereço. O perfil só diz a região ("Centro, Campinas"), sem descrição nem endereço.
- **Prévia do link fora do perfil e do site.** Nos links de cobrança Pix, orçamento e oferta, a prévia do WhatsApp mostra o slogan para profissionais ("Agenda, clientes e dinheiro do seu negócio em ordem"). Numa cobrança, isso parece golpe ou spam. A imagem padrão usa caminho relativo.

## 2. Fluxos

### 2.1 Perfil público e reserva pelo link (`/p/:slug`)
Passos: dono publica (região "Centro, Campinas", WhatsApp e preços ligados) → `/p/barbearia-exemplo-a` → "Ver horários livres" → Corte → "Escolher dia e hora" → 13:00 → nome/WhatsApp → código → confirmado.
- Funcionou: topo com categoria, nome e região, "Ver horários livres" e "Conversar no WhatsApp" (`10-perfil-publico.png`). As 4 etapas têm indicador ("Passo 3 de 4") e resumo "Corte · ter 20/10 · 13:00". A validação de nome e telefone é clara ("Use o número com DDD, por exemplo (11) 97777-4343"). O código errado dá "Código incorreto. Confira a mensagem e tente de novo." A confirmação traz .ics e uma mensagem pronta para o WhatsApp: "Olá! Marquei Corte para terça-feira, 20/10 às 13:00 pelo seu perfil na Tinindo." (`16-confirmado.png`).
- Travou ou faltou:
  - 5 tentativas erradas levam a um bloqueio sem saída (achado 1).
  - "Corrigir" o número faz perder o horário (achado 2).
  - Não há reenviar código, e a tela diz "Enviamos" mesmo quando o envio falhou (achado 3).
  - Não aparecem preço nem endereço (achado 5).
  - "Manter o anterior" mostra só "Pedido anterior deste WhatsApp", sem dizer qual horário a pessoa vai confirmar (achado 9).
  - Na demo, "guardado até as 09:15" aparece para um horário das 13:00, porque o relógio das fixtures é fixo. Está documentado no P43.
  - O código curto mostra dois erros ao mesmo tempo, "Digite os 6 números do código." e "Código incorreto…" (achado 14).
- Abrir `/p/:slug` numa aba nova dá "Perfil não encontrado" (`01-perfil-direto.png`). É limitação da demo, mas é exatamente o que acontece se alguém mandar o link da demo por WhatsApp.

### 2.2 Troca de pedido pendente
Mesmo WhatsApp e outro horário → aviso "Já existe um pedido aguardando confirmação para este WhatsApp. Se continuar, ele será trocado por este." com "Manter o anterior" / "Trocar pelo novo" (`21-pendente.png`). "Trocar" funciona e mostra "Seu pedido anterior foi cancelado e substituído por este." (`23-trocado.png`). "Manter" leva ao código sem dizer qual horário (`22-manter-anterior.png`). A troca mantém as tentativas gastas, e isso alimenta o achado 1.

### 2.3 Minhas reservas (`/app/conta/reservas`)
O link fica no rodapé do perfil e na confirmação ("Tem login? Veja em Minhas reservas"). Na demo ele abre dentro do shell do dono, com o menu da "Barbearia Exemplo A" e as abas Hoje/Agenda/Clientes/Dinheiro, e lista as reservas da "Cliente Exemplo Ana", não a que eu acabei de fazer (`17-minhas-reservas.png`). Na produção, sem login, a pessoa vai para `/entrar`, e depois do login sempre para `/app` (`src/app/pages/SignIn.tsx:15`). Não testei com servidor (achado 4).

### 2.4 Orçamento por link e aceite (`/orcamento#t=…`)
Dono cria "Corte e Barba" com horário proposto → link. Mensagem pronta: `Olá! Segue o orçamento "Corte e Barba". Para ver e aceitar, abra: <link>`. A página mostra o negócio, os itens, o total de R$ 100,00, o horário proposto, a validade e o aviso "Abrir esta página não aceita nada. Aceitar não é pagar" (`30-orcamento.png`). "Aceitar" mostra "Orçamento aceito. Horário reservado: quarta-feira, 21/10, 10:00–10:30. O pagamento é combinado com o profissional." (`31`). "Recusar" age num toque, sem confirmação (`32`, achado 10). Link inválido numa aba nova: "Este link não é válido, foi substituído por outro ou o orçamento foi cancelado." A linha técnica "Versão 1 · código 127957f8" fica exposta ao cliente (achado 15). Não testei a versão desatualizada (STALE_VERSION) porque exige duas abas com servidor. O texto do código está bom.

### 2.5 Cobrança por link Pix (`/pagar#t=…`)
Mensagem pronta: "Oi, Ana! Segue o Pix de Corte de R$ 60,00: <link>". A página mostra "Pagar Barbearia do Léo (exemplo)", "Corte · Ana (exemplo)", R$ 60,00, "Aguardando pagamento", "Copiar Pix", "Cole no app do seu banco…" (`40-pagar.png`). O pagamento simulado vira "Pago (confirmado pelo banco)" (`41`). Faltam o prazo (a cobrança vale 60 min e `expires_at` vem do servidor, mas não aparece) e a orientação de conferir o favorecido (achado 7). Link inválido: "Não encontramos esta cobrança. Ela pode ter sido paga, cancelada ou ter vencido. Peça um novo link…" (achado 11). Na demo o nome do negócio é outro ("Barbearia do Léo" em vez de "Barbearia Exemplo A", achado 17).

### 2.6 Lista de espera e oferta (`/oferta#t=…`)
Mensagem pronta do dono: "Abriu um horário para você. Veja e confirme se quiser: <link>", sem nome do negócio (achado 8). A página tem Onde, Serviço, Quando, Valor, a validade e "Abrir esta página não reserva nada" (`50-oferta.png`). "Aceitar e reservar" mostra "Reserva confirmada. Até lá!" (`51`), sem .ics nem contato. "Não quero" pede confirmação ("A vaga vai para outra pessoa da lista…"), o que está bom. Link inválido ou sem token continua com o título "Vaga disponível" acima de "Este link não é válido…" (achado 13).

### 2.7 Avaliação (`/avaliar`) e avaliações públicas (`/avaliacoes/:slug`)
Na demo, como "Cliente Exemplo Ana": nota de 1 a 5 e comentário, a validação "Escolha uma nota de 1 a 5." e a publicação "Obrigado! Sua avaliação foi publicada sem o seu nome." funcionam, e dá para retirar a avaliação (`60`, `61`). A página pública mostra "4,7 ★ · 3 avaliações", "Avaliações só de clientes atendidos", e nenhum nome de autor (`62`). Porém o título é só "Avaliações", sem dizer de quem, e não tem a marca (achado 12). Na produção, avaliar exige login e vínculo, que o cliente não consegue obter (achado 4). Nenhum modelo de mensagem convida a avaliar.

### 2.8 Diretório (`/diretorio`)
O índice e a cidade funcionam, com filtros e a frase "ordem alfabética do nome exibido · sem destaque pago" (`70`, `71`). Um cartão sem nome público aparece como "Barbearia · Moema", o que é aceitável. Na demo, "Ver horários" leva a `/p/barba-exemplo-e#agendar`, que dá "Perfil não encontrado" (`72`, achado 16).

### 2.9 Site do profissional (`/s/:slug`)
Funciona: frase, serviços com preço, horários de atendimento e "Ver horários e agendar" → `/p/slug` (`80-site.png`). Na demo a região do site é "Pinheiros" e a do perfil é "Centro, Campinas". No servidor as duas vêm do perfil, então é só da demo. Não há endereço, WhatsApp nem mapa, e para negócio com ponto fixo isso faz falta (achado 5).

### 2.10 Vínculo por código (`/app/conta/vincular`) e convite/indicação
A tela pede para colar um código de 43 caracteres ("ele tem 43 letras, números, - ou _"). O dono não tem onde gerar esse código (achado 4). `/convite` e `/indicar` funcionam. "Convite indisponível · Link inválido ou removido." está bom.

### 2.11 Prévia do link (WhatsApp)
Lida do código, sem testar com o Worker. Em `/p/` e `/s/`, `worker/og.ts` monta "Barbearia Exemplo A" / "Barbearia · Centro, Campinas. Veja os horários livres e agende pelo link." e usa a foto, se houver. Isso está bom. Em todas as outras rotas fica o padrão de `index.html:21-30` (achado 6).

### 2.12 Mensagens que o cliente recebe
Os modelos estão nas migrations (`p12`, `p13`, `p19`, `p43`, `p45`). Veja a seção 4.

## 3. Achados

**1. Bloqueio depois de 5 códigos errados; a orientação manda a pessoa para um beco sem saída. Impacto: alto.**
Rota `/p/:slug`. Código: `supabase/migrations/20261026164500_p43_public_booking.sql:235-237` (confirm recusa com `attempts >= 5`, mas não libera o hold nem encerra o pedido), `supabase/migrations/20261029033000_p43_replace_pending_request.sql:150-152` (a troca copia `attempts` do pedido anterior), `src/features/network/api.ts` (a demo faz o mesmo).
- O que acontece: depois da 5ª tentativa errada, a 6ª mostra "Muitas tentativas com código errado. Peça o horário de novo." O horário continua preso até vencer. Ao pedir de novo com o mesmo WhatsApp, aparece "Já existe um pedido aguardando…". Se a pessoa toca em "Trocar pelo novo", o pedido novo já nasce com 5 tentativas, e **o código certo** dá "Muitas tentativas" de novo. Cada troca renova o prazo, então o laço continua.
- O que deveria: ao esgotar as tentativas, liberar o horário e encerrar o pedido. A mensagem deveria dizer quanto tempo esperar ("Por segurança, espere 15 minutos para pedir de novo, ou fale com o profissional pelo WhatsApp"). Também ajuda mostrar as tentativas restantes a partir da 3ª.
- Evidência: `s05.cjs`, `25-bloqueio-codigo-certo.png`. A saída do script mostra "pendente? 1" e depois "Muitas tentativas" com o código correto.

**2. "Corrigir" o número faz a pessoa perder o próprio horário, e o código vai para o número errado. Impacto: alto.**
Rota `/p/:slug`. Código: `src/features/network/PublicProfileView.tsx:600-612` (Corrigir volta aos dados; a mudança no telefone chama `resetRequest` e gera uma chave nova), e no servidor o pedido pendente é procurado por telefone (`20261029033000…sql:118-123`).
- O que acontece: o pedido com o número errado continua segurando o horário. O pedido com o número certo cai em `SLOT_CONFLICT`, e a tela mostra "Este horário acabou de ser reservado por outra pessoa. Escolha outro." Ou seja, a pessoa está concorrendo consigo mesma e a mensagem é falsa. O código, com serviço, data e hora, já foi para um desconhecido.
- O que deveria: "Corrigir" deve cancelar o pedido anterior da mesma sessão (o `request_id` é conhecido) e pedir de novo o mesmo horário com o número novo. No mínimo, não dizer "outra pessoa".
- Evidência: `s04.cjs`, `20-corrigir-numero.png`.

**3. A tela sempre diz "Enviamos um código" e não existe reenvio. Impacto: alto.**
Rota `/p/:slug`. Código: `src/features/network/PublicProfileView.tsx:589-592`. O contrato traz `delivery: queued|sending|sent|failed|delivery_unknown` (`supabase/functions/_shared/contracts/network.ts:182`), mas a tela ignora esse campo.
- O que acontece: se o canal falhar, a pessoa espera por um código que não vem. "Voltar" e pedir de novo reaproveita a mesma chave, o que é idempotente e não reenvia nada. A única saída é esperar o horário vencer.
- O que deveria: o texto deve acompanhar o estado ("Enviando o código…", "Não conseguimos enviar o código para (11)…"). Também deve haver "Não recebi o código" com reenvio limitado e, como alternativa, "Fale com o profissional pelo WhatsApp".
- Evidência: leitura de código. Não testado com servidor.

**4. "Minhas reservas", "Avaliar" e o vínculo não funcionam para quem é cliente. Impacto: alto.**
Rotas `/app/conta/reservas`, `/avaliar`, `/app/conta/vincular`.
- O que acontece:
  1. O frontend não chama `customer_link.issue` (busquei `customer_link` em `src/`: só aparecem `redeem` e `revoke`, em `src/features/identity/services.tsx:165-181`). Então nenhum profissional consegue gerar o código que a tela de vínculo pede.
  2. A reserva pelo link sem login não fica ligada a conta nenhuma (P43: "o contato informado fica só no pedido").
  3. O login sempre leva a `/app` (`src/app/pages/SignIn.tsx:15`), que para conta sem negócio mostra "Vamos começar · Sua conta ainda não está ligada a um negócio. Criar meu negócio" (`src/app/AppShell.tsx:252-258`). O cadastro (`src/features/identity/AuthPages.tsx:60`) diz "Para quem atende com hora marcada…".
  4. Na demo, "Minhas reservas" abre dentro do shell do dono (`17-minhas-reservas.png`).
  5. O código de vínculo tem 43 caracteres para colar à mão (`RedeemLinkPage.tsx:22`).
- O que deveria:
  - Tirar "Tem login? Veja em Minhas reservas" e o link do rodapé até haver vínculo. No lugar, oferecer o .ics e o WhatsApp, que já existem.
  - Login com retorno à página de origem.
  - Uma tela do cliente sem o shell do negócio.
  - Para o profissional, gerar o vínculo como link (`/vincular#t=…`), sem código para colar.
- Evidência: código e `17-minhas-reservas.png`.

**5. Nem preço nem endereço aparecem na reserva ou depois dela. Impacto: médio.**
Rota `/p/:slug`. Código: `src/features/network/PublicProfileView.tsx:424-427` (resumo sem preço) e `:370-413` (confirmação), e o perfil não tem campo de endereço nem de descrição no editor do dono (o formulário só tem "Nome do negócio" e "Link para ver horários", embora a visão leia `bio` e `services_summary`).
- O que acontece: com "Mostrar preços" desligado, que é o padrão (`api.ts`, `show_prices: false`), a pessoa reserva sem ver preço nenhum. Mesmo com os preços ligados, o resumo e a tela "Horário confirmado" não repetem o valor. O servidor congela o preço base na confirmação (`p43…sql:252-255`), mas a pessoa não sabe qual é. Não há endereço, só a região.
- O que deveria: o resumo dos passos 3 e 4 e a confirmação devem mostrar "Corte · 30 min · R$ 60,00". A confirmação também deve trazer "Onde: <endereço ou 'o profissional combina o local com você'>". O .ics deveria levar o local.
- Evidência: `14-codigo.png`, `16-confirmado.png`, `19b-dados-viewport.png`.

**6. A prévia dos links de cobrança, orçamento e oferta é genérica e voltada ao profissional. Impacto: médio.**
Código: `index.html:21-30` e `worker/og.ts`, que só trata `/p/` e `/s/` (`routeOf`).
- O que acontece: o cliente recebe um Pix com a prévia "Tinindo — Agenda, clientes e dinheiro do seu negócio em ordem." Isso não diz quem cobra e lembra spam. No padrão, `og:image` é relativo (`/icons/app-icon-512.png`) e não há `og:url`. Os robôs de prévia costumam exigir URL absoluta, então a imagem não deve aparecer. O texto de `og.ts:118` diz "Veja o perfil **no** Tinindo", mas o resto do app usa "na Tinindo".
- O que deveria: em `/pagar`, `/orcamento` e `/oferta` (o token fica no fragmento, então o Worker não lê nada privado), usar uma prévia neutra e voltada ao cliente, por exemplo "Link seguro de pagamento · Tinindo" / "Você recebeu um link de um profissional que usa a Tinindo. Abra para ver os detalhes.", com imagem absoluta. No perfil e no site, "na Tinindo".
- Evidência: código, e o meta lido no navegador em `s03.cjs`.

**7. A página do Pix não mostra o prazo nem orienta a conferir quem recebe. Impacto: médio.**
Rota `/pagar`. Código: `src/features/payments/PayLinkPage.tsx:79-95` (o servidor devolve `expires_at`, `p14…sql:506-508`).
- O que acontece: a cobrança vence em 60 min, sem aviso. A pessoa que paga depois cai em "Não encontramos" ou "Expirada". Não há "confira no app do banco que o favorecido é <negócio>", que é a principal defesa contra golpe de Pix.
- O que deveria: "Pague até 14:35 de hoje" e "No app do banco, confira se o recebedor é <nome>. Se for outro nome, não pague e fale com o profissional." Depois de pago: "Pagamento confirmado em <hora>. Não precisa mandar comprovante."
- Evidência: `40-pagar.png`.

**8. As mensagens enviadas ao cliente não dizem quem manda. Impacto: médio.**
Código: `codigo_reserva` (`p43…sql:18-19`), `confirmacao_agendamento`, `lembrete_agendamento`, `link_orcamento`, `oferta_vaga` (`p12…sql:28-32`), `lembrete_cobranca` (`p13…sql:24`), e o texto do dono para a oferta ("Abriu um horário para você…").
- O que acontece: "Seu código para confirmar Corte em 20/10 às 13:00 é 123456." e "Há um valor de R$ 60,00 (Corte) em aberto." não têm nome do negócio nem endereço, e a cobrança vem sem link. Se o número do negócio não estiver salvo na agenda do cliente, isso parece golpe.
- O que deveria: incluir o nome do negócio em todos os modelos. Veja as propostas na seção 4.

**9. "Manter o anterior" leva a pessoa a confirmar sem saber o quê. Impacto: médio.**
Código: `PublicProfileView.tsx:338-352`, `:424-426`.
- O que acontece: o resumo vira "Pedido anterior deste WhatsApp" e a pessoa digita o código sem ver o serviço nem a hora. O servidor omite de propósito, para não expor o pedido a quem digitar o número de outra pessoa. Mas a mensagem com o código traz serviço e hora.
- O que deveria: dizer "Confirme com o código que chegou no seu WhatsApp. A mensagem diz o serviço e o horário." e, depois do código certo, mostrar o horário (isso já acontece na confirmação).
- Evidência: `22-manter-anterior.png`.

**10. "Recusar" orçamento age num toque, sem confirmação e sem motivo. Impacto: médio.**
Rota `/orcamento`. Código: `src/features/sales/QuoteLinkPage.tsx:117`.
- O que acontece: o toque é definitivo (decisão append-only). A oferta (`OfferPage.tsx:97`) pede confirmação, o orçamento não.
- O que deveria: confirmar ("Recusar este orçamento? O profissional verá que você recusou. Para mudar algo, fale com ele antes.") e, se possível, oferecer "Pedir ajuste" pelo WhatsApp.
- Evidência: `32-orcamento-recusado.png`.

**11. O texto de cobrança não encontrada sugere que pode já estar paga e manda pedir outro link. Impacto: médio.**
Código: `src/features/payments/PayLinkPage.tsx:29-30`.
- O que acontece: "Ela pode ter sido paga… Peça um novo link". Cobrança paga mostra "Pago" e não "não encontrada", então a frase é enganosa e pode levar a pagar duas vezes.
- O que deveria: veja a seção 4.

**12. A página pública de avaliações não diz de quem são. Impacto: médio.**
Rota `/avaliacoes/:slug`. Código: `src/features/reputation/ReviewPages.tsx:443`.
- O que acontece: o título é só "Avaliações", sem nome do negócio e sem marca. Quem chega por link compartilhado não sabe de quem é a nota.
- O que deveria: "Avaliações de Barbearia Exemplo A", com o Wordmark como nas outras páginas públicas.
- Evidência: `62-avaliacoes-publicas.png`.

**13. A página de oferta inválida continua com o título "Vaga disponível". Impacto: baixo.**
Código: `src/features/waitlist/OfferPage.tsx:74`. Deveria ser "Oferta de horário". Idem o `<title>` da aba.

**14. Erros de código duplicados. Impacto: baixo.**
Código: `PublicProfileView.tsx:354-357`. A validação local não limpa o `problem` anterior, então aparecem "Digite os 6 números do código." e "Código incorreto…" ao mesmo tempo. Evidência: saída de `s03.cjs`.

**15. Hash técnico exposto no orçamento. Impacto: baixo.**
Código: `QuoteLinkPage.tsx:107`. "Versão 1 · código 127957f8" se confunde com código de pagamento ou de reserva. Sugestão: "Versão 1 · enviada em …" e deixar o hash só no `title` ou no rodapé.

**16. Na demonstração, o diretório leva a perfis que não existem. Impacto: médio, só na demo, mas afeta quem demonstra o produto.**
Rota `/diretorio/sp/sao-paulo` → "Ver horários" → "Perfil não encontrado". Evidência: `72-diretorio-ver-horarios.png`.

**17. Nomes da demonstração inconsistentes. Impacto: baixo, só na demo.**
O Pix diz "Barbearia do Léo (exemplo)", o perfil e o orçamento dizem "Barbearia Exemplo A", e a região do site é "Pinheiros" enquanto a do perfil é "Centro, Campinas". O toast do dono ("Oferta preparada para Cliente Exemplo Ana…") aparece na página do cliente porque é a mesma aba.

**18. "Fale com a equipe Tinindo para pedir correção ou remoção" sem canal. Impacto: baixo.**
Código: `PublicProfileView.tsx:139-142`. Não há link nem e-mail, e o P09 já registrava que não existe canal operacional. Para confiança, faz falta um contato real.

**19. Privacidade, pontos menores. Impacto: baixo.**
- A página do Pix mostra a descrição do recebível ("Corte · Ana (exemplo)"). Se o dono escrever nome completo ou detalhes, isso fica visível a quem receber o link encaminhado. Convém orientar o dono ou mostrar só o serviço.
- O achado 2 manda um código com serviço e hora para um número digitado errado.
- Não vi CRM de terceiros, autor de avaliação ou contato do dono nas páginas públicas.

## 4. Textos para reescrever

| Onde (arquivo) | Hoje | Proposta |
|---|---|---|
| Reserva, tentativas (`PublicProfileView.tsx:66`) | "Muitas tentativas com código errado. Peça o horário de novo." | "Muitos códigos errados. Por segurança, o horário foi liberado. Espere 15 minutos para pedir de novo ou fale com o profissional pelo WhatsApp." (com a correção do achado 1) |
| Reserva, código errado (`:65`) | "Código incorreto. Confira a mensagem e tente de novo." | "Código não confere. Use o último código que chegou no WhatsApp. Restam N tentativas." |
| Reserva, conflito depois de "Corrigir" (`:61`) | "Este horário acabou de ser reservado por outra pessoa. Escolha outro." | Só quando for outra pessoa de fato. Ao corrigir o número: "Trocamos o número. Mandamos um novo código para (11) 9…" |
| Reserva, envio (`:589`) | "Enviamos um código de 6 dígitos para o seu WhatsApp …" | Conforme `delivery`: "Enviando o código para (11) 9…"; se falhou: "Não conseguimos enviar o código. Confira o número ou fale com o profissional." E incluir o botão "Não recebi o código". |
| Reserva, prazo (`:590`) | "O horário fica guardado até as 09:15; depois disso, volta a ficar livre." | "Guardamos este horário por 15 minutos (até 09:15). Confirme com o código antes disso." |
| Reserva, "Manter o anterior" (`:425`) | "Pedido anterior deste WhatsApp" | "Seu pedido anterior: o serviço e o horário estão na mensagem com o código." |
| Reserva, confirmação (`:376-379`) | "Corte · terça-feira, 20/10 às 13:00." | "Corte · terça-feira, 20/10 às 13:00 · R$ 60,00 (pago direto ao profissional). Local: <endereço>." |
| Confirmação (`:409`) | "Para remarcar ou cancelar, fale com o profissional. Tem login? Veja em Minhas reservas." | "Para remarcar ou cancelar, fale com o profissional pelo WhatsApp." (sem "Minhas reservas" enquanto não houver vínculo) |
| Rodapé do perfil (`:134-137`) | "Já foi atendido aqui? Avaliar meu atendimento · Minhas reservas" | Esconder até haver vínculo, ou "Já é cliente? Peça ao profissional o link para acompanhar suas reservas." |
| Pix, não encontrada (`PayLinkPage.tsx:30`) | "Não encontramos esta cobrança. Ela pode ter sido paga, cancelada ou ter vencido. Peça um novo link …" | "Este link de pagamento não vale mais (venceu ou foi cancelado). Não pague por outro caminho sem falar com <negócio>: peça um novo link a ele." |
| Pix, pendente (novo) | — | "Pague até HH:MM. No app do banco, confira se quem recebe é <negócio>." |
| Orçamento, rodapé (`QuoteLinkPage.tsx:107`) | "Versão 1 · código 127957f8 · vale até 27/10, 23:59" | "Válido até 27/10. Versão 1." |
| Orçamento, recusar | (sem confirmação) | "Recusar este orçamento? <negócio> verá a recusa. Para mudar algo, fale com ele antes." |
| Oferta inválida (`OfferPage.tsx:74,77`) | Título "Vaga disponível" + "Este link não é válido ou já foi usado em outro aparelho." | Título "Oferta de horário" + "Esta oferta não vale mais: já foi usada, venceu ou foi para outra pessoa. Fale com o profissional para ver outros horários." |
| Avaliações públicas (`ReviewPages.tsx:443`) | "Avaliações" | "Avaliações de <nome do negócio>" |
| Modelo `codigo_reserva` (migration P43) | "Seu código para confirmar {{1}} em {{2}} é {{3}}. Vale por 15 minutos. Se não foi você, ignore esta mensagem." | "{{negócio}}: seu código para confirmar {{1}} em {{2}} é {{3}}. Vale por 15 minutos. Não passe este código para ninguém. Se não foi você, ignore." |
| `confirmacao_agendamento` | "Olá, {{1}}! Seu horário de {{2}} está confirmado para {{3}}. Responda SAIR para não receber mais avisos." | "Olá, {{1}}! {{negócio}} confirmou seu horário de {{2}} em {{3}}. Endereço: {{local}}. Para remarcar, responda aqui." |
| `lembrete_agendamento` | "Lembrete: {{1}} em {{2}}. Se precisar remarcar, responda esta mensagem." | "Lembrete de {{negócio}}: {{1}} em {{2}}, {{local}}. Se precisar remarcar, responda esta mensagem." |
| `link_orcamento` | "Olá, {{1}}! Seu orçamento está pronto: {{2}}" | "Olá, {{1}}! {{negócio}} preparou seu orçamento. Veja e responda pelo link: {{2}}" |
| `lembrete_cobranca` | "Olá, {{1}}! Há um valor de {{2}} ({{3}}) em aberto. Se já pagou, desconsidere; se preferir, responda aqui." | "Olá, {{1}}! Aqui é {{negócio}}. Ficou em aberto {{2}} de {{3}}. Se já pagou, desconsidere. Dúvidas, responda aqui." |
| `reativacao` | "Faz tempo que não nos vemos no {{2}}." | "Faz tempo que não nos vemos por aqui, na {{2}}." Ou evitar o artigo: "Saudades de você aqui em {{2}}!" ("no Barbearia" fica errado.) |
| `pacote_vencendo` (P45) | "ainda tem {{3}} sessão(ões)" | Mandar o número já flexionado ("3 sessões" / "1 sessão") como parâmetro. |
| Mensagem pronta da oferta (WaitlistPage) | "Abriu um horário para você. Veja e confirme se quiser: <link>" | "Oi, <nome>! Abriu um horário de <serviço> em <dia/hora> na <negócio>. Veja e confirme pelo link: <link>" |
| Prévia padrão (`index.html`) | "Tinindo — Agenda, clientes e dinheiro do seu negócio em ordem." | Para links de cliente: "Link de um profissional que usa a Tinindo — abra para ver os detalhes." Imagem com URL absoluta. |
| `worker/og.ts:118` | "Veja o perfil no Tinindo." | "Veja o perfil na Tinindo." |

## O que não testei

- Fluxos com servidor real: envio do código pelo canal, prazo vencido de verdade, `STALE_VERSION` do orçamento, webhook do Pix.
- O Worker de prévia do link rodando: só li o código.
- Modo escuro e leitor de tela: não auditei.
- Usuário deslogado na produção (a demo sempre tem sessão).
- Abrir links públicos numa aba nova da demo: só mostra "não encontrado".

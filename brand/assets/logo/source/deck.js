const pptxgen = require("/tmp/claude-0/-home-user-bolotacolmeia/bafa1317-0490-5f33-b270-4aeb8feeed8d/scratchpad/tools/node_modules/pptxgenjs");
const { applyTheme } = require("/root/.claude/skills/synced/1c69a383-9259-401b-b109-ffdcd1b186c0_08fe2b7a-66ed-43b7-aa42-15a8b23e72fa/pptx/scripts/apply_theme.js");
const { execSync } = require("child_process");

const SC = "/tmp/claude-0/-home-user-bolotacolmeia/bafa1317-0490-5f33-b270-4aeb8feeed8d/scratchpad";
const KIT = `${SC}/tinindo-brand`, IMG = `${SC}/deckimg`;
const OUT = `${KIT}/apresentacao/Tinindo-apresentacao-socio.pptx`;
require("fs").mkdirSync(`${KIT}/apresentacao`, { recursive: true });

const THEME = {
  name: "Tinindo",
  headFontFace: "Arial", bodyFontFace: "Arial",
  colors: { dk1: "111111", lt1: "FFFFFF", dk2: "2A2A28", lt2: "F7F7F5",
            accent1: "FF4B1F", accent2: "111111", accent3: "62625D", accent4: "1D5AA6", accent5: "1F6E3A", accent6: "B33008",
            hlink: "111111", folHlink: "62625D" },
};

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = "Tinindo — identidade de marca (apresentação para o sócio)";
pres.author = "Felipe Ferreira Falleiros";
pres.company = "Tinindo";
const C = pres.SchemeColor;

const dims = (p) => { const [w, h] = execSync(`identify -format "%w %h" "${p}"`).toString().split(" ").map(Number); return { w, h }; };
const fit = (p, w) => { const d = dims(p); return { w, h: +(w * d.h / d.w).toFixed(3) }; };
const fitH = (p, h) => { const d = dims(p); return { w: +(h * d.w / d.h).toFixed(3), h }; };
const WM_LIGHT = `${KIT}/assets/logo/tinindo-wordmark-color.png`, WM_DARK = `${KIT}/assets/logo/tinindo-wordmark-negativo-cor.png`;
const FOOT = "Tinindo · apresentação para o sócio · rascunho v0.2";

// ---------- layouts (frame): título, rodapé, número
const titleOpts = (color) => ({ name: "title", type: "title", x: 0.6, y: 0.4, w: 12.1, h: 0.95, fontFace: "Arial", fontSize: 28, bold: true, color, align: "left", valign: "middle", margin: 0 });
pres.defineSlideMaster({
  title: "LIGHT", background: { color: "F7F7F5" },
  objects: [
    { placeholder: { options: titleOpts(C.text1), text: "" } },
    { image: { x: 0.6, y: 6.93, w: 1.5, h: 0.38, path: WM_LIGHT, altText: "Tinindo" } },
    { text: { text: FOOT, options: { x: 2.4, y: 6.98, w: 8, h: 0.3, fontFace: "Arial", fontSize: 10, color: C.accent3, margin: 0 } } },
  ],
  slideNumber: { x: 12.2, y: 6.98, w: 0.5, h: 0.3, fontFace: "Arial", fontSize: 10, color: C.accent3, align: "right" },
});
pres.defineSlideMaster({
  title: "DARK", background: { color: "111111" },
  objects: [
    { placeholder: { options: titleOpts(C.background1), text: "" } },
    { image: { x: 0.6, y: 6.93, w: 1.5, h: 0.38, path: WM_DARK, altText: "Tinindo" } },
    { text: { text: FOOT, options: { x: 2.4, y: 6.98, w: 8, h: 0.3, fontFace: "Arial", fontSize: 10, color: "BDBDB7", margin: 0 } } },
  ],
  slideNumber: { x: 12.2, y: 6.98, w: 0.5, h: 0.3, fontFace: "Arial", fontSize: 10, color: "BDBDB7", align: "right" },
});
pres.defineSlideMaster({ title: "COVER", background: { color: "111111" }, objects: [] });

// ---------- helpers
const T = (s, text, o) => s.addText(text, Object.assign({ isTextBox: true, fontFace: "Arial", fontSize: 16, color: C.text1, margin: 0, valign: "top" }, o));
const dot = (s, x, y, d = 0.18, name = "ponto") => s.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color: C.accent1 }, line: { color: C.accent1, width: 0 }, objectName: name });
const num = (s, n, x, y, d = 0.5, dark = false) => {
  s.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color: C.accent1 }, line: { color: C.accent1, width: 0 }, objectName: "marcador " + n });
  s.addText(String(n), { x, y, w: d, h: d, align: "center", valign: "middle", fontFace: "Arial", fontSize: 16, bold: true, color: C.text1, margin: 0, isTextBox: true });
};
const card = (s, x, y, w, h, o = {}) => s.addShape(pres.ShapeType.roundRect, Object.assign({ x, y, w, h, rectRadius: 0.12, fill: { color: C.background1 }, line: { color: "DEDED9", width: 0.75 }, shadow: { type: "outer", color: "000000", opacity: 0.08, blur: 6, offset: 2, angle: 90 } }, o));
const darkCard = (s, x, y, w, h) => s.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.12, fill: { color: "1C1C1A" }, line: { color: "3A3A37", width: 0.75 } });
const pic = (s, path, x, y, w, name, extra = {}) => { const f = fit(path, w); s.addImage(Object.assign({ path, x, y, w: f.w, h: f.h, altText: name }, extra)); return f; };
const picH = (s, path, x, y, h, name, extra = {}) => { const f = fitH(path, h); s.addImage(Object.assign({ path, x, y, w: f.w, h: f.h, altText: name }, extra)); return f; };
const notes = (s, t) => s.addNotes(t);
const slide = (layout, section, title) => { const s = pres.addSlide({ masterName: layout, sectionTitle: section }); if (title) s.addText(title, { placeholder: "title" }); return s; };

// =========================================================================================
pres.addSection({ title: "Abertura" });
{ // 1 capa
  const s = pres.addSlide({ masterName: "COVER", sectionTitle: "Abertura" });
  pic(s, WM_DARK, 0.8, 1.45, 7.4, "Tinindo");
  T(s, "Identidade de marca", { x: 0.8, y: 3.75, w: 7, h: 0.5, fontSize: 24, bold: true, color: C.background1 });
  T(s, "Conceito, cores, guias e aplicações. Apresentação para o sócio.", { x: 0.8, y: 4.3, w: 6.8, h: 0.9, fontSize: 18, color: "BDBDB7" });
  dot(s, 0.8, 5.5, 0.16, "ponto da legenda");
  T(s, "Assinatura verbal candidata (provisória): “Serviço bem-feito, negócio em ordem.”", { x: 1.1, y: 5.4, w: 6.6, h: 0.6, fontSize: 14, color: C.background1 });
  T(s, "Rascunho v0.2 · 11 de outubro de 2026 · tudo aqui é proposta, não identidade registrada", { x: 0.8, y: 6.7, w: 9, h: 0.3, fontSize: 11, color: "BDBDB7" });
  picH(s, `${KIT}/assets/logo/tinindo-symbol-negativo-cor.png`, 8.9, 1.5, 4.0, "Símbolo Tinindo");
  notes(s, "Abertura. Esta apresentação reúne a estratégia de marca e a identidade visual desenhadas com o fundador. Tudo é proposta: a assinatura verbal não está aprovada, a marca não está registrada e a diligência jurídica ainda não foi feita. O objetivo de hoje é decidir se seguimos com esta direção.");
}
{ // 2 roteiro
  const s = slide("LIGHT", "Abertura", "O que vamos ver hoje");
  const items = [["Por que a Tinindo existe", "Tese, os dois lados da plataforma, públicos, posicionamento, personalidade", "slides 3 a 7"],
    ["Como chegamos à identidade", "Os três territórios e o caminho até o sorriso", "slides 8 e 9"],
    ["O logotipo", "Conceito, anatomia, símbolo, ícone de app, regras de uso", "slides 10 a 12, 16 e 17"],
    ["Cor, tipografia e produto", "Paleta, regras, tipo, vitrine, confiança e assistente", "slides 13 a 15 e 18 a 20"],
    ["Aplicações, voz e o que falta", "Peças, tom, riscos, avaliação, próximos passos e decisões", "slides 21 a 27"]];
  items.forEach((it, i) => {
    const y = 1.6 + i * 1.02;
    card(s, 0.6, y, 12.1, 0.88);
    num(s, i + 1, 0.85, y + 0.19, 0.5);
    T(s, it[0], { x: 1.7, y: y + 0.1, w: 4.4, h: 0.7, fontSize: 18, bold: true, valign: "middle" });
    T(s, it[1], { x: 6.1, y: y + 0.1, w: 4.6, h: 0.7, fontSize: 14, color: C.accent3, valign: "middle" });
    T(s, it[2], { x: 10.8, y: y + 0.1, w: 1.8, h: 0.7, fontSize: 12, color: C.accent3, valign: "middle", align: "right" });
  });
  notes(s, "Roteiro. A primeira parte é de estratégia (por que existimos); a segunda mostra o caminho que levou ao conceito; depois o logotipo e o sistema; no fim, o que ainda não sabemos e o que precisamos decidir juntos.");
}

pres.addSection({ title: "Estratégia" });
{ // 3 tese
  const s = slide("DARK", "Estratégia", "A tese: o profissional faz o serviço, a Tinindo ajuda a fazer o negócio funcionar");
  T(s, "Quem trabalha sozinho acumula execução, atendimento, vendas, agenda, cobrança e compras. Quer realizar o trabalho e atender bem, não aprender cinco sistemas.", { x: 0.6, y: 1.6, w: 7.2, h: 1.7, fontSize: 18, color: C.background1 });
  T(s, "IA, dados estruturados e automações podem dar a uma pessoa a capacidade administrativa e comercial que antes exigiria uma equipe pequena.", { x: 0.6, y: 3.4, w: 7.2, h: 1.3, fontSize: 18, color: "BDBDB7" });
  darkCard(s, 8.3, 1.6, 4.4, 3.1);
  dot(s, 8.6, 1.9, 0.2);
  T(s, "Princípio do produto", { x: 8.95, y: 1.82, w: 3.5, h: 0.35, fontSize: 14, bold: true, color: "FF6A3D" });
  T(s, "O melhor sistema de gestão para um profissional pode ser aquele que ele quase nunca precisa abrir.", { x: 8.6, y: 2.4, w: 3.8, h: 2.1, fontSize: 20, bold: true, color: C.background1 });
  T(s, "Hipótese de partida, ainda não validada com profissionais reais. “Ajuda a fazer o negócio funcionar” é uma síntese de trabalho, não um slogan aprovado.", { x: 0.6, y: 5.35, w: 12.1, h: 0.9, fontSize: 14, color: "BDBDB7" });
  notes(s, "A tese central. Deixar claro que é hipótese: ainda não entrevistamos profissionais. A frase 'ajuda a fazer o negócio funcionar' é de trabalho. O princípio do produto explica por que WhatsApp e voz importam: a interface principal é conversacional; o sistema de gestão fica por trás.");
}
{ // 4 dois lados
  const s = slide("LIGHT", "Estratégia", "Dois lados da mesma plataforma");
  card(s, 0.6, 1.6, 5.9, 4.5); card(s, 6.8, 1.6, 5.9, 4.5);
  T(s, "PARA PROFISSIONAIS", { x: 0.9, y: 1.85, w: 5.3, h: 0.3, fontSize: 12, bold: true, color: C.accent6, charSpacing: 1 });
  T(s, "Organização e crescimento", { x: 0.9, y: 2.2, w: 5.3, h: 0.5, fontSize: 22, bold: true });
  T(s, [{ text: "Agenda, disponibilidade e lista de espera", options: { bullet: true, breakLine: true } }, { text: "Clientes, histórico, orçamentos e atendimentos", options: { bullet: true, breakLine: true } },
    { text: "Contas a receber e visão gerencial simples", options: { bullet: true, breakLine: true } }, { text: "Lembretes, recorrência e reativação de clientes", options: { bullet: true, breakLine: true } },
    { text: "Assistente que consulta dados reais e pede aprovação", options: { bullet: true } }], { x: 0.9, y: 2.9, w: 5.3, h: 3.0, fontSize: 15, paraSpaceAfter: 6 });
  T(s, "PARA QUEM CONTRATA", { x: 7.1, y: 1.85, w: 5.3, h: 0.3, fontSize: 12, bold: true, color: C.accent6, charSpacing: 1 });
  T(s, "Descoberta e confiança", { x: 7.1, y: 2.2, w: 5.3, h: 0.5, fontSize: 22, bold: true });
  T(s, [{ text: "Encontrar profissionais locais", options: { bullet: true, breakLine: true } }, { text: "Entender o que fazem, onde atendem e quando têm horário", options: { bullet: true, breakLine: true } },
    { text: "Perfis, portfólios, indicações e avaliações", options: { bullet: true, breakLine: true } }, { text: "Pedir orçamento ou agendamento", options: { bullet: true, breakLine: true } },
    { text: "Avaliar e construir histórico de confiança", options: { bullet: true } }], { x: 7.1, y: 2.9, w: 5.3, h: 3.0, fontSize: 15, paraSpaceAfter: 6 });
  T(s, "Ambições futuras (não são funcionalidades): comunidade de indicação, parcerias com escolas, certificação com critérios verificáveis, equipes próprias treinadas. A marca precisa comportá-las sem prometê-las no lançamento.", { x: 0.6, y: 6.2, w: 12.1, h: 0.65, fontSize: 12, color: C.accent3 });
  notes(s, "Os dois lados. Começamos pelo aplicativo do prestador; o contratante é a visão. O marketplace depende de oferta, demanda, confiança e densidade local: condomínios são um laboratório proposto, não uma estratégia comercial fechada. As ambições futuras (escolas, certificação, equipes próprias) são direção, não produto.");
}
{ // 5 públicos
  const s = slide("LIGHT", "Estratégia", "Três públicos, três medos, uma resposta");
  const rows = [["Público", "O que quer", "O que teme", "O que precisa perceber"],
    ["Profissional", "Organização, tempo, demanda e controle", "Mais um sistema difícil, custo sem retorno, perda de autonomia", "Ajuda prática, respeito e clareza"],
    ["Contratante", "Encontrar alguém confiável e resolver o serviço", "Atraso, trabalho ruim, avaliações falsas, contratação confusa", "Evidência de competência e processo transparente"],
    ["Comunidade / condomínio", "Indicações organizadas e serviços recorrentes", "Spam, conflitos, falsa associação institucional", "Utilidade e regras claras"]];
  const hdr = { bold: true, color: C.background1, fill: { color: C.text1 }, fontFace: "Arial", fontSize: 14, valign: "middle" };
  const cell = (t, b) => ({ text: t, options: { fontFace: "Arial", fontSize: 14, color: C.text1, bold: !!b, valign: "middle", fill: { color: C.background1 } } });
  s.addTable(rows.map((r, i) => r.map((c, j) => i === 0 ? { text: c, options: hdr } : cell(c, j === 0))), { x: 0.6, y: 1.6, w: 12.1, colW: [2.2, 3.1, 3.7, 3.1], rowH: [0.5, 1.05, 1.05, 1.05], border: { type: "solid", color: "DEDED9", pt: 0.75 }, margin: [0.08, 0.12, 0.08, 0.12] });
  dot(s, 0.6, 5.55, 0.2);
  T(s, "A marca respeita o conhecimento técnico de quem trabalha. Nunca retrata o profissional como incapaz, atrasado ou alguém que precisa ser salvo pela tecnologia. “IA” não é diferencial: o benefício está no trabalho feito, na organização e na confiança.", { x: 0.95, y: 5.45, w: 11.7, h: 1.1, fontSize: 16 });
  notes(s, "Os três públicos e o que cada um teme. O ponto de tom: respeito ao ofício. Também: confiança visual não é garantia operacional; um selo bonito não prova verificação, habilitação ou seguro.");
}
{ // 6 posicionamento
  const s = slide("LIGHT", "Estratégia", "Posicionamento, promessa e seus limites");
  const cols = [["Posicionamento (proposta)", "Para profissionais autônomos de serviços e para quem os contrata. Gestão do trabalho com descoberta e reputação. Negócio organizado e profissional encontrável, sem aprender cinco sistemas."],
    ["Promessa (proposta)", "Menos tempo no administrativo, mais clareza sobre o negócio, e perfis em que cada informação tem um significado explícito."],
    ["O que não prometemos", "Agenda cheia, aumento de renda, qualidade garantida do serviço, habilitação profissional ou verificação de antecedentes. Um cadastro não prova nada disso."]];
  cols.forEach((c, i) => {
    const x = 0.6 + i * 4.1;
    card(s, x, 1.6, 3.9, 3.75);
    num(s, i + 1, x + 0.25, 1.85, 0.5);
    T(s, c[0], { x: x + 0.25, y: 2.5, w: 3.4, h: 0.5, fontSize: 18, bold: true });
    T(s, c[1], { x: x + 0.25, y: 3.05, w: 3.4, h: 2.2, fontSize: 14, color: C.accent3 });
  });
  card(s, 0.6, 5.55, 12.1, 1.15, { fill: { color: C.text1 }, line: { color: C.text1, width: 0 } });
  T(s, "Em uma frase: A Tinindo ajuda quem presta serviço a organizar o negócio e a ser encontrado, e ajuda quem contrata a escolher com clareza.", { x: 0.9, y: 5.65, w: 11.5, h: 0.95, fontSize: 18, bold: true, color: C.background1, valign: "middle" });
  notes(s, "Posicionamento e limites. A promessa é deliberadamente modesta: organização e clareza, não resultado financeiro. A descrição em uma frase está no rodapé; a de até 80 palavras está no manual.");
}
{ // 7 personalidade
  const s = slide("LIGHT", "Estratégia", "Personalidade: cinco atributos que viram decisões");
  const rows = [["Atributo", "Decisão visual", "Decisão verbal"],
    ["Competência acessível", "Hierarquia clara, preto firme, poucos elementos por tela", "Frases curtas, termos do ofício, sem jargão"],
    ["Proximidade sem infantilizar", "Sorriso no símbolo, em linha fina e preto adulto; sem mascote", "“Você”, sem gíria forçada nem diminutivo"],
    ["Tecnologia sofisticada, uso simples", "Vidro só em camadas flutuantes; movimento contido", "Explica o que o assistente fez e pede aprovação"],
    ["Trabalho bem-feito e organização", "Letras finas e precisas, alinhamento rigoroso", "“Em ordem”, “bem-feito”, números com contexto"],
    ["Orgulho profissional e autonomia", "Retratos dignos; o profissional é protagonista", "O profissional decide; a Tinindo ajuda"]];
  const hdr = { bold: true, color: C.background1, fill: { color: C.text1 }, fontFace: "Arial", fontSize: 14, valign: "middle" };
  const cell = (t, b) => ({ text: t, options: { fontFace: "Arial", fontSize: 14, color: C.text1, bold: !!b, valign: "middle", fill: { color: C.background1 } } });
  s.addTable(rows.map((r, i) => r.map((c, j) => i === 0 ? { text: c, options: hdr } : cell(c, j === 0))), { x: 0.6, y: 1.55, w: 12.1, colW: [3.2, 4.8, 4.1], rowH: [0.5, 0.85, 0.85, 0.85, 0.85, 0.85], border: { type: "solid", color: "DEDED9", pt: 0.75 }, margin: [0.06, 0.12, 0.06, 0.12] });
  notes(s, "Os cinco atributos vêm do briefing. O mais delicado é o segundo: queremos proximidade (sorriso) sem infantilizar, por isso o traço é fino e o preto é a cor-base.");
}

pres.addSection({ title: "Caminho da identidade" });
{ // 8 territórios
  const s = slide("LIGHT", "Caminho da identidade", "Começamos com três territórios, comparados nas mesmas situações");
  const f = pic(s, `${KIT}/research/territories/compare.png`, 7.0, 1.5, 5.7, "Comparativo dos três territórios");
  const items = [["A · Tudo em ordem", "T feito de blocos de agenda. Claro, mas parece software genérico."], ["B · Trabalho que merece indicação", "Arco com ponto. Maior nota na matriz inicial (7,80)."], ["C · Capricho com inteligência", "Versais finas e nobres. O fundador gostou da letra, não do símbolo."]];
  items.forEach((it, i) => { const y = 1.65 + i * 1.3; dot(s, 0.6, y + 0.07, 0.2); T(s, it[0], { x: 1.0, y, w: 6.0, h: 0.4, fontSize: 18, bold: true }); T(s, it[1], { x: 1.0, y: y + 0.42, w: 6.0, h: 0.75, fontSize: 14, color: C.accent3 }); });
  card(s, 0.6, 5.65, 6.4, 1.05, { fill: { color: C.text1 }, line: { color: C.text1, width: 0 } });
  T(s, "Feedback do fundador: gostou da letra fina do C, do pingo destacado nos “I” do A e do B, e pediu cor forte.", { x: 0.85, y: 5.72, w: 5.95, h: 0.9, fontSize: 14, bold: true, color: C.background1, valign: "middle" });
  notes(s, "Os três territórios iniciais (A, B, C) foram desenhados com mesmo conteúdo para comparação justa. Nota importante: a primeira versão do kit foi feita no território B; depois o fundador direcionou para outra linha. O kit B está arquivado na pasta de pesquisa.");
}
{ // 9 caminho
  const s = slide("DARK", "Caminho da identidade", "Como chegamos ao sorriso");
  const steps = [["Letra do C + pingos do A/B", "Versais finas, pingos dos “I” em destaque"], ["Cor forte e preto", "Quatro cores testadas; preto como base, laranja como destaque"],
    ["Cinco símbolos", "i, ii, T-teto, N, anel + ponto; mistura de “ii” com anel"], ["A ideia do sorriso", "Os pingos são olhos; o arco do “O” é a boca"], ["Refino", "Sorriso de 220°, cabeça inclinada 10°, corte em dentes de serra"]];
  steps.forEach((st, i) => { const y = 1.55 + i * 1.0; num(s, i + 1, 0.6, y + 0.05, 0.5); T(s, st[0], { x: 1.3, y, w: 4.6, h: 0.4, fontSize: 16, bold: true, color: C.background1 }); T(s, st[1], { x: 1.3, y: y + 0.4, w: 4.6, h: 0.55, fontSize: 12, color: "BDBDB7" }); });
  pic(s, `${KIT}/research/territories/e-preto-fino/sorriso/mais-feliz.png`, 6.2, 1.5, 3.2, "Passos para o sorriso mais feliz");
  pic(s, `${KIT}/research/territories/e-preto-fino/sorriso/maos.png`, 9.6, 1.5, 3.2, "Recortes no sorriso");
  T(s, "À esquerda: cinco passos para deixar o rosto mais feliz. À direita: quatro recortes no sorriso; o escolhido foi o de dentes de serra em duas cores (Z3).", { x: 6.2, y: 5.2, w: 6.6, h: 1.0, fontSize: 14, color: "BDBDB7" });
  notes(s, "O caminho foi conduzido pelo fundador: a ideia do sorriso (pingos como olhos e o 'O' como boca) foi dele. Nós testamos largura (180° e 220°), cor, e o que deixaria o rosto 'mais feliz': olhos maiores, sorriso mais grosso no meio, anel superior fino e inclinação. O recorte no meio do sorriso surgiu da observação de que, sem o anel, o sorriso parece duas pessoas se encontrando, o que serve ao marketplace.");
}

pres.addSection({ title: "Logotipo" });
{ // 10 conceito
  const s = slide("LIGHT", "Logotipo", "O conceito: gente que se encontra, com um sorriso");
  pic(s, `${KIT}/guidelines/fig-conceito.png`, 0.6, 1.5, 12.1, "Os três elementos do conceito");
  T(s, "Os dois pingos laranja dos “I” são o profissional e quem contrata. O “O” é o rosto, inclinado, com um sorriso largo. O corte no meio do sorriso lembra duas partes que se encaixam: um marketplace.", { x: 0.6, y: 5.5, w: 7.7, h: 1.2, fontSize: 16 });
  card(s, 8.6, 5.45, 4.1, 1.3, { fill: { color: C.text1 }, line: { color: C.text1, width: 0 } });
  T(s, "Proximidade sem mascote: o sorriso mora no símbolo; a interface não usa rostos decorativos.", { x: 8.8, y: 5.5, w: 3.7, h: 1.2, fontSize: 13, bold: true, color: C.background1, valign: "middle" });
  notes(s, "O conceito em três ideias. Vale mencionar o risco: rosto sorridente é um motivo comum e pode soar infantil; mitigamos com letras finas, preto adulto e a regra de que a interface não usa rostos decorativos. A nossa distinção em relação a marcas existentes ainda não foi pesquisada.");
}
{ // 11 anatomia
  const s = slide("LIGHT", "Logotipo", "Anatomia da palavra");
  card(s, 0.6, 1.5, 12.1, 2.85);
  pic(s, WM_LIGHT, 2.2, 1.85, 8.9, "Wordmark Tinindo");
  const parts = [["Versais finas e largas", "Precisão e acabamento; traço fino que pede ≥ 120 px de largura."], ["Pingos laranja nos dois “I”", "Duas pessoas; são os olhos do rosto do símbolo."], ["“O” inclinado 10°", "Mesmo desenho do símbolo. Cabeça levemente inclinada: simpatia."], ["Sorriso de 220° cortado ao meio", "Dentes de serra, metade laranja, metade preta: duas partes que se encaixam."]];
  parts.forEach((p, i) => { const x = 0.6 + i * 3.05; num(s, i + 1, x, 4.55, 0.45); T(s, p[0], { x, y: 5.1, w: 2.85, h: 0.7, fontSize: 15, bold: true }); T(s, p[1], { x, y: 5.75, w: 2.85, h: 1.1, fontSize: 13, color: C.accent3 }); });
  notes(s, "Anatomia. A palavra não é uma fonte: é lettering desenhado com geometria vetorial; só existem as letras T, I, N, D e O. O 'O' da palavra é exatamente o mesmo desenho do símbolo.");
}
{ // 12 símbolo e variantes
  const s = slide("LIGHT", "Logotipo", "O símbolo e suas variantes");
  const tiles = [["Principal (sem anel)", "tinindo-symbol-color.png", "FFFFFF"], ["Negativo", "tinindo-symbol-negativo-cor.png", "111111"], ["Com anel (uso grande)", "tinindo-symbol-anel-color.png", "FFFFFF"], ["Pequeno óptico (≤ 24 px)", "tinindo-symbol-pequeno-optico-color.png", "FFFFFF"], ["Uma cor (com fresta)", "tinindo-symbol-preto.png", "FFFFFF"]];
  tiles.forEach((t, i) => { const x = 0.6 + i * 2.45; s.addShape(pres.ShapeType.roundRect, { x, y: 1.6, w: 2.3, h: 2.3, rectRadius: 0.12, fill: { color: t[2] }, line: { color: "DEDED9", width: 0.75 } }); picH(s, `${KIT}/assets/logo/${t[1]}`, x + 0.35, 1.95, 1.6, t[0]); T(s, t[0], { x, y: 4.05, w: 2.3, h: 0.6, fontSize: 13, bold: true, align: "center" }); });
  T(s, [{ text: "Principal sem anel: é o que vai no ícone do app, no avatar e em tamanhos pequenos.", options: { bullet: true, breakLine: true } },
    { text: "A variante óptica tem corte reto, olhos e sorriso maiores, para sobreviver a 16 px.", options: { bullet: true, breakLine: true } },
    { text: "Em preto ou branco puro não há duas cores para separar as metades: o corte vira uma fresta fina.", options: { bullet: true } }], { x: 0.6, y: 4.85, w: 12.1, h: 1.8, fontSize: 15, paraSpaceAfter: 6 });
  notes(s, "Variantes do símbolo. A versão com anel só em tamanhos grandes; sem anel é a principal porque o rosto aberto também sugere duas pessoas se encontrando. A fresta é a solução para uma cor (serigrafia, bordado simples).");
}

pres.addSection({ title: "Cor, tipografia e produto" });
{ // 13 cores
  const s = slide("LIGHT", "Cor, tipografia e produto", "Paleta: preto como base, laranja como destaque");
  const sw = (x, y, w, h, hex, name, sub, fg) => { s.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.1, fill: { color: hex }, line: { color: "DEDED9", width: 0.75 } }); T(s, name, { x: x + 0.2, y: y + 0.15, w: w - 0.4, h: 0.35, fontSize: 16, bold: true, color: fg }); T(s, sub, { x: x + 0.2, y: y + h - 0.7, w: w - 0.4, h: 0.55, fontSize: 12, color: fg }); };
  sw(0.6, 1.55, 5.0, 2.7, "111111", "Tinta 950 · base da marca", "#111111 · RGB 17, 17, 17 · CMYK aprox. 0/0/0/93", "FFFFFF");
  sw(5.8, 1.55, 3.6, 2.7, "FF4B1F", "Laranja 500 · destaque", "#FF4B1F · RGB 255, 75, 31 · CMYK aprox. 0/71/88/0", "111111");
  sw(9.6, 1.55, 3.1, 2.7, "F7F7F5", "Papel 50 · fundo claro", "#F7F7F5 · RGB 247, 247, 245", "111111");
  sw(0.6, 4.45, 2.4, 1.1, "FF6A3D", "Laranja 400", "no escuro #FF6A3D", "111111");
  sw(3.2, 4.45, 2.4, 1.1, "B33008", "Laranja 700", "texto #B33008", "FFFFFF");
  sw(5.8, 4.45, 2.4, 1.1, "1C1C1A", "Tinta 900", "superfície escura", "FFFFFF");
  sw(8.4, 4.45, 2.1, 1.1, "62625D", "Tinta 500", "bordas de controle", "FFFFFF");
  sw(10.7, 4.45, 2.0, 1.1, "DEDED9", "Tinta 200", "bordas leves", "111111");
  T(s, "Funcionais (sucesso, atenção, erro, informação) ficam separadas da marca e sempre com ícone e texto. CMYK é aproximação; não há equivalência Pantone. Laranja vivo exige prova impressa.", { x: 0.6, y: 5.85, w: 12.1, h: 0.85, fontSize: 13, color: C.accent3 });
  notes(s, "A paleta. O preto é a marca (adulto, firme), o laranja é a cor forte que o fundador pediu, usado como destaque. Proporção sugerida: cerca de 70% papel/tinta, 25% neutros, até 5% laranja.");
}
{ // 14 regras de cor
  const s = slide("DARK", "Cor, tipografia e produto", "Regras de cor, com números");
  const stats = [["17,6:1", "Wordmark preto sobre papel", "ok"], ["5,65:1", "Preto sobre laranja (fundo laranja com logo preto)", "ok"], ["3,12:1", "Laranja como texto sobre papel", "PROIBIDO"]];
  stats.forEach((st, i) => { const x = 0.6 + i * 4.1; darkCard(s, x, 1.55, 3.9, 2.1); T(s, st[0], { x: x + 0.25, y: 1.7, w: 3.4, h: 0.9, fontSize: 44, bold: true, color: st[2] === "ok" ? C.background1 : "FF6A3D" }); T(s, st[1], { x: x + 0.25, y: 2.65, w: 3.4, h: 0.5, fontSize: 13, color: "BDBDB7" }); T(s, st[2], { x: x + 0.25, y: 3.2, w: 3.4, h: 0.3, fontSize: 12, bold: true, color: st[2] === "ok" ? "7CCB99" : "FF6A3D" }); });
  const rules = ["A ação principal da interface é preta. Laranja não é cor de botão.", "Laranja não é cor de estado (erro vermelho, atenção âmbar): evita confundir marca com alerta.", "Laranja nunca é cor de texto corrido; texto em destaque usa laranja 700.", "Sorriso em laranja claro ou cinza claro foi testado e rejeitado: 1,8:1 a 2,0:1, some no fundo claro.", "Estado, avaliação e disponibilidade nunca só por cor: sempre ícone e texto."];
  rules.forEach((r, i) => { const y = 3.95 + i * 0.5; dot(s, 0.6, y + 0.1, 0.16); T(s, r, { x: 0.95, y, w: 11.7, h: 0.45, fontSize: 14, color: C.background1, valign: "middle" }); });
  notes(s, "Regras de cor. Os 36 pares semânticos (claro e escuro) passam nos limiares de contraste calculados por script. Risco aceito: o âmbar de atenção e o vermelho de erro ficam perto do laranja da marca; por isso o laranja é decorativo e todo estado vem com ícone e rótulo.");
}
{ // 15 tipografia
  const s = slide("LIGHT", "Cor, tipografia e produto", "Tipografia: letras próprias no logotipo, Inter na interface");
  pic(s, `${KIT}/guidelines/fig-tipografia.png`, 0.6, 1.55, 7.4, "Especimene Inter com acentos e números");
  T(s, [{ text: "Wordmark é lettering próprio, não uma fonte.", options: { bullet: true, breakLine: true } }, { text: "Interface: Inter e Inter Display (licença OFL 1.1, verificada no pacote local).", options: { bullet: true, breakLine: true } },
    { text: "Pesos: 400, 500, 600; 700 só em títulos grandes.", options: { bullet: true, breakLine: true } }, { text: "Rótulos em caixa-alta com espaçamento: ecoam as versais do wordmark.", options: { bullet: true, breakLine: true } },
    { text: "Números de agenda, preço e indicador em tabulares.", options: { bullet: true, breakLine: true } }, { text: "Português verificado: ação, João, terça-feira, R$ 1.250,00.", options: { bullet: true } }], { x: 8.3, y: 1.6, w: 4.4, h: 4.4, fontSize: 14, paraSpaceAfter: 8 });
  T(s, "Não incorporamos fontes proprietárias da Apple. Nesta apresentação usamos Arial por segurança de compatibilidade.", { x: 0.6, y: 5.35, w: 7.4, h: 0.7, fontSize: 12, color: C.accent3 });
  notes(s, "Tipografia. Uma família variável para reduzir custo de carregamento. O wordmark é independente da fonte de interface.");
}
{ // 16 ícone, avatar, favicon
  const s = slide("LIGHT", "Logotipo", "Ícone do app, avatar de WhatsApp e favicon");
  card(s, 0.6, 1.55, 4.0, 4.4); picH(s, `${KIT}/assets/app-icons/app-icon-rounded-preview.png`, 1.2, 1.85, 2.8, "Ícone do app"); T(s, "Ícone do app", { x: 0.8, y: 4.85, w: 3.6, h: 0.35, fontSize: 15, bold: true, align: "center" }); T(s, "Fundo preto; símbolo sem anel, inclinado, em 58% do lado. A plataforma aplica a máscara.", { x: 0.8, y: 5.2, w: 3.6, h: 0.7, fontSize: 12, color: C.accent3, align: "center" });
  card(s, 4.85, 1.55, 4.0, 4.4); picH(s, `${KIT}/assets/app-icons/avatar-whatsapp-claro.png`, 5.35, 1.85, 1.5, "Avatar claro", { rounding: true }); picH(s, `${KIT}/assets/app-icons/avatar-whatsapp-escuro.png`, 6.95, 1.85, 1.5, "Avatar escuro", { rounding: true }); T(s, "Avatar de WhatsApp", { x: 5.05, y: 3.6, w: 3.6, h: 0.35, fontSize: 15, bold: true, align: "center" }); T(s, "Recorte circular com margem de segurança: o símbolo ocupa 50% do lado. Versões clara e escura.", { x: 5.05, y: 4.0, w: 3.6, h: 0.8, fontSize: 12, color: C.accent3, align: "center" });
  card(s, 9.1, 1.55, 3.6, 4.4); picH(s, `${KIT}/assets/icons/favicon-48.png`, 9.4, 1.9, 0.48, "Favicon 48"); picH(s, `${KIT}/assets/icons/favicon-32.png`, 10.1, 1.9, 0.32, "Favicon 32"); picH(s, `${KIT}/assets/icons/favicon-16.png`, 10.65, 1.9, 0.16, "Favicon 16");
  picH(s, `${KIT}/assets/logo/tinindo-symbol-pequeno-optico-color.png`, 9.4, 2.7, 1.6, "Variante óptica ampliada");
  T(s, "Favicon e ícones pequenos", { x: 9.3, y: 4.45, w: 3.2, h: 0.35, fontSize: 15, bold: true }); T(s, "Variante óptica: corte reto, olhos e sorriso maiores. Reconhecível a 16 px; o lado direito troca para branco no tema escuro.", { x: 9.3, y: 4.85, w: 3.2, h: 1.0, fontSize: 12, color: C.accent3 });
  notes(s, "Itens para o dia a dia: ícone do app, avatar (testado em recorte circular) e favicon. O favicon.ico ainda não foi gerado (será feito no build do produto).");
}
{ // 17 usos
  const s = slide("LIGHT", "Logotipo", "Como usar: proteção, tamanhos mínimos e o que evitar");
  pic(s, `${KIT}/guidelines/fig-area-protecao.png`, 0.6, 1.5, 5.0, "Área de proteção");
  T(s, "Área de proteção: raio do “O” em todos os lados.", { x: 0.6, y: 4.0, w: 5.2, h: 0.4, fontSize: 14, bold: true });
  pic(s, `${KIT}/guidelines/fig-escalas.png`, 0.6, 4.75, 5.4, "Teste de escalas");
  T(s, "Mínimos medidos em pixels reais: wordmark 120 px de largura; símbolo 16 px (variante óptica) e 32 px. Abaixo de 120 px, use o símbolo.", { x: 0.6, y: 5.85, w: 5.4, h: 0.9, fontSize: 12, color: C.accent3 });
  T(s, "O que evitar", { x: 6.6, y: 1.5, w: 6, h: 0.4, fontSize: 18, bold: true });
  T(s, "Não distorcer, girar a palavra, aplicar sombra ou vidro, recolorir, usar sobre fundo movimentado nem abaixo do mínimo. Nunca endireitar o “O” nem inverter as metades do sorriso.", { x: 6.6, y: 1.95, w: 6.1, h: 1.3, fontSize: 14, color: C.accent3 });
  pic(s, `${KIT}/guidelines/fig-uso-incorreto.png`, 6.6, 3.4, 6.1, "Uso incorreto");
  notes(s, "Regras de aplicação. A medida mais importante: a palavra, por ser fina, precisa de 120 px. Para tamanhos menores, o símbolo faz o trabalho.");
}
{ // 18 vitrine
  const s = slide("LIGHT", "Cor, tipografia e produto", "O produto com a identidade: vitrine de demonstração");
  pic(s, `${IMG}/ui_home.png`, 0.6, 1.5, 5.7, "Página inicial");
  picH(s, `${IMG}/ui_agenda.png`, 6.6, 1.5, 4.7, "Agenda do prestador");
  T(s, [{ text: "Página inicial com os dois públicos: “Para profissionais” e “Encontre um profissional”.", options: { bullet: true, breakLine: true } }, { text: "Agenda com estados por ícone e texto: confirmado, aguardando, cancelado, bloqueado e livre.", options: { bullet: true, breakLine: true } },
    { text: "Ação principal preta; laranja só como destaque.", options: { bullet: true, breakLine: true } }, { text: "Tema claro e escuro, responsivo, dados fictícios rotulados.", options: { bullet: true } }], { x: 0.6, y: 4.75, w: 5.8, h: 2.05, fontSize: 14, paraSpaceAfter: 6 });
  notes(s, "A vitrine é HTML navegável (applications/preview.html). Todo nome, valor e avaliação é fictício e rotulado. Os componentes seguem os tokens: cores, tipografia e espaçamentos vêm de tokens.css.");
}
{ // 19 confiança
  const s = slide("LIGHT", "Cor, tipografia e produto", "Reputação com significado explícito");
  pic(s, `${IMG}/ui_fatos.png`, 0.6, 1.55, 12.1, "Quatro informações separadas no perfil");
  const items = [["Quatro coisas diferentes", "Identidade verificada, avaliação de cliente, serviço feito pela plataforma e formação não implicam umas às outras."], ["Patrocinado é patrocinado", "Anúncio pago traz o rótulo “Patrocinado”: a posição não indica melhor avaliação."], ["Perfil novo é honesto", "“Perfil novo · ainda sem avaliações”. Todo profissional começa assim."], ["Sem selo “Tinindo garante”", "Só existiria com política e operação correspondentes."]];
  items.forEach((it, i) => { const x = 0.6 + (i % 2) * 6.15, y = 3.3 + Math.floor(i / 2) * 1.6; card(s, x, y, 5.95, 1.45); dot(s, x + 0.25, y + 0.25, 0.2); T(s, it[0], { x: x + 0.65, y: y + 0.15, w: 5.1, h: 0.4, fontSize: 16, bold: true }); T(s, it[1], { x: x + 0.65, y: y + 0.6, w: 5.1, h: 0.8, fontSize: 13, color: C.accent3 }); });
  notes(s, "Confiança. O perfil mostra quatro informações com significados próprios. No protótipo nenhum selo é concedido; apenas ilustramos os estados.");
}
{ // 20 assistente
  const s = slide("DARK", "Cor, tipografia e produto", "O assistente consulta, recomenda e pede aprovação");
  picH(s, `${IMG}/ui_aprovacao.png`, 0.6, 1.5, 4.8, "Diálogo de aprovação do agente");
  const st = [["Informação consultada", "diz de onde veio o dado"], ["Recomendação", "não executa nada"], ["Ação pendente de aprovação", "destinatários, texto, desconto, custo estimado e horário"], ["Ação executada", "no protótipo: “simulada”, nada enviado de verdade"], ["Falha", "diz o que não aconteceu e oferece alternativa"]];
  st.forEach((x, i) => { const y = 1.55 + i * 0.95; num(s, i + 1, 7.2, y + 0.05, 0.5); T(s, x[0], { x: 7.9, y, w: 4.8, h: 0.4, fontSize: 16, bold: true, color: C.background1 }); T(s, x[1], { x: 7.9, y: y + 0.4, w: 4.8, h: 0.5, fontSize: 13, color: "BDBDB7" }); });
  notes(s, "O assistente distingue cinco estados. Na simulação nunca se diz 'mensagem enviada'. Os dados são fictícios. O exemplo da proposta ('há três horários livres na terça') mostra como o consentimento dos clientes é respeitado: só recebem os que autorizaram.");
}
pres.addSection({ title: "Aplicações, voz e próximos passos" });
{ // 21 aplicações 1
  const s = slide("LIGHT", "Aplicações, voz e próximos passos", "Aplicações: cartão de indicação e uniforme");
  pic(s, `${IMG}/pecas_top.png`, 0.6, 1.5, 12.1, "Cartão de indicação e uniforme");
  T(s, "Bordado em duas cores exige dois fios; versão de uma cor usa fresta. Mínimos de bordado (30 mm símbolo, 60 mm palavra) são hipótese, ainda não testada com bordadeira real.", { x: 0.6, y: 6.0, w: 12.1, h: 0.8, fontSize: 13, color: C.accent3 });
  notes(s, "Cartão e uniforme. Contatos são marcadores entre colchetes. Antes de produzir em lote é preciso prova de bordado e de impressão.");
}
{ // 22 aplicações 2
  const s = slide("LIGHT", "Aplicações, voz e próximos passos", "Aplicações: cartaz de condomínio e avatar");
  picH(s, `${IMG}/pecas_bottom.png`, 0.6, 1.5, 4.3, "Cartaz e avatar");
  T(s, [{ text: "O cartaz declara que não é comunicado do condomínio nem aval da administração.", options: { bullet: true, breakLine: true } }, { text: "Contatos e QR code são marcadores; nada é real.", options: { bullet: true, breakLine: true } },
    { text: "O avatar foi testado em recorte circular.", options: { bullet: true } }], { x: 0.6, y: 5.95, w: 12.1, h: 0.9, fontSize: 13, paraSpaceAfter: 3 });
  notes(s, "Peça para condomínio: o risco aqui é sugerir associação institucional que não existe; por isso o aviso está no próprio cartaz.");
}
{ // 23 voz
  const s = slide("LIGHT", "Aplicações, voz e próximos passos", "Voz: adulta, próxima, sem promessa exagerada");
  const rows = [["Situação", "Usar", "Evitar"],
    ["Profissional", "“Organize o negócio. Continue no seu ofício.”", "“Revolucione seu negócio com IA!”"],
    ["Proposta do agente", "“Há três horários livres na terça. Posso preparar uma mensagem. Você revisa antes do envio.”", "“Já mandei mensagem para todo mundo.”"],
    ["Perfil sem avaliações", "“Perfil novo · ainda sem avaliações.”", "“Contrate por sua conta e risco.”"]];
  const hdr = { bold: true, color: C.background1, fill: { color: C.text1 }, fontFace: "Arial", fontSize: 13, valign: "middle" };
  const cell = (t, b) => ({ text: t, options: { fontFace: "Arial", fontSize: 13, color: C.text1, bold: !!b, valign: "middle", fill: { color: C.background1 } } });
  s.addTable(rows.map((r, i) => r.map((c, j) => i === 0 ? { text: c, options: hdr } : cell(c, j === 0))), { x: 0.6, y: 1.55, w: 7.6, colW: [1.7, 3.5, 2.4], rowH: [0.45, 0.8, 1.1, 0.8], border: { type: "solid", color: "DEDED9", pt: 0.75 }, margin: [0.06, 0.1, 0.06, 0.1] });
  T(s, "Assinaturas (nenhuma aprovada)", { x: 8.6, y: 1.5, w: 4.1, h: 0.4, fontSize: 15, bold: true });
  const sg = ["Serviço bem-feito, negócio em ordem.", "Seu trabalho bem-feito. Seu negócio em dia.", "Você faz o serviço. A Tinindo ajuda no resto.", "Trabalho bem-feito merece ser encontrado.", "Gente que faz bem-feito, gente que se encontra."];
  sg.forEach((x, i) => { const y = 2.15 + i * 0.72; if (i === 0) card(s, 8.55, y - 0.05, 4.15, 0.65, { fill: { color: C.text1 }, line: { color: C.text1, width: 0 } }); if (i === 0) dot(s, 8.7, y + 0.12, 0.16); else num(s, i + 1, 8.65, y + 0.02, 0.36); T(s, x, { x: 9.15, y, w: 3.45, h: 0.55, fontSize: 13, bold: i === 0, color: i === 0 ? C.background1 : C.text1, valign: "middle" }); });
  T(s, "Recomendação provisória: a 1ª, que ecoa o sentido de “tinindo”, serve aos dois lados e não promete resultado financeiro. Falta validar com o público.", { x: 0.6, y: 5.45, w: 7.6, h: 1.0, fontSize: 13, color: C.accent3 });
  notes(s, "Voz e assinatura. O manual traz nove situações com usar/evitar; aqui mostramos três. Nenhuma assinatura foi aprovada; a primeira é só a recomendação provisória.");
}
{ // 24 riscos
  const s = slide("DARK", "Aplicações, voz e próximos passos", "O que ainda não sabemos");
  const r = [["Jurídico", "Consulta de 02/10 (relatada, não reverificada): 3M Company tem registros exatos TININDO nas classes 03 e 21. Domínio não libera a marca. Sem parecer."], ["Pesquisa de mercado", "Não feita (sem acesso à rede). Distinção em relação a concorrentes e a marcas com sorriso é hipótese."], ["Rosto sorridente", "Motivo comum; pode soar infantil. Mitigação: letras finas, preto adulto, sem sorrisos decorativos. Não testado com pessoas."], ["Traço fino", "A palavra só funciona a partir de 120 px. Abaixo disso, usar o símbolo."], ["Duas cores e corte", "Bordado e impressão precisam de prova; o corte ainda não está unido em contorno único."], ["Acessibilidade", "Contraste medido; teclado, leitor de tela e zoom ainda não testados. Sem declaração de conformidade."]];
  r.forEach((x, i) => { const cx = 0.6 + (i % 3) * 4.1, cy = 1.55 + Math.floor(i / 3) * 2.65; darkCard(s, cx, cy, 3.9, 2.5); num(s, i + 1, cx + 0.25, cy + 0.2, 0.45); T(s, x[0], { x: cx + 0.85, y: cy + 0.22, w: 2.9, h: 0.4, fontSize: 16, bold: true, color: C.background1 }); T(s, x[1], { x: cx + 0.25, y: cy + 0.85, w: 3.4, h: 1.55, fontSize: 12, color: "BDBDB7" }); });
  notes(s, "Seção de honestidade. O ponto mais crítico é o jurídico: há registros exatos do nome em classes de limpeza e utensílios, de outra empresa. Nenhuma alteração de design elimina esse risco; precisa de um advogado de propriedade industrial.");
}
{ // 25 avaliação
  const s = slide("LIGHT", "Aplicações, voz e próximos passos", "Avaliação pela mesma matriz: sorriso e território B");
  const labels = ["Adequação (20%)", "Distinção (20%)", "Pequenas escalas (15%)", "Memorização (15%)", "Reprodução (15%)", "Expansão (10%)", "Coerência (5%)"];
  s.addChart(pres.charts.BAR, [{ name: "Território B (arco e ponto)", labels, values: [8, 7, 8, 8, 8, 8, 8] }, { name: "Sorriso (escolhido)", labels, values: [8, 5, 6, 9, 6, 7, 8] }], {
    x: 0.6, y: 1.5, w: 7.8, h: 5.1, barDir: "bar", barGapWidthPct: 60, chartColors: ["BDBDB7", "FF4B1F"], showLegend: true, legendPos: "b", legendFontSize: 12, legendFontFace: "+mn-lt",
    showTitle: true, title: "Notas de 0 a 10 (julgamento de design)", titleFontSize: 14, titleFontFace: "+mn-lt", showValue: true, dataLabelFontSize: 11, dataLabelFontFace: "+mn-lt", dataLabelPosition: "outEnd",
    catAxisLabelFontSize: 12, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontSize: 11, valAxisLabelFontFace: "+mn-lt", valAxisMinVal: 0, valAxisMaxVal: 10, valGridLine: { color: "DEDED9", size: 0.5 }, catGridLine: { style: "none" }, catAxisOrientation: "maxMin" });
  card(s, 8.7, 1.55, 4.0, 1.5, { fill: { color: C.text1 }, line: { color: C.text1, width: 0 } });
  T(s, "7,80 × 6,85", { x: 8.95, y: 1.65, w: 3.5, h: 0.7, fontSize: 32, bold: true, color: C.background1 }); T(s, "Nota ponderada: B × sorriso", { x: 8.95, y: 2.4, w: 3.5, h: 0.5, fontSize: 13, color: "BDBDB7" });
  T(s, [{ text: "O sorriso perde em distinção e reprodução.", options: { bullet: true, breakLine: true } }, { text: "Ganha em memorização e emoção.", options: { bullet: true, breakLine: true } }, { text: "Os riscos são tratáveis com regras: mínimos, variante óptica e fresta.", options: { bullet: true, breakLine: true } }, { text: "Não substitui pesquisa nem diligência jurídica.", options: { bullet: true } }], { x: 8.7, y: 3.3, w: 4.0, h: 3.0, fontSize: 14, paraSpaceAfter: 6 });
  notes(s, "A matriz é julgamento de design, não pesquisa de mercado, e o território B recebeu mais iterações (viés de autoria). A escolha do sorriso é do fundador; a matriz só mostra onde precisamos de cuidado.");
}
{ // 26 próximos passos
  const s = slide("LIGHT", "Aplicações, voz e próximos passos", "Decisões e próximos passos");
  card(s, 0.6, 1.55, 5.9, 5.0); card(s, 6.8, 1.55, 5.9, 5.0);
  T(s, "Decisões para fundador e sócio", { x: 0.9, y: 1.75, w: 5.3, h: 0.45, fontSize: 20, bold: true });
  const d = ["Aprovar ou ajustar a identidade “sorriso” (preto e laranja)", "Autorizar a diligência jurídica do nome (advogado de PI)", "Escolher uma assinatura verbal, ou pedir outras", "Indicar o repositório da Tinindo para guardar o kit", "Autorizar pesquisa de referências com navegação"];
  d.forEach((x, i) => { const y = 2.4 + i * 0.8; num(s, i + 1, 0.9, y, 0.42); T(s, x, { x: 1.5, y: y - 0.05, w: 4.8, h: 0.7, fontSize: 14, valign: "middle" }); });
  T(s, "Próximos passos propostos", { x: 7.1, y: 1.75, w: 5.3, h: 0.45, fontSize: 20, bold: true });
  const n = ["Unir o corte do sorriso em contorno único (editor vetorial)", "Pedir provas de impressão e de bordado", "Testar o logotipo com 5 a 10 profissionais e contratantes (hipótese de amostra)", "Pesquisa de referências e de marcas com sorriso", "Auditoria de acessibilidade com teclado e leitor de tela", "Construir o produto no Lovable/GitHub usando os tokens"];
  n.forEach((x, i) => { const y = 2.4 + i * 0.68; dot(s, 7.1, y + 0.1, 0.18); T(s, x, { x: 7.45, y: y - 0.05, w: 5.1, h: 0.6, fontSize: 14, valign: "middle" }); });
  notes(s, "Decisões e próximos passos. Nenhuma compra, publicação ou registro foi feito. Tudo o que está no kit é provisório até a aprovação de vocês e a análise jurídica.");
}
{ // 27 anexo
  const s = slide("DARK", "Aplicações, voz e próximos passos", "Anexo: o que está no pacote de arquivos");
  const tree0 = ["tinindo-brand/", "  BRAND.md  DECISIONS.md  STATUS.md  LICENSES.md", "  guidelines/   manual de marca (md, html, pdf)", "  assets/       logo/  icons/  app-icons/", "  tokens/       tokens.json  tokens.css", "  applications/ preview.html  pieces.html", "  apresentacao/ esta apresentação (pptx)", "  handoff/      Lovable, Claude Code, Codex,", "                Canva e Figma", "  research/     territórios, matriz, referências"];
  const tree = tree0;
  darkCard(s, 0.6, 1.55, 7.6, 4.2);
  T(s, tree.join("\n"), { x: 0.85, y: 1.7, w: 7.2, h: 3.9, fontFace: "Courier New", fontSize: 13, color: C.background1, lineSpacingMultiple: 1.25 });
  T(s, [{ text: "Logotipos em SVG vetorial real e PNG.", options: { bullet: true, breakLine: true } }, { text: "Tokens JSON e CSS com os mesmos nomes e valores.", options: { bullet: true, breakLine: true } }, { text: "Regras para humanos e agentes de código em BRAND.md.", options: { bullet: true, breakLine: true } }, { text: "Nada foi publicado, comprado ou registrado.", options: { bullet: true } }], { x: 8.5, y: 1.6, w: 4.2, h: 4.0, fontSize: 14, color: C.background1, paraSpaceAfter: 8 });
  notes(s, "Estrutura do pacote entregue. O GitHub deve guardar os ativos e regras portáteis; Figma e Canva complementam, mas não são a única fonte.");
}

(async () => {
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("ok", OUT);
})();

# ADR-0026 · Fiscal seletivo: NFS-e num caso elegível (P16)

Status: aceita · 2026-10-24 · integrador (onda 3, PR 3; `docs/plano-onda-3.md`)

## Decisões

1. **Um caso elegível no piloto: MEI, NFS-e padrão nacional.** Itens de serviço suportados: 06.01 (barbearia, cabeleireiros e afins) e 06.04 (atividades físicas, personal). Sem cálculo de imposto aqui: no MEI o ISS vai no DAS e a nota sai sem retenção. Outros regimes aparecem como "fora do caso elegível" com o motivo, nunca como erro.
2. **Elegibilidade decidida no servidor, com motivos** (`app.fsc_eligibility`): `profile_missing`, `regime_not_eligible`, `cnpj_invalid` (dígitos verificadores), `representation_missing`, `credential_invalid`. Fora do caso elegível nada é enviado ao provedor.
3. **Representação por hash dos termos.** O dono autoriza a Tinindo a emitir em nome dele citando o hash do texto que leu (`app.fsc_terms`); validade de 30 a 365 dias; revogável (não cancela notas emitidas). Mudar o texto é migration e invalida as autorizações antigas.
4. **Credencial fica no provedor.** O certificado ou a procuração são cadastrados pelo prestador direto no provedor fiscal; a Tinindo só pergunta ao provedor o status (`fiscal.credential_check` → backend grava `fiscal_credentials`). Nenhum certificado, senha ou PFX é guardado ou trafega pela Tinindo.
5. **Homologação antes de produção.** O ambiente é decidido no banco: produção só com caso homologado (nota autorizada em homologação) **e** `production_enabled`, que nenhuma RPC do app liga (só service_role, por decisão humana). Trocar o CNPJ desliga a produção. A credencial precisa ser do ambiente em uso.
6. **Emitir não é receber.** Nenhuma função fiscal escreve em recebível, recebimento ou caixa (teste de contrato varre a migration). A nota pode citar o recebível (uma nota viva por recebível; cancelada ou rejeitada libera outra) e não pode passar o valor dele.
7. **Provedor atrás de porta; incerto não é reenviado.** O banco grava o pedido (`submitting`, referência `nfse:<id>`) e devolve o pedido só na primeira chamada (replay não reenvia). Rede caída ou 5xx → `unknown`; o `fiscal.sync` (cron com segredo) consulta pela referência as incertas, em processamento ou presas no envio, e grava o resultado. Resposta atrasada não desfaz estado final. Cancelamento: o dono pede com motivo; o provedor cancela ou recusa (recusado → continua autorizada, com o motivo na linha do tempo).
8. **Adaptadores:** simulado só para homologação (determinístico, rotulado, usado na demonstração e nos testes) e REST genérico desligado sem `FISCAL_PROVIDER_URL`/`FISCAL_PROVIDER_KEY` (o contrato exato depende do provedor escolhido).
9. **Pasta do contador:** `fiscal.folder(mês)` por competência, com totais (cancelada aparece e não soma); a tela baixa CSV. O documento do tomador só sai mascarado nas leituras; o completo vai apenas ao provedor na emissão.

## Contrato (aditivo)

Módulo `fiscal`: `fiscal.get`, `fiscal.profile_save`, `fiscal.representation`, `fiscal.credential_check`, `fiscal.emit`, `fiscal.cancel`, `fiscal.folder`; rota de sistema `fiscal.sync` (segredo). Evento `fiscal.document.authorized.v1`.

## Pendências do dono do projeto

Escolha e contrato do provedor fiscal (homologação e produção), revisão dos termos de representação por contador/jurídico, decisão de liberar produção por negócio (registro no `release/CHECKLIST`), cron do `fiscal.sync`.

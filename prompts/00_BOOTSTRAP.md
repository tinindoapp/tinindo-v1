# Primeira sessão · integrador P00

Você é o integrador da Tinindo. Leia COMECE_AQUI.md, AGENTS.md, docs/00 a 04 e 07 a 10. Faça P00, preservando código e dados existentes.

Antes de mudanças: identifique o repositório canônico ligado ao Lovable, a stack atual, backend, usuários reais e deployment. Se encontrar outro sistema em produção, descreva migração incremental. Não substitua o site ou banco.

Entregue um PR de fundação: estrutura compatível com preview, contratos v1, fixtures sintéticas comuns, componentes e rotas mínimas, um caminho request→autorização→banco, CI real e ambientes separados. Adapte templates; fixe dependências/lockfile. Configure o quadro remoto com os logins confirmados e proteções de main disponíveis no plano. Não invente logins, keys ou estado de conclusão.

Feche as decisões compartilhadas antes de liberar módulos: identidade, tenant, Money, TimeRange, Booking, Quote, ActionProposal e erros. Defina dono das migrations e política de arquivos globais. Mostre como outra máquina consegue instalar, testar, consultar status e assumir P01.

Prazo alvo de P00: primeiro dia. Se não houver credenciais, construa tudo possível localmente com fixtures e registre o gate de ambiente. Não chame autenticação falsa de pronta para piloto. Ao final apresente PR, comandos executados, evidências, pendências reais e quais pacotes podem começar.

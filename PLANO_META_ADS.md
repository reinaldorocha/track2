# Plano de correção do Meta Ads

## Acompanhamento da execução

- [x] Paginação de contas, campanhas, conjuntos, anúncios e insights.
- [x] Importação de 95 dias e uso do fuso da conta na solicitação dos insights.
- [x] Sync parcial registrado; último sync válido preservado.
- [x] API de tabelas filtra veiculação e separa vendas Track2 de compras Meta.
- [x] IC e receita líquida sem estimativas; dado sem cobertura fica vazio.
- [x] Atualização automática na VPS, status e erro na tela.
- [x] Seleção hierárquica e filtros completos na interface.
- [x] Totais e moedas na interface.
- [x] Testes automatizados, lint dos arquivos alterados, checagem de tipos, schema PostgreSQL e build local.
- [ ] Comparação com Meta e PostgreSQL de produção.
- [x] PR #2 aberto em rascunho com código, testes e limitações documentadas.

## Diagnóstico verificável

Em 01/10/2026, o SQLite local tinha uma conta BRL em `America/Sao_Paulo`, dois registros de campanha, nenhum conjunto ou anúncio e 30 linhas de insight de campanha. O último sync registrado era 29/09/2026 às 20:18:52 UTC. A conta local não possui token utilizável para consultar a Meta; portanto, esses números não validam o PostgreSQL de produção nem permitem comparar com o Gerenciador. Nenhuma métrica de produção foi presumida.

Para repetir a comparação com acesso à conta, executar `npx tsx --env-file=.env scripts/meta-audit.ts` em um ambiente autorizado. O script imprime somente agregados por conta e período (Hoje, Ontem, 30 dias), sem imprimir token ou pedido. Comparar os agregados com o Gerenciador na mesma conta, fuso e configuração de atribuição. Para a VPS, configurar `CRON_SECRET` em `.env.production` e subir `utm-track` e `meta-cron` pelo Compose. O arquivo `.env.production` não existe nesta cópia local; o Compose não pôde ser executado aqui.

## Objetivo

Tornar a coleta, os filtros e os indicadores do Meta Ads confiáveis nos níveis de campanha, conjunto e anúncio. Implementar em um novo PR a partir da `main`, preservando as partes úteis do commit `7f4dbbb` (coleta de insights por nível e deduplicação de compras da Meta).

## Regra obrigatória para dados ausentes

- Nunca criar vendas, inícios de checkout, receita, custo, lucro ou qualquer outra métrica por heurística.
- Distinguir **zero medido** de **dado ausente**. Exibir `0` apenas quando a fonte confirmou zero; exibir `—` quando a fonte não forneceu o dado ou a importação estiver incompleta.
- Não substituir receita líquida ausente por uma porcentagem da receita bruta. Não calcular IC a partir de vendas.
- Indicadores dependentes de um dado ausente também ficam `—`. A interface deve explicar a ausência sem sugerir que o valor é zero.
- Não preencher lacunas da Meta com dados de gateway silenciosamente, nem o contrário. Identificar a origem de cada métrica.

## Etapa 1 — Referência e diagnóstico

1. Selecionar uma conta conectada e comparar Track2, Gerenciador da Meta e pedidos registrados no banco para Hoje, Ontem e últimos 30 dias.
2. Registrar quantidade de campanhas, conjuntos, anúncios e linhas de insight; último sync; moeda e fuso da conta; gasto, impressões e compras por período.
3. Classificar divergências como importação incompleta, período/fuso, atribuição, moeda ou cálculo. Não tratar diferença de atribuição como erro de importação sem evidência.

**Saída:** exemplos verificáveis para reproduzir as falhas e validar a correção. Não copiar tokens ou dados pessoais para o PR.

## Etapa 2 — Coleta e sincronização

1. Percorrer todas as páginas da API da Meta para contas, campanhas, conjuntos, anúncios e insights. Não encerrar na primeira página de 500 linhas.
2. Importar o histórico necessário para os períodos disponíveis (incluindo 60, 90 dias e mês anterior) e atualizar incrementalmente os dias recentes.
3. Usar o fuso da conta de anúncios para solicitar e armazenar os dias dos insights. Usar instantes UTC correspondentes a esse fuso para consultar pedidos.
4. Garantir atualização automática na instalação VPS e uma atualização manual explícita na tela.
5. Registrar sucesso ou falha por conta, nível e intervalo. Uma falha de insights de conjuntos ou anúncios torna o sync parcial, nunca sucesso completo.
6. Exibir último sync válido, período coberto e erro de importação. Permitir nova tentativa sem apagar dados válidos.

**Aceite:** Hoje e Ontem são consultados nas datas corretas; páginas adicionais aparecem; falha parcial é visível; período sem importação não é exibido como zero medido.

## Etapa 3 — Exibição, filtros e navegação

1. Por padrão, mostrar somente itens com impressões ou gasto medidos no período selecionado. Status `ACTIVE` sozinho não prova veiculação.
2. Aplicar conta, status, busca e período igualmente aos três níveis. Corrigir o filtro de conta na aba Anúncios.
3. Implementar seleção hierárquica: campanhas selecionadas filtram Conjuntos; conjuntos selecionados filtram Anúncios. Aceitar múltiplos IDs.
4. Preservar a seleção ao trocar de aba, mostrar o contexto selecionado e oferecer controle para limpar a seleção.
5. Sem seleção do nível pai, mostrar todos os itens elegíveis da conta e do período.

**Aceite:** campanha ativa sem veiculação não aparece por padrão; a seleção de pais limita corretamente os filhos; os totais da tabela correspondem às linhas exibidas.

## Etapa 4 — Vendas, atribuição e métricas

1. Usar pedidos aprovados e atribuídos pelo Track2 como fonte da coluna **Vendas** e dos indicadores financeiros. Mostrar **Compras Meta** em coluna separada.
2. Priorizar IDs de campanha, conjunto e anúncio capturados no tracking. Usar UTM apenas quando a correspondência for inequívoca; manter os demais pedidos como sem atribuição.
3. Garantir que cada pedido seja contado no máximo uma vez por nível e que atribuídos + não atribuídos fechem com os pedidos aprovados do período.
4. Calcular CPA, receita, ROAS e lucro usando uma definição consistente com a coluna Vendas. Se faltar qualquer entrada obrigatória, mostrar `—`.
5. Mostrar IC somente quando houver dado real. Remover a regra `IC = vendas × 1,5` e a regra de receita líquida `receita bruta × 0,9`.
6. Respeitar a moeda da conta. Mostrar a moeda original e não somar moedas diferentes sem uma conversão explícita, com taxa e data definidas.
7. Identificar a janela e a configuração de atribuição usadas nas Compras Meta para permitir comparação correta com o Gerenciador.

**Aceite:** a coluna Vendas e o CPA usam a mesma contagem; nenhuma venda é duplicada no mesmo nível; dados ausentes permanecem vazios.

## Etapa 5 — Testes e validação

1. Testar paginação, erro parcial e retomada do sync, limites de Hoje/Ontem no fuso da conta e períodos históricos.
2. Testar itens ativos sem veiculação, filtros por conta e status, seleção múltipla em cascata e limpeza da seleção.
3. Testar zero medido versus dado ausente em cada métrica e nos indicadores derivados.
4. Testar atribuição inequívoca, pedido não atribuído e ausência de duplicação entre linhas.
5. Comparar novamente os períodos da Etapa 1 com dados reais da conta conectada e pedidos do banco. Documentar diferenças esperadas entre Vendas Track2 e Compras Meta.

## Entrega

Abrir um novo PR com mudanças de código, testes e evidências da comparação. Não reverter integralmente `7f4dbbb`; corrigir suas regras incompletas preservando a importação de insights por nível. Não publicar o PR como concluído enquanto houver dados ausentes apresentados como zero ou estimativa.

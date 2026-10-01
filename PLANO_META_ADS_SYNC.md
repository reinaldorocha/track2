# Plano de sincronização sustentável do Meta Ads

## Objetivo

Manter vendas do Track2 visíveis assim que os eventos forem recebidos e atualizar métricas da Meta sem repetir a importação completa da conta a cada ciclo. Preservar dados confirmados, retomar tarefas interrompidas e deixar explícito quando cada fonte foi atualizada. A Meta pode atrasar ou limitar respostas; o painel não deve chamar esses dados de tempo real nem preencher lacunas com zeros ou estimativas.

## Situação atual verificada

- `scripts/meta-cron.js` chama o auto-sync a cada 15 minutos.
- Cada `syncAdAccount` lê todas as campanhas, todos os conjuntos e todos os anúncios, mesmo nos ciclos recentes.
- Os insights são consultados nos níveis campanha, conjunto e anúncio, com `time_increment=1`. O intervalo é de 7 dias ou 95 dias quando não há um sync histórico completo nas últimas 24 horas.
- A coleta paginada guarda as páginas apenas em memória. Se uma página falha, a próxima tentativa recomeça do início.
- O limite atual usa uma pausa fixa de 60 minutos. O botão manual por conta pode ignorar apenas essa pausa local.
- A tabela mostra vendas dos pedidos aprovados no Track2, mas só inclui linhas com gasto ou impressões já importados da Meta no período. Uma venda nova pode chegar antes da atualização de veiculação.

## Regras de dados

1. **Vendas Track2:** eventos e pedidos aprovados recebidos pelos fluxos próprios do Track2; atualizar a apresentação quando chegam, sem esperar a Meta. Preservar a atribuição por IDs/UTMs inequívocos e mostrar vendas sem atribuição em separado.
2. **Meta Ads:** gasto, impressões, cliques, compras atribuídas pela Meta, status e orçamento vêm da Meta. Exibir o horário da última atualização bem-sucedida por conta e nível.
3. **Cobertura:** distinguir valor confirmado em zero, intervalo ainda não importado e dado antigo. Falha em um nível não marca os demais como completos.
4. **Hierarquia:** campanha, conjunto e anúncio com veiculação no período continuam sendo as linhas padrão. Uma venda recém-chegada cujo item ainda não tem veiculação importada deve aparecer no resumo de vendas pendentes de atualização/atribuição, sem criar uma linha de anúncio fictícia.
5. **Dias já coletados:** presença de algumas linhas no banco não significa dia completo. A conclusão deve ser registrada por conta, nível e dia, inclusive quando a resposta válida da Meta vier vazia.

## Etapa 1 — Medir e controlar a coleta

- [ ] Registrar por conta, chamada e nível: duração, páginas, linhas, intervalo, erro e sinais de uso/espera devolvidos pela Meta, sem registrar tokens.
- [ ] Medir quantas chamadas cada ciclo gera e onde há maior consumo antes de mudar a frequência.
- [ ] Garantir uma única tarefa ativa por conta com trava persistente no PostgreSQL e expiração segura; cron, página e botão manual não podem iniciar coletas simultâneas da mesma conta.
- [ ] Aplicar espera por conta conforme os sinais da Meta; usar backoff progressivo com variação quando não houver tempo informado. O botão manual deve mostrar se a Meta ainda recusou a tentativa.

**Aceite:** chamadas simultâneas da mesma conta não se sobrepõem; erro de limite interrompe as próximas chamadas; há diagnóstico de consumo sem expor credenciais.

## Etapa 2 — Separar ciclos recentes de cadastro e histórico

- [ ] Criar tarefas independentes para cadastro de campanhas/conjuntos/anúncios, insights recentes e histórico. Cada uma possui status e último sucesso próprios.
- [ ] Oferecer importação inicial do histórico por CSV exportado do Gerenciador de Anúncios. Receber arquivos separados por nível (campanha, conjunto e anúncio), com quebra diária, IDs dos itens, datas e métricas necessárias. Validar colunas, conta selecionada, moeda, fuso, intervalo e configuração de atribuição antes de gravar.
- [ ] Fazer prévia da importação com quantidade de dias/linhas, valores ausentes e conflitos. Gravar por upsert, registrar o arquivo de origem e marcar cada dia/nível como completo somente quando o arquivo cobrir aquele escopo de forma verificável. Não somar novamente linhas já importadas por API ou por outro CSV.
- [ ] Em cada ciclo frequente, consultar somente Hoje no fuso da conta, pois seus números ainda mudam. Consultar dias anteriores apenas quando estiverem ausentes, incompletos ou agendados para conciliação; nunca reler automaticamente os 95 dias a cada 15 minutos.
- [ ] Ao virar o dia no fuso da conta, fechar Ontem com uma coleta completa. Depois, fazer apenas uma reconciliação curta e espaçada dos dias recentes para captar ajustes tardios da Meta; dias antigos completos só voltam à fila por correção manual ou regra explícita de reprocessamento.
- [ ] Atualizar cadastro em frequência menor e após ações que criem ou alterem itens. Definir frequência final a partir das medições da Etapa 1; começar com uma referência de algumas horas, configurável por conta.
- [ ] Usar a API para preencher somente dias/níveis históricos que continuarem ausentes após o CSV; dividir esse complemento em blocos de dias e salvar a conclusão por bloco.
- [ ] Usar relatórios assíncronos da Meta para consultas de insights grandes, com acompanhamento de estado e leitura paginada do resultado. Manter consultas simples para janelas recentes quando forem mais econômicas.

**Aceite:** CSV histórico válido preenche os dias cobertos sem consultar esses dias pela API; um ciclo recente consulta Hoje e blocos realmente pendentes; Ontem completo não é buscado a cada 15 minutos; uma falha no último bloco não reinicia os blocos anteriores; novas campanhas continuam aparecendo após atualização do cadastro.

## Etapa 3 — Persistir progresso e publicar dados com cobertura correta

- [ ] Persistir cursor ou unidade de trabalho concluída antes de avançar. Uma página só é marcada completa depois que suas linhas forem gravadas no PostgreSQL.
- [ ] Usar upsert idempotente para que retentativas não dupliquem entidades ou insights; preservar linhas válidas quando outra página falhar.
- [ ] Registrar cobertura por conta, nível e dia. Publicar um período como completo somente depois de todas as páginas e níveis necessários concluírem.
- [ ] Manter estados separados `pendente`, `em andamento`, `completo`, `aguardando conciliação` e `falhou`, para que o agendador saiba exatamente quais dias precisam de nova consulta.
- [ ] Evitar que um erro recente apague ou invalide o último dado válido; mostrar separadamente atualização anterior e falha atual.

**Aceite:** interrupção/reinício do container retoma do ponto persistido; nenhuma linha é duplicada; uma lacuna não aparece como zero medido.

## Etapa 4 — Painel e experiência de atualização

- [ ] Mostrar dois horários separados: última venda recebida pelo Track2 e última atualização das métricas da Meta por conta/nível.
- [ ] Atualizar vendas na interface independentemente do job da Meta. Definir a estratégia de atualização da tela com base na infraestrutura atual, sem prometer latência que não foi medida.
- [ ] Mostrar tarefa em andamento, partes concluídas, próxima tentativa automática e motivo de pausa; permitir reprocessar apenas período/nível pendente.
- [ ] Continuar exibindo somente itens com veiculação confirmada no período; mostrar vendas ainda não conciliadas com esses itens em um resumo separado.

**Aceite:** uma venda recebida aparece sem esperar um sync Meta; gasto antigo é identificado como antigo; erro parcial não torna invisíveis dados já confirmados.

## Etapa 5 — Validação antes de substituir o fluxo atual

- [ ] Testar limite de requisições, timeout, paginação interrompida, reinício do worker, duplicidade de cron e retentativa manual.
- [ ] Testar fusos das contas, virada de Hoje/Ontem, retificação de dias anteriores e cobertura parcial nos três níveis.
- [ ] Comparar uma conta real com o Gerenciador da Meta nos mesmos dias, fuso e janela de atribuição; comparar vendas Track2 com pedidos aprovados. Registrar diferenças esperadas entre as fontes.
- [ ] Executar o novo fluxo em paralelo sem publicar seus resultados, medir chamadas e completude, depois migrar por conta. Remover a coleta antiga apenas após o novo fluxo atingir os critérios de aceite.

**Aceite:** volume de chamadas e tempo de atualização documentados em produção; nenhuma lacuna é escondida; métricas dos três níveis conferem dentro das diferenças documentadas da Meta.

## Ordem de entrega

1. Instrumentação e trava por conta.
2. Ciclos separados e histórico retomável.
3. Cobertura persistida e leitura correta pelo painel.
4. Atualização independente das vendas e estado das tarefas.
5. Validação real e migração gradual.

Os intervalos propostos são parâmetros iniciais, não garantias de atualização. A frequência definitiva depende da cota e do volume observado na conta conectada.

## Referências abertas para comparar a implementação

- [Airbyte Facebook Marketing](https://github.com/airbytehq/airbyte/blob/master/docs/integrations/sources/facebook-marketing.md): usa sync incremental com janela configurável para rever conversões recentes, relatórios assíncronos para insights extensos e ajuste por fuso da conta. Adaptar a ideia de janela de revisão, mas executá-la em frequência própria para não reler todos os dias a cada ciclo de Hoje.
- [Singer tap-facebook](https://github.com/singer-io/tap-facebook/blob/master/tap_facebook/__init__.py): usa trabalhos assíncronos, acompanha estado e avanço por intervalos, inclusive quando um relatório retorna zero linhas. Adaptar o registro de cobertura vazia concluída.
- [Falha relatada no Airbyte](https://github.com/airbytehq/airbyte/issues/86316): o conector também pode repetir coletas de anúncios após limite de conta. Por isso, o Track2 deve registrar o bloqueio e retomar do trabalho pendente, sem copiar a política de novas tentativas do projeto.

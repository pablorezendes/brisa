# Unificação operacional: Brisa, planilhas e Widesys

A identidade de cada registro e a decisão de correspondência são persistidas em
`UnificacaoRegistro`. A tabela conserva `chave`, `dominio`, `origem`, `origemId`,
`status`, `destinoChave`, `hashFonte`, `hashDestino`, `candidatos`, `motivos` e
`decisao`. As fontes financeiras e cadastrais continuam rastreáveis nos seus
registros originais. Esta camada permite que as consultas apresentem um fluxo
comum e reconheçam quando duas fontes descrevem o mesmo fato.

## Estados e decisões

| Estado | Significado na consolidação |
| --- | --- |
| `ATIVO` | Registro utilizável segundo as regras do seu domínio. |
| `PENDENTE` | Possível correspondência precisa ser examinada. |
| `VINCULADO` | Outra chave representa o mesmo fato; a consulta conta o destino uma vez. |
| `QUARENTENA` | A fonte contém uma inconsistência que impede consolidação confiável. |
| `REVISAR` | Os dados examinados mudaram ou uma decisão ficou inconsistente. |
| `AUSENTE` | Registro deixou de aparecer na cobertura comprovada da fonte. |

`candidatos` e `motivos` explicam a comparação. `decisao` registra a resolução;
`hashFonte` e `hashDestino` permitem detectar mudanças após a conferência. Uma
nova captura não pode converter silenciosamente uma decisão antiga em aprovação
dos dados novos. Qualidade da captura e decisão de unificação são dimensões
separadas: `statusImportacao` do staging não substitui `UnificacaoRegistro`.

Ações de vínculo precisam validar existência, domínio compatível, ausência de
ciclos, autorização e hashes atuais no servidor. Uma decisão de manter registros
distintos deve sobreviver ao recálculo enquanto os dados relevantes permanecerem
iguais. Correspondência provável por nome, data ou valor deve ser apresentada
como hipótese, com a diferença e a resolução sugerida.

## Cadastros e contratos

Pessoa pode desempenhar vários papéis sem virar vários cadastros. Documento
normalizado e único pode apoiar correspondência; divergências de identificação
continuam visíveis. Nome sozinho não confirma pessoa, imóvel ou contrato.

Contrato relaciona unidade, empreendimento e inquilino. Proprietários,
beneficiários, fiadores e corretores do legado possuem papéis próprios. Ligar um
contrato somente pelo inquilino ou somente pelo imóvel pode associar períodos,
beneficiários e cobranças diferentes. A tela deve permitir conferir essas
relações antes de ativar geração recorrente ou repasse.

O comando de geração mensal precisa considerar títulos já existentes nas fontes
vinculadas. Contrato legado com cobranças futuras capturadas não deve criar uma
segunda obrigação para a mesma cobrança. Contrato e competência isoladamente
não garantem unicidade: pode haver parcelas, taxas e mais de um título no mês.

## Receber, pagar, baixas e caixa

Título representa obrigação; baixa representa liquidação; movimento representa
efeito no caixa. Uma baixa vinculada a um movimento não gera uma segunda entrada
ou saída no saldo. Valores pagos, devidos e em aberto permanecem distintos, e
pagamentos parciais mantêm saldo. Atraso corrente deve usar vencimento e saldo na
data civil de São Paulo; a situação capturada representa apenas sua fotografia.

Duplicata confirmada contribui uma vez por seu destino. Pendências e quarentenas
devem ter contagem e montantes identificáveis; sua presença não deve ser escondida
em um total apresentado como definitivamente conciliado. Transferências entre
contas não são receita nem despesa da administradora.

O livro-caixa das planilhas contém `RECEB_DINHEIRO` como informação paralela;
essas linhas não entram no saldo atual. Igualdade de data e valor com um movimento
Widesys é somente indício, pois pagamentos legítimos podem se repetir.

As rotas de contas a receber, contas a pagar, movimentações, cobrança e cadastros
devem consumir a mesma resolução de origem. A central de unificação é a fila de
decisões; não deve ser a única forma de localizar registros do legado.

## Comissão, repasses e planilhas

`src/lib/dominio/comissao.ts` permanece a fonte da regra de comissão. A planilha
fornece aluguel, IPTU, condomínio, recebido e taxa do mês. Títulos Widesys possuem
totais, encargos e saldos, mas não necessariamente essa composição. Preencher os
componentes desconhecidos com zero ou aplicar 10% por padrão fabricaria comissão.

Receita de aluguel do proprietário, repasse, tarifa, comissão e receita própria
da administradora não são intercambiáveis. Catálogo de plano de contas e partes
do contrato apoiam classificação, mas não bastam para determinar automaticamente
quem é titular de todo o dinheiro recebido. Promover um título para o modelo de
aluguel exige composição e regra de comissão verificadas.

`mesLancamento` das planilhas governa comissão e fechamento; `competencia` é o
período econômico e pode ser diferente. Meses fechados preservam sua apuração.
Vincular, distinguir ou reabrir a decisão de um recebimento fechado exige
reabrir o mês. Novos fechamentos congelam os IDs das duplicatas nativas
suprimidas em `unificacaoExcluidos`; alterações cadastrais posteriores não
reativam essas cópias nas apurações históricas. Fechamentos anteriores conservam
lista vazia, equivalente à composição com que foram originalmente fechados.
Os relatórios nativos retiram somente vínculos Brisa → Brisa confirmados;
pendências continuam visíveis na sua base original. No consolidado unificado,
pendências e inconsistências ficam fora dos totais até a decisão.
Histórico Airbnb contém agregados mensais, e a planilha tem precedência para
meses históricos já fechados. Somar títulos individuais ao agregado mensal
pode duplicar receita; ausência de despesa continua desconhecida, não zero.

Proveniência de planilha deve usar arquivo/hash/aba/linha comprováveis. Um registro
operacional sem essa prova conserva sua origem Brisa até a conferência. O conjunto
atual não deve ser reimportado para tentar reconstruir vínculos.

## Sicoob e continuidade da operação

A emissão e liquidação bancária continuam exigindo título operacional válido e
as proteções existentes de autorização, idempotência, mês aberto e boleto ativo.
O serviço soma `PagamentoRecebimento` confirmado; registros da planilha podem ter
`recebido` preenchido sem essa trilha. Reconhecer uma baixa histórica não deve
somar novamente o valor já recebido nem tratá-lo como uma nova liquidação Sicoob.

Boletos antigos precisam de identificação bancária confirmada antes de qualquer
reemissão. Uma listagem unificada não é autorização para emitir novamente nem
comprova que um boleto da origem foi cancelado.

## Proteção da carga inicial

`npm run db:seed` serve apenas à primeira carga em base operacional vazia. O
importador verifica cadastros, financeiro, fechamentos, staging, registros
bancários e unificação antes de escrever. Usuários e contas de bootstrap podem
existir; dados de operação ou importação bloqueiam a carga com
`SEED_BASE_NAO_VAZIA`. A rotina não contém exclusão de dados nem opção de reset.

O guard consulta o catálogo SQLite, incluindo `UnificacaoRegistro` sem depender
de uma versão específica do Prisma Client. Deve-se executar a primeira carga com
a aplicação sem receber lançamentos concorrentes. Novas fontes entram pelos
importadores e pela resolução de unificação, conservando os dados existentes.

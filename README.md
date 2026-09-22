# Brisa — gestão financeira e imobiliária

Sistema interno da operação A. Camargo/Brisa, construído com Next.js 16,
Prisma e SQLite. Reúne painéis executivos, cadastros, contas a pagar/receber,
conciliação, boletos e relatórios em uma interface responsiva.

## Desenvolvimento local

Requisitos: Node.js compatível com o projeto e npm.

```bash
npm ci
npm run db:push
npm run db:contas-sicoob
npm run dev
```

Abra `http://localhost:3000`. Na primeira visita, o sistema conduz a criação
do administrador. Defina `AUTH_SECRET` no ambiente antes de usar dados reais.

Comandos de verificação:

```bash
npm test
npm run lint
npm run build
```

## Contas Sicoob

`npm run db:contas-sicoob` cadastra de forma idempotente o banco 756, agência
3299, e as contas 1180-0 (Sicoob Brisa Azul), 11801 (Aplicação), 126764
(AC), 466395 (Sicoob IPTU) e 67407 (Paolla). O script não grava titular,
credenciais, certificados ou tokens e não habilita a integração.

A API usa um perfil global de credenciais neste release; portanto, somente a
conta autorizada no aplicativo Sicoob pode ficar com a integração ativa. No
sandbox, o token estático do portal pode ser usado sem mTLS. Em produção, a
autenticação é OAuth `client_credentials` com certificado mTLS.

O webhook tipo 7 registra apenas o aviso de pagamento. A baixa é feita somente
após a confirmação do movimento tipo 5/LIQUI, processado pela mesma rota de
sincronização usada pelo cron. Consulte [DEPLOY.md](./DEPLOY.md) e
[.env.sicoob.example](./.env.sicoob.example) antes de habilitar a emissão.

## Cadastros do Widesys

O fluxo de migração captura os cadastros legados por duas fontes somente de
leitura: a API JSON e as telas administrativas. Os artefatos ficam em
`data/legacy-widesys/`, que é ignorado pelo Git por conter dados pessoais. As
credenciais são lidas apenas das variáveis do processo e nunca são gravadas nos
arquivos, no SQLite ou nos logs do importador.

```bash
export WIDESYS_USUARIO="..."
export WIDESYS_SENHA="..."
npm run legacy:capture-api
npm run legacy:scrape -- --refresh
npm run legacy:capture-catalogos -- --refresh --irrf-from-year=2025 --irrf-to-year=2026
unset WIDESYS_SENHA WIDESYS_USUARIO

npm run importar:cadastros-widesys:dry-run
npm run importar:cadastros-widesys
npm run importar:catalogos-widesys:dry-run
# somente depois de conferir o manifesto e as quarentenas:
npm run importar:catalogos-widesys
```

O manifesto e os hashes de cada captura são conferidos antes da importação. O
processo é transacional e idempotente: uma segunda execução sem mudanças não
duplica registros. Pessoas continuam distintas por identidade do legado, mesmo
quando possuem o mesmo nome, e podem acumular papéis como proprietário,
inquilino, fiador, corretor ou fornecedor. Registros que desaparecerem da fonte
geram avisos para reconciliação manual; eles não são apagados automaticamente.
O modo `--refresh` é o padrão e refaz todas as telas. Use `--resume` somente para
continuar a mesma captura após uma interrupção.

Os catálogos complementares incluem contas bancárias e layouts, calendário,
índices de reajuste, plano de contas, formas de recebimento, garantias,
categorias e características de imóveis/empreendimentos, modelos de documentos
e cadastros geográficos. Eles entram em tabelas de *staging* auditáveis e não
alteram configurações ativas automaticamente. O procedimento detalhado está em
[docs/migracao-widesys-catalogos.md](./docs/migracao-widesys-catalogos.md).

A paginação dos catálogos respeita o componente do legado: telas
`com_widesys` usam `limit=200`, enquanto telas `com_categories` usam
`list[limit]=200`. Esses parâmetros não são intercambiáveis; o capturador
escolhe o formato correto e reconcilia a contagem informada pela tela antes de
considerar um módulo completo.

### Operação financeira do Widesys

Contratos, contas a receber, contas a pagar e movimentações possuem uma captura
separada, também somente leitura. Depois do POST estritamente necessário para o
login, ela acessa apenas listagens e detalhes GET permitidos; nunca chama tarefas
de salvar, liquidar, gerar cobrança, boleto ou retorno bancário.

```bash
npm run legacy:capture-operation -- --dry-run
npm run legacy:capture-operation -- --refresh --from=2025-01 --to=2026-09 --titles-to=2100-12-31
npm run importar:operacao-widesys:dry-run
# somente depois de conferir contagens, somas e quarentenas:
npm run importar:operacao-widesys
```

Recebimentos começam em `2025-07`, pagamentos em `2025-11` e movimentos em
`2025-12`. As janelas históricas são mensais, com paginação efetiva de 200. Para
receber/pagar há ainda uma janela futura até `2100-12-31` (sentinela configurável
por `--titles-to=AAAA-MM-DD`), evitando perder parcelas vincendas. Contratos são
capturados com a situação vazia, incluindo vigentes e encerrados.

Os artefatos protegidos ficam em `data/legacy-widesys/operacao/`. O
`manifest.json` guarda contagens, IDs duplicados, hashes, erros e os arquivos
normalizados em partes de até 100 registros sob `scopes/<escopo>-part-*.json`.
Use `--resume` apenas com os mesmos módulos e período; cada
arquivo existente tem seu hash validado antes de ser reaproveitado. Esta etapa
somente captura: a importação financeira deve ocorrer apenas após reconciliação
das contagens e revisão do manifesto completo.

O importador valida a conclusão, os hashes, as contagens e as identidades antes
de abrir o banco. Ele grava lotes pequenos e retomáveis em uma camada de
*staging* própria: contratos e suas múltiplas partes, títulos, múltiplas baixas
e movimentos. Pagamento parcial mantém `valor devido`, soma de baixas efetivas
e saldo em campos separados; `Nº Lanç.` liga a baixa ao movimento apenas por
identidade externa para permitir a prova caixa × baixas. Registros ambíguos vão
para quarentena. Nada é promovido automaticamente para `Contrato`,
`Recebimento` ou `LancamentoCaixa`, e nomes nunca são usados para criar vínculos.

A conferência fica disponível em `/financeiro/migracao-widesys`. Essa visão
mostra, lado a lado, o núcleo operacional do Brisa, os registros preservados no
staging do Widesys, quarentenas e itens ausentes na fotografia mais recente. Uma
contagem ou valor semelhante nunca é apresentada como correspondência
confirmada; a origem externa e a promoção continuam explícitas.

Os snapshots brutos não são copiados ao SQLite. O staging guarda os campos
normalizados necessários para provar origem e reconciliar os registros —
inclusive identificadores e dados pessoais quando a fonte os exige —, além dos
hashes de proveniência. Esses campos não são exibidos na auditoria financeira e
devem permanecer restritos ao servidor. Consulte o procedimento de captura,
backup e atualização em [DEPLOY.md](./DEPLOY.md).

## Produção

O deploy alvo usa Docker Compose, Traefik e o banco persistido em
`/srv/stack/acamargo/dados/brisa.db`. O procedimento completo — incluindo backup,
segredos, certificado, cron e atualização por fast-forward — está em
[DEPLOY.md](./DEPLOY.md).

Como `data/legacy-widesys/` contém dados pessoais e financeiros e não entra no
Git, um lote capturado localmente deve ser enviado separadamente por SSH. O
Compose já monta `./data` em `/app/data`; após a transferência, os três
importadores são executados primeiro em `dry-run` e depois gravam somente nas
tabelas de *staging*, quarentena e auditoria. O passo a passo seguro está na
seção 6 do guia de deploy.

Arquivos reais de banco, datasets, certificados e `.env` nunca devem ser
versionados.

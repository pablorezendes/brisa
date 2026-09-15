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
unset WIDESYS_SENHA WIDESYS_USUARIO

npm run importar:cadastros-widesys:dry-run
npm run importar:cadastros-widesys
```

O manifesto e os hashes de cada captura são conferidos antes da importação. O
processo é transacional e idempotente: uma segunda execução sem mudanças não
duplica registros. Pessoas continuam distintas por identidade do legado, mesmo
quando possuem o mesmo nome, e podem acumular papéis como proprietário,
inquilino, fiador, corretor ou fornecedor. Registros que desaparecerem da fonte
geram avisos para reconciliação manual; eles não são apagados automaticamente.
O modo `--refresh` é o padrão e refaz todas as telas. Use `--resume` somente para
continuar a mesma captura após uma interrupção.

Os snapshots brutos não são copiados ao SQLite. O banco guarda somente os
campos normalizados usados pelo Brisa e hashes de proveniência. Consulte o
procedimento de captura, backup e atualização em [DEPLOY.md](./DEPLOY.md).

## Produção

O deploy alvo usa Docker Compose, Traefik e o banco persistido em
`/srv/stack/acamargo/dados/brisa.db`. O procedimento completo — incluindo backup,
segredos, certificado, cron e atualização por fast-forward — está em
[DEPLOY.md](./DEPLOY.md).

Arquivos reais de banco, datasets, certificados e `.env` nunca devem ser
versionados.

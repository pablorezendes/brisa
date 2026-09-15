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

## Produção

O deploy alvo usa Docker Compose, Traefik e o banco persistido em
`/srv/stack/acamargo/dados/brisa.db`. O procedimento completo — incluindo backup,
segredos, certificado, cron e atualização por fast-forward — está em
[DEPLOY.md](./DEPLOY.md).

Arquivos reais de banco, datasets, certificados e `.env` nunca devem ser
versionados.

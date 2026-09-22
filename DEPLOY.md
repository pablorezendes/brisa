# Deploy — brisa.tescod.com

Stack alvo: VPS Ubuntu com Docker + Traefik (padrão `/srv/stack/<app>`).
App: Next.js 16 + Prisma + SQLite num único container; banco no volume
`./dados`; Traefik faz o TLS. O controle de acesso é o **login do próprio
app** (`/login`) — sessão assinada em cookie httpOnly.

## 0) Pré-requisitos (uma vez)

1. **DNS**: registro `A` `brisa.tescod.com → 76.13.161.105`
   (ou um CNAME, se você usa wildcard no domínio).

   > **Cloudflare com proxy ligado (nuvem laranja):** veja a seção
   > "Cloudflare" no fim deste arquivo antes de subir — a nuvem laranja
   > atrapalha a emissão do certificado e pode gerar laço de redirecionamento.

2. **Descobrir os nomes do seu Traefik** (variam por instalação):
   ```bash
   docker network ls                                   # nome da rede (ex.: traefik, proxy, web)
   grep -ri "certresolver\|certificatesresolvers" /srv/stack/traefik | head
   ```
   Ajuste no `docker-compose.yml` deste repo:
   - `networks: traefik: external: true` → nome real da rede;
   - `tls.certresolver=letsencrypt` → nome real do resolver.

## 1) No servidor — clonar e configurar

```bash
cd /srv/stack/acamargo
git clone https://github.com/pablorezendes/brisa.git .
mkdir -p dados data

# segredo de assinatura das sessões de login (obrigatório)
printf "AUTH_SECRET=%s\n" "$(openssl rand -hex 32)" > .env
chmod 600 .env
```

> A autenticação agora é do próprio app: a primeira visita a
> https://brisa.tescod.com abre a tela de **Primeiro acesso**, onde
> você cria o usuário administrador. Usuários adicionais / redefinir senha:
> `docker compose exec brisa npm run usuario -- "Nome" login "senha"`.

## 2) Enviar o dataset (fora do git — contém dados reais)

Do Windows (PowerShell), na pasta do projeto local:

```powershell
scp "C:\Users\pablorezendes\Documents\ACAMARGO\sistema\data\dataset.json" root@76.13.161.105:/srv/stack/acamargo/data/dataset.json
```

## 3) Subir e semear (seed é RECARGA TOTAL — rodar só na implantação)

```bash
cd /srv/stack/acamargo
docker compose up -d --build
docker compose logs -f --tail 20 brisa     # aguarde "Ready"; Ctrl+C para sair

# primeira carga (APAGA e reimporta tudo — nunca rodar depois do corte
# com lançamentos feitos direto no sistema):
docker compose exec brisa npm run db:seed

# prova de paridade com as planilhas dentro do container:
docker compose exec brisa npm run reconciliar
```

Abra https://brisa.tescod.com — o app pede o login criado no primeiro acesso.

## 4) Atualizações futuras

```bash
cd /srv/stack/acamargo
git pull --ff-only origin main
docker compose up -d --build
```

O banco (`dados/brisa.db`) fica intacto entre deploys; o `prisma db push` do
boot aplica alterações de schema sem apagar dados.

### Integração Sicoob (configuração inicial)

O cadastro idempotente cria as cinco contas do Bancoob/Sicoob (banco 756,
agência 3299) sem habilitar a API:

| Conta | Apelido | Finalidade inicial |
| --- | --- | --- |
| 1180-0 | Sicoob Brisa Azul | operacional e padrão, se ainda não existir outra padrão |
| 11801 | Aplicação | aplicação |
| 126764 | AC | outra |
| 466395 | Sicoob IPTU | IPTU |
| 67407 | Paolla | outra |

As credenciais da API formam **um único perfil global** neste release. Por
segurança, o sistema impede que mais de uma conta tenha a integração ativa ao
mesmo tempo. Em **Financeiro → Contas bancárias**, habilite somente a conta
explicitamente autorizada no aplicativo Sicoob e confirme com o banco o número
de cliente Sisbr, a conta do convênio, a modalidade, o contrato (quando houver)
e a espécie documental. As outras quatro contas permanecem cadastradas para a
operação financeira, mas sem emissão nesse perfil.

#### Autenticação por ambiente

- **Sandbox com token estático:** informe `SICOOB_CLIENT_ID` e o
  `SICOOB_ACCESS_TOKEN` temporário fornecido pelo portal. Esse modo não exige
  certificado mTLS; deixe `SICOOB_PFX_PATH` vazio.
- **Sandbox com OAuth:** sem token estático, configure a URL de token e o
  certificado mTLS, da mesma forma que o cliente OAuth exigir.
- **Produção:** use `client_credentials` com a URL oficial de token e
  certificado A1/mTLS. Deixe `SICOOB_ACCESS_TOKEN` vazio. O `client_id` é
  informado por `SICOOB_CLIENT_ID`; não o grave no código ou no banco. O PFX e
  sua senha nunca devem entrar no Git, na imagem Docker nem no SQLite.

O layout Widesys continha somente os três escopos de boletos, que também são o
padrão seguro do Brisa: `boletos_inclusao`, `boletos_consulta` e
`boletos_alteracao`. Mantenha `SICOOB_SCOPES` exatamente assim para evitar
`invalid_scope` enquanto a aplicação do Portal Sicoob não tiver permissões
adicionais.

O webhook tipo 7 é opcional. Para habilitá-lo, solicite ao banco e confirme no
Portal Sicoob os três escopos `webhooks_inclusao`, `webhooks_consulta` e
`webhooks_alteracao`; só então acrescente **os três juntos** a
`SICOOB_SCOPES`. O Brisa não mostra nem executa o cadastro do webhook com um
conjunto parcial. Sem webhook, a sincronização do arquivo tipo 5 / LIQUI
continua sendo o caminho oficial de confirmação de pagamento.

Crie no servidor o diretório restrito que será montado como somente leitura no
container:

```bash
cd /srv/stack/acamargo
install -d -m 700 auth auth/sicoob
```

Na estação que contém o certificado, copie-o diretamente para esse diretório
(ajuste apenas o caminho local). O PFX fica fora do repositório e não entra no
contexto da imagem:

```powershell
scp "C:\caminho-seguro\client.pfx" root@76.13.161.105:/srv/stack/acamargo/auth/sicoob/client.pfx
```

De volta ao servidor, restrinja a leitura e confirme apenas existência e
permissões — não imprima nem converta o conteúdo do certificado em logs:

```bash
cd /srv/stack/acamargo
chmod 600 auth/sicoob/client.pfx
test -r auth/sicoob/client.pfx
```

Edite **no próprio servidor** o `.env` com permissão `600` e acrescente as
chaves documentadas em `.env.sicoob.example`. Digite a senha do certificado
somente em `SICOOB_PFX_PASSPHRASE` nesse arquivo; não a passe na linha de
comando, não a envie por chat e não a copie para nenhum arquivo versionado.
O carregador acusa separadamente PFX ausente/ilegível e senha não preenchida,
sem incluir o caminho ou a senha no diagnóstico. `SICOOB_SYNC_SECRET` aceita
somente Base64URL/hex forte com **43 a 128 caracteres**. O mesmo vale para
`SICOOB_WEBHOOK_SECRET`, mas ele só é necessário quando o webhook opcional for
habilitado. Gere um valor para a sincronização e, nesse caso, um segundo valor
diferente para o webhook (a saída hexadecimal tem 64 caracteres válidos):

```bash
openssl rand -hex 32
```

Exemplo mínimo de produção:

```dotenv
APP_PUBLIC_URL=https://brisa.tescod.com
SICOOB_AMBIENTE=producao
SICOOB_TOKEN_URL=https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token
SICOOB_CLIENT_ID=IDENTIFICADOR_DO_APLICATIVO
SICOOB_ACCESS_TOKEN=
SICOOB_SCOPES="boletos_inclusao boletos_consulta boletos_alteracao"
SICOOB_PFX_PATH=/run/secrets/sicoob/client.pfx
SICOOB_PFX_PASSPHRASE=
SICOOB_WEBHOOK_SECRET=
SICOOB_SYNC_SECRET=OUTRO_SEGREDO_DE_64_CARACTERES_HEX
SICOOB_WEBHOOK_EMAIL=
```

Antes de reconstruir o container, preencha no `.env` do servidor o
`SICOOB_CLIENT_ID` liberado pelo banco e o campo
`SICOOB_PFX_PASSPHRASE`, que está vazio no exemplo. O bloco acima omite a senha
de propósito para que ela nunca seja copiada da documentação.

Depois, reconstrua o container e confira as contas. Cadastre o webhook pela
própria tela somente se os três escopos opcionais tiverem sido autorizados e
incluídos explicitamente em `SICOOB_SCOPES`:

```bash
docker compose up -d --build
docker compose exec brisa npm run db:contas-sicoob
docker compose ps
docker compose logs --tail 100 brisa
```

#### Confirmação de pagamento e cron

O webhook de movimento **tipo 7** é somente um aviso operacional de intenção
de pagamento (ou cancelamento). Ele é gravado de forma idempotente, mas
**nunca dá baixa no recebimento**. A confirmação financeira vem do arquivo de
movimentações **tipo 5 / LIQUI**, no qual o app valida conta, convênio, título,
data e valor antes de conciliar.

A mesma rota protegida de sincronização consulta a carteira e executa o fluxo
assíncrono do LIQUI (solicitar, consultar disponibilidade e baixar/processar).
Agende-a a cada 15 minutos; podem ser necessárias execuções sucessivas até o
arquivo solicitado ficar disponível:

```bash
crontab -e
# O segredo já está no ambiente do container; não carregue o .env no shell do host.
*/15 * * * * cd /srv/stack/acamargo && docker compose exec -T brisa node -e 'fetch("http://127.0.0.1:3000/api/integracoes/sicoob/sincronizar",{method:"POST",headers:{authorization:"Bearer "+process.env.SICOOB_SYNC_SECRET},signal:AbortSignal.timeout(55000)}).then(r=>{if(!r.ok)throw new Error("HTTP "+r.status)}).catch(e=>{console.error(e.message);process.exit(1)})'
```

`SICOOB_WEBHOOK_SECRET` faz parte do caminho da URL de callback. Configure o
Traefik e qualquer coletor/APM para **não registrar nem exportar a URL completa
dessa rota**, restrinja acesso e retenção dos access logs e nunca cole a URL em
ticket, chat ou captura de tela. Se ela aparecer em um log, rotacione o segredo
e recadastre o webhook.

#### Atualização segura no servidor atual

Antes de atualizar, pare brevemente o app para obter uma cópia consistente do
SQLite. O comando abaixo preserva a base atual, atualiza somente por fast-forward
e deixa o bootstrap aplicar o schema e o cadastro idempotente das contas:

```bash
set -e
cd /srv/stack/acamargo
mkdir -p /root/backups
docker compose stop brisa
if [ -f dados/brisa.db ]; then
  cp --archive dados/brisa.db "/root/backups/brisa-pre-sicoob-$(date +%F-%H%M%S).db"
fi
git pull --ff-only origin main
docker compose up -d --build
docker compose exec brisa npm run db:contas-sicoob
docker compose ps
docker compose logs --tail 100 brisa
```

## 5) Backup

Todo o estado é um arquivo: `/srv/stack/acamargo/dados/brisa.db`.

```bash
# exemplo: cópia diária às 3h (crontab -e)
0 3 * * * cp /srv/stack/acamargo/dados/brisa.db /root/backups/brisa-$(date +\%F).db
```

## 6) Importar cadastros do Widesys

As capturas são somente de leitura no legado. Os arquivos resultantes ficam em
`data/legacy-widesys/`, fora do Git, e os importadores validam manifestos,
contagens e hashes antes de abrir a transação. O volume `./data:/app/data` do
Compose torna esse mesmo diretório visível no container.

Na captura de catálogos, a paginação varia conforme o componente do Joomla:
`com_widesys` usa `limit=200`; `com_categories` usa `list[limit]=200`. Não altere
esses parâmetros manualmente nem reutilize a URL de um componente no outro.

Escolha **uma** das opções abaixo: capturar no próprio servidor ou transferir
um lote completo já validado na estação local. Nunca use Git, ticket, chat ou
armazenamento público para transportar esses artefatos.

### Opção A — capturar no próprio servidor

Esta opção evita copiar dados pessoais entre máquinas.

Use variáveis temporárias e silencie a senha no terminal. Não acrescente essas
credenciais ao `.env`, ao histórico do shell ou ao `docker-compose.yml`:

```bash
cd /srv/stack/acamargo
read -r -p "Usuário Widesys: " WIDESYS_USUARIO
read -r -s -p "Senha Widesys: " WIDESYS_SENHA; printf '\n'
export WIDESYS_USUARIO WIDESYS_SENHA

docker compose exec \
  -e WIDESYS_USUARIO \
  -e WIDESYS_SENHA \
  brisa npm run legacy:capture-api

docker compose exec \
  -e WIDESYS_USUARIO \
  -e WIDESYS_SENHA \
  brisa npm run legacy:scrape -- --refresh

docker compose exec \
  -e WIDESYS_USUARIO \
  -e WIDESYS_SENHA \
  brisa npm run legacy:capture-catalogos -- --refresh \
    --irrf-from-year=2025 --irrf-to-year=2026

# Captura operacional para reconciliação; ainda não altera o SQLite.
docker compose exec \
  -e WIDESYS_USUARIO \
  -e WIDESYS_SENHA \
  brisa npm run legacy:capture-operation -- --refresh \
    --from=2025-01 --to=2026-09 --titles-to=2100-12-31

unset WIDESYS_SENHA WIDESYS_USUARIO
```

### Opção B — transferir a captura local por SSH

Antes do envio, execute localmente os três `dry-run` e só prossiga se os
manifestos estiverem completos, sem erro de contagem/ID duplicado e com as
quarentenas revisadas. No PowerShell, empacote apenas o diretório ignorado pelo
Git, envie-o por SSH e apague a cópia temporária local:

```powershell
$arquivo = Join-Path $env:TEMP "legacy-widesys-transfer.tar.gz"
tar -czf $arquivo -C "C:\Users\pablorezendes\Documents\ACAMARGO\sistema\data" legacy-widesys
scp $arquivo root@76.13.161.105:/root/legacy-widesys-transfer.tar.gz
Remove-Item -LiteralPath $arquivo
```

No servidor, extraia para um diretório temporário com permissão restrita,
confira os três manifestos e só então troque o lote ativo. O lote anterior é
preservado com data/hora para permitir retorno:

```bash
set -e
cd /srv/stack/acamargo
umask 077
chmod 600 /root/legacy-widesys-transfer.tar.gz
incoming="$(mktemp -d /srv/stack/acamargo/data/.legacy-widesys-incoming.XXXXXX)"
tar -xzf /root/legacy-widesys-transfer.tar.gz -C "$incoming"
test -f "$incoming/legacy-widesys/manifest.json"
test -f "$incoming/legacy-widesys/catalogos/manifest.json"
test -f "$incoming/legacy-widesys/operacao/manifest.json"

stamp="$(date +%F-%H%M%S)"
mkdir -p /root/backups
if [ -e data/legacy-widesys ]; then
  mv data/legacy-widesys "/root/backups/legacy-widesys-pre-$stamp"
fi
mv "$incoming/legacy-widesys" data/legacy-widesys
rmdir "$incoming"
chmod -R go-rwx data/legacy-widesys
rm -f /root/legacy-widesys-transfer.tar.gz
```

Não mantenha indefinidamente a cópia `/root/backups/legacy-widesys-pre-*`:
depois que a reconciliação e a aplicação terminarem com sucesso, aplique a
política de retenção do cofre. A captura anterior nunca deve ser movida para
outro nome dentro do repositório, pois contém dados pessoais e financeiros.

### Validação e importação comuns às duas opções

Faça backup consistente de `dados/brisa.db` antes da primeira aplicação. Em
seguida rode cada `dry-run`, revise contagens, somas e quarentenas, e só então
execute o importador correspondente:

```bash
docker compose exec brisa npm run importar:cadastros-widesys:dry-run
docker compose exec brisa npm run importar:cadastros-widesys
docker compose exec brisa npm run importar:catalogos-widesys:dry-run
# aplique somente depois de conferir o manifesto e as quarentenas
docker compose exec brisa npm run importar:catalogos-widesys
docker compose exec brisa npm run importar:operacao-widesys:dry-run
# aplique somente depois de reconciliar contagens, somas e itens em quarentena
docker compose exec brisa npm run importar:operacao-widesys
```

O `dry-run` deve ser analisado antes da aplicação. Além das criações,
atualizações e quarentenas, ele consulta o staging em modo somente leitura e
antecipa quantos itens receberiam o estado `AUSENTE_NA_FONTE`. A aplicação é
idempotente e nunca apaga esses registros; uma captura completa apenas os marca
para conferência humana. Baixas só podem receber essa marca quando todo o escopo
de títulos comprova que a enumeração das liquidações foi completa. Não use
`npm run db:seed` neste fluxo, pois o seed é uma recarga total da operação.
O modo `--refresh` refaz todas as telas e evita misturar a API atual com detalhes
de uma execução anterior. Reserve `--resume` exclusivamente para continuar a
mesma captura interrompida.

Antes de qualquer futura importação de contratos ou financeiro, confira
`data/legacy-widesys/operacao/manifest.json`: `complete` precisa ser `true`, os
arquivos de escopo precisam bater com seus hashes e não pode haver erro de
contagem/ID duplicado. A janela futura de títulos usa `2100-12-31` apenas como
sentinela de consulta; reduza com `--titles-to=AAAA-MM-DD` somente se houver um
horizonte operacional formalmente definido. Não copie esses artefatos para o
Git, tickets ou chats, pois contêm dados pessoais e financeiros.

Os três importadores escrevem somente nas tabelas de staging, quarentena e
auditoria de suas respectivas áreas. Em especial, o importador operacional não
cria contratos, recebimentos ou lançamentos de caixa atuais. O lote é
idempotente por origem + `captureId`; cada registro também é idempotente por
origem + escopo + ID legado. Um lote com quarentenas é terminal e pode ser
reprocessado somente por uma nova captura, preservando a trilha anterior.
Depois da aplicação, confira `/financeiro/migracao-widesys`: a página distingue
os totais operacionais do Brisa dos totais do Widesys e não expõe snapshots,
URLs de origem, documentos pessoais ou dados bancários.

### Atualização completa com backup e migração dos cadastros

Para aplicar esta versão no servidor atual, pare brevemente a aplicação para
obter uma cópia consistente do SQLite. O bootstrap do container aplica o novo
schema antes da captura e da importação:

```bash
set -e
cd /srv/stack/acamargo
mkdir -p /root/backups
docker compose stop brisa
if [ -f dados/brisa.db ]; then
  cp --archive dados/brisa.db "/root/backups/brisa-pre-cadastros-$(date +%F-%H%M%S).db"
fi
git pull --ff-only origin main
docker compose up -d --build

read -r -p "Usuário Widesys: " WIDESYS_USUARIO
read -r -s -p "Senha Widesys: " WIDESYS_SENHA; printf '\n'
export WIDESYS_USUARIO WIDESYS_SENHA
docker compose exec -e WIDESYS_USUARIO -e WIDESYS_SENHA brisa npm run legacy:capture-api
docker compose exec -e WIDESYS_USUARIO -e WIDESYS_SENHA brisa npm run legacy:scrape -- --refresh
docker compose exec -e WIDESYS_USUARIO -e WIDESYS_SENHA brisa npm run legacy:capture-catalogos -- --refresh --irrf-from-year=2025 --irrf-to-year=2026
docker compose exec -e WIDESYS_USUARIO -e WIDESYS_SENHA brisa npm run legacy:capture-operation -- --refresh --from=2025-01 --to=2026-09 --titles-to=2100-12-31
unset WIDESYS_SENHA WIDESYS_USUARIO

docker compose exec brisa npm run importar:cadastros-widesys:dry-run
docker compose exec brisa npm run importar:cadastros-widesys
docker compose exec brisa npm run importar:catalogos-widesys:dry-run
# depois da conferência do relatório de catálogos:
docker compose exec brisa npm run importar:catalogos-widesys
docker compose exec brisa npm run importar:operacao-widesys:dry-run
# depois da conferência do relatório:
docker compose exec brisa npm run importar:operacao-widesys
docker compose ps
docker compose logs --tail 100 brisa
curl -fsSI https://brisa.tescod.com/login | head -n 1
```

## Cloudflare — a nuvem laranja e o certificado

O registro `brisa.tescod.com` está no Cloudflare **com proxy** (nuvem
laranja). Isso muda quem termina o TLS, e há duas armadilhas conhecidas:

1. **A emissão do certificado pode falhar.** O desafio padrão do Traefik é o
   TLS-ALPN-01, que acontece na porta 443 — mas com a nuvem laranja quem
   atende o 443 é o Cloudflare, não o Traefik, e o desafio nunca chega. (Com
   desafio HTTP-01 costuma passar, porque o Cloudflare encaminha
   `/.well-known/acme-challenge`.) Para saber qual o seu Traefik usa:

   ```bash
   grep -A4 "certificatesresolvers" /srv/stack/traefik/traefik.yml
   ```

2. **Laço de redirecionamento.** Se o modo SSL/TLS do domínio estiver em
   **Flexible**, o Cloudflare fala HTTP com a origem, o Traefik devolve
   redirecionamento para HTTPS, o Cloudflare segue e volta em HTTP — e o
   navegador mostra `ERR_TOO_MANY_REDIRECTS`.

**Caminho seguro (recomendado):** deixe a nuvem **cinza** (DNS only) para
subir e emitir o certificado; depois de confirmar que o HTTPS abre direto na
origem, religue a laranja com SSL/TLS em **Full (strict)**.

```bash
# a origem responde com certificado válido? (ignora o Cloudflare)
curl -sIv --resolve brisa.tescod.com:443:76.13.161.105 \
  https://brisa.tescod.com 2>&1 | grep -E "subject:|issuer:|HTTP/"
```

Com a laranja ligada, o modo SSL/TLS **precisa** ser `Full (strict)` —
Flexible causa o laço do item 2. Nada no app depende do IP do visitante, mas
lembre que com proxy os logs do Traefik passam a mostrar IPs do Cloudflare.

## Segurança — leia antes de divulgar a URL

- O repo GitHub está **público**: o histórico publicado foi sanitizado (sem
  `dev.db`/`dataset.json`), mas o ideal é torná-lo **privado**
  (Settings → General → Danger Zone → Change visibility).
- A barreira de acesso é o **login do app** (/login): senhas com scrypt,
  sessão assinada (HMAC + AUTH_SECRET) em cookie httpOnly, bloqueio no proxy
  e no layout. Guarde o AUTH_SECRET: trocá-lo derruba todas as sessões.
- O banco (`dados/brisa.db`) guarda também os usuários — o backup diário
  cobre tudo.

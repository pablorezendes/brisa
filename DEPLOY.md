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
  certificado A1/mTLS. Deixe `SICOOB_ACCESS_TOKEN` vazio. O PFX e sua senha
  nunca devem entrar no Git nem no SQLite.

Os escopos usados pelo app são somente os já declarados em
`.env.sicoob.example`; não amplie a lista sem ajustar a autorização do
aplicativo no portal do Sicoob.

Crie o diretório restrito e, para produção, envie o certificado:

```bash
cd /srv/stack/acamargo
mkdir -p auth/sicoob
chmod 700 auth auth/sicoob
# produção: envie o PFX como auth/sicoob/client.pfx por SCP/SFTP e então:
if [ -f auth/sicoob/client.pfx ]; then chmod 600 auth/sicoob/client.pfx; fi
```

Edite `.env` com permissão `600` e acrescente as chaves documentadas em
`.env.sicoob.example`. `SICOOB_WEBHOOK_SECRET` e `SICOOB_SYNC_SECRET` aceitam
somente Base64URL/hex forte com **43 a 128 caracteres**. Execute o comando
abaixo duas vezes e use valores diferentes (a saída hexadecimal tem 64
caracteres válidos):

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
SICOOB_SCOPES="boletos_inclusao boletos_consulta webhooks_inclusao webhooks_consulta webhooks_alteracao"
SICOOB_PFX_PATH=/run/secrets/sicoob/client.pfx
SICOOB_PFX_PASSPHRASE=SENHA_DO_CERTIFICADO
SICOOB_WEBHOOK_SECRET=SEGREDO_DE_64_CARACTERES_HEX
SICOOB_SYNC_SECRET=OUTRO_SEGREDO_DE_64_CARACTERES_HEX
SICOOB_WEBHOOK_EMAIL=financeiro@empresa.com.br
```

Depois, reconstrua o container, confira as contas e cadastre o webhook pela
própria tela:

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

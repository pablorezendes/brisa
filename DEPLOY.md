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
git pull
docker compose up -d --build
```

O banco (`dados/brisa.db`) fica intacto entre deploys; o `prisma db push` do
boot aplica alterações de schema sem apagar dados.

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

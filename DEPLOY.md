# Deploy — brisa.codexaurora.com.br

Stack alvo: VPS Ubuntu com Docker + Traefik (padrão `/srv/stack/<app>`).
App: Next.js 16 + Prisma + SQLite num único container; banco no volume
`./dados`; Traefik faz TLS e **basic auth** (o sistema não tem login próprio —
não exponha sem o middleware).

## 0) Pré-requisitos (uma vez)

1. **DNS**: crie o registro `A` `brisa.codexaurora.com.br → 76.13.161.105`
   (ou um CNAME, se você usa wildcard no domínio).
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
> https://brisa.codexaurora.com.br abre a tela de **Primeiro acesso**, onde
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

Abra https://brisa.codexaurora.com.br — o navegador pedirá o usuário/senha
do basic auth.

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

## Segurança — leia antes de divulgar a URL

- O repo GitHub está **público**: o histórico publicado foi sanitizado (sem
  `dev.db`/`dataset.json`), mas o ideal é torná-lo **privado**
  (Settings → General → Danger Zone → Change visibility).
- A barreira de acesso é o **login do app** (/login): senhas com scrypt,
  sessão assinada (HMAC + AUTH_SECRET) em cookie httpOnly, bloqueio no proxy
  e no layout. Guarde o AUTH_SECRET: trocá-lo derruba todas as sessões.
- O banco (`dados/brisa.db`) guarda também os usuários — o backup diário
  cobre tudo.

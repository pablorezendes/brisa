# Brisa — Gestão de Imóveis
# Imagem única (com devDependencies) de propósito: mantém prisma CLI e tsx
# disponíveis no container para `db push` no boot e para o seed manual.
FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npx prisma generate
# banco descartável apenas para o build (todas as páginas de dados são dinâmicas)
ENV DATABASE_URL="file:/tmp/build.db"
RUN npx prisma db push --skip-generate && npm run build

ENV NODE_ENV=production
# banco real vive no volume /data (ver docker-compose.yml)
ENV DATABASE_URL="file:/data/brisa.db"
EXPOSE 3000

# db push é idempotente: cria/migra o schema no primeiro boot sem tocar em dados
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm run start"]

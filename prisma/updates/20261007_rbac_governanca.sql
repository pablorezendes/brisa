-- Atualização versionada para instalações existentes (gerada com Prisma 6.19).
-- Aplicar exclusivamente por scripts/migrar-rbac.mjs, com backup e transação.
CREATE TABLE "RecursoGovernado" (
 "id" TEXT NOT NULL PRIMARY KEY, "tipo" TEXT NOT NULL, "origemId" TEXT NOT NULL,
 "status" TEXT NOT NULL, "destinoId" TEXT, "motivo" TEXT NOT NULL, "autorId" TEXT NOT NULL,
 "versao" INTEGER NOT NULL DEFAULT 1, "estadoAnterior" TEXT NOT NULL DEFAULT '{}',
 "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "atualizadoEm" DATETIME NOT NULL
);
CREATE TABLE "EventoGovernanca" (
 "id" TEXT NOT NULL PRIMARY KEY, "recursoId" TEXT NOT NULL, "acao" TEXT NOT NULL,
 "estadoAnterior" TEXT NOT NULL, "estadoNovo" TEXT NOT NULL, "autorId" TEXT NOT NULL,
 "motivo" TEXT NOT NULL, "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "EventoGovernanca_recursoId_fkey" FOREIGN KEY ("recursoId") REFERENCES "RecursoGovernado" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "PapelAcesso" (
 "id" TEXT NOT NULL PRIMARY KEY, "nome" TEXT NOT NULL, "descricao" TEXT NOT NULL DEFAULT '',
 "permissoes" TEXT NOT NULL DEFAULT '[]', "ativo" BOOLEAN NOT NULL DEFAULT true,
 "versao" INTEGER NOT NULL DEFAULT 1, "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "atualizadoEm" DATETIME NOT NULL
);
CREATE TABLE "RegraAcesso" (
 "id" TEXT NOT NULL PRIMARY KEY, "usuarioId" TEXT NOT NULL, "tipo" TEXT NOT NULL,
 "recursoId" TEXT NOT NULL, "efeito" TEXT NOT NULL,
 CONSTRAINT "RegraAcesso_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "EventoAcesso" (
 "id" TEXT NOT NULL PRIMARY KEY, "autorId" TEXT NOT NULL, "usuarioAlvoId" TEXT,
 "tipo" TEXT NOT NULL, "antes" TEXT NOT NULL DEFAULT '{}', "depois" TEXT NOT NULL DEFAULT '{}',
 "motivo" TEXT NOT NULL, "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "new_Usuario" (
 "id" TEXT NOT NULL PRIMARY KEY, "nome" TEXT NOT NULL, "usuario" TEXT NOT NULL,
 "senhaHash" TEXT NOT NULL, "perfil" TEXT NOT NULL DEFAULT 'CONSULTA',
 "ativo" BOOLEAN NOT NULL DEFAULT true, "acessoGlobal" BOOLEAN NOT NULL DEFAULT false,
 "papelAcessoId" TEXT, "permissoesExtras" TEXT NOT NULL DEFAULT '[]', "permissoesNegadas" TEXT NOT NULL DEFAULT '[]',
 "acessoVersao" INTEGER NOT NULL DEFAULT 1, "sessaoVersao" INTEGER NOT NULL DEFAULT 0,
 "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Usuario_papelAcessoId_fkey" FOREIGN KEY ("papelAcessoId") REFERENCES "PapelAcesso" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Usuario" ("criadoEm", "id", "nome", "perfil", "senhaHash", "usuario") SELECT "criadoEm", "id", "nome", "perfil", "senhaHash", "usuario" FROM "Usuario";
DROP TABLE "Usuario";
ALTER TABLE "new_Usuario" RENAME TO "Usuario";
CREATE UNIQUE INDEX "Usuario_usuario_key" ON "Usuario"("usuario");
CREATE INDEX "RecursoGovernado_tipo_status_idx" ON "RecursoGovernado"("tipo", "status");
CREATE INDEX "RecursoGovernado_destinoId_idx" ON "RecursoGovernado"("destinoId");
CREATE UNIQUE INDEX "RecursoGovernado_tipo_origemId_key" ON "RecursoGovernado"("tipo", "origemId");
CREATE INDEX "EventoGovernanca_recursoId_criadoEm_idx" ON "EventoGovernanca"("recursoId", "criadoEm");
CREATE UNIQUE INDEX "PapelAcesso_nome_key" ON "PapelAcesso"("nome");
CREATE INDEX "RegraAcesso_usuarioId_efeito_idx" ON "RegraAcesso"("usuarioId", "efeito");
CREATE UNIQUE INDEX "RegraAcesso_usuarioId_tipo_recursoId_key" ON "RegraAcesso"("usuarioId", "tipo", "recursoId");
CREATE INDEX "EventoAcesso_usuarioAlvoId_criadoEm_idx" ON "EventoAcesso"("usuarioAlvoId", "criadoEm");
CREATE INDEX "EventoAcesso_criadoEm_idx" ON "EventoAcesso"("criadoEm");

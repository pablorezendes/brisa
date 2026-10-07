import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
let pasta, arquivo;
const executar = (...args) => spawnSync(process.execPath, ["scripts/migrar-rbac.mjs", ...args], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: `file:${arquivo}` }, encoding: "utf8" });
beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), "brisa-migracao-rbac-")); arquivo = join(pasta, "fixture.db");
  const db = new DatabaseSync(arquivo);
  db.exec("CREATE TABLE Usuario (id TEXT NOT NULL PRIMARY KEY,nome TEXT NOT NULL,usuario TEXT NOT NULL,senhaHash TEXT NOT NULL,perfil TEXT NOT NULL DEFAULT 'ADMINISTRADOR',criadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE UNIQUE INDEX Usuario_usuario_key ON Usuario(usuario); CREATE TABLE Financeiro(id TEXT PRIMARY KEY,valor INTEGER,usuarioId TEXT REFERENCES Usuario(id));");
  db.prepare("INSERT INTO Usuario(id,nome,usuario,senhaHash,perfil) VALUES(?,?,?,?,?)").run("u", "Teste", "teste", "nao-senha-real", "ADMINISTRADOR");
  db.prepare("INSERT INTO Financeiro VALUES(?,?,?)").run("titulo", 12345, "u"); db.close();
});
afterEach(() => { const p = resolve(pasta); if (p.startsWith(resolve(tmpdir()) + sep) && basename(p).startsWith("brisa-migracao-rbac-")) rmSync(p, { recursive: true, force: true }); });
it("simulação não modifica schema nem cria backup", () => { const r = executar(); expect(r.status).toBe(0); expect(r.stdout).toContain("Pendente"); expect(readdirSync(pasta)).toEqual(["fixture.db"]); });
it("preserva usuários, dinheiro e FK; faz backup e segunda execução é idempotente", () => {
  const r = executar("--aplicar"); expect(r.status, r.stderr).toBe(0); expect(r.stdout).toContain("sem alteração nos dados originais");
  const db = new DatabaseSync(arquivo);
  expect(db.prepare("SELECT nome,perfil,senhaHash,acessoGlobal,sessaoVersao FROM Usuario").get()).toMatchObject({ nome: "Teste", perfil: "ADMINISTRADOR", senhaHash: "nao-senha-real", acessoGlobal: 0, sessaoVersao: 0 });
  expect(db.prepare("SELECT valor FROM Financeiro").get().valor).toBe(12345); expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  db.exec("INSERT INTO Usuario(id,nome,usuario,senhaHash) VALUES('novo','Novo','novo','hash')");
  expect(db.prepare("SELECT perfil FROM Usuario WHERE id='novo'").get().perfil).toBe("CONSULTA"); db.close();
  const segunda = executar("--aplicar"); expect(segunda.status).toBe(0); expect(segunda.stdout).toContain("Nenhum dado alterado"); expect(readdirSync(join(pasta, "backups-rbac"))).toHaveLength(1);
});
it("falha fechado no schema parcial", () => { const db = new DatabaseSync(arquivo); db.exec("ALTER TABLE Usuario ADD COLUMN ativo BOOLEAN DEFAULT 1"); db.close(); const r = executar("--aplicar"); expect(r.status).toBe(1); expect(r.stderr).toContain("SCHEMA_PARCIAL"); });
it("registro de versão mantém chave primária não nula compatível com schema", () => {
  expect(executar("--aplicar").status).toBe(0);
  const db = new DatabaseSync(arquivo);
  const estrutura = db.prepare("PRAGMA table_info('_BrisaMigration')").all();
  expect(estrutura.find(c => c.name === "versao").notnull).toBe(1); db.close();
});

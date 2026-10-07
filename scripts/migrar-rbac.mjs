import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(raiz, "prisma/updates/20261007_rbac_governanca.sql"), "utf8");
const hash = createHash("sha256").update(sql).digest("hex");
const versao = "20261007_rbac_governanca";
const args = process.argv.slice(2);
if (args.some(x => !["--aplicar"].includes(x))) throw new Error("ARGUMENTO_INVALIDO");
const url = process.env.DATABASE_URL;
if (!url?.startsWith("file:") || url.includes("?") || url === "file::memory:") throw new Error("DATABASE_URL_SQLITE_OBRIGATORIA");
const arquivo = url.slice(5);
// URLs relativas seguem a convenção do schema Prisma, nunca o cwd do operador.
const caminho = isAbsolute(arquivo) ? arquivo : resolve(raiz, "prisma", arquivo);
if (!existsSync(caminho)) { console.log("Banco ainda não existe; criação inicial deve usar prisma db push."); process.exit(0); }
const db = new DatabaseSync(caminho);
const q = nome => '"' + nome.replaceAll('"', '""') + '"';
const nomes = () => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x => x.name);
const colunas = tabela => db.prepare(`PRAGMA table_info(${q(tabela)})`).all().map(x => x.name);
const fingerprint = tabelas => Object.fromEntries(tabelas.map(({ nome, campos }) => {
  const registros = db.prepare(`SELECT ${campos.map(q).join(",")} FROM ${q(nome)}`).all().map(r => JSON.stringify(r, (_, v) => typeof v === "bigint" ? String(v) : v)).sort();
  return [nome, { linhas: registros.length, hash: createHash("sha256").update(JSON.stringify(registros)).digest("hex") }];
}));
try {
  db.exec("PRAGMA busy_timeout=15000;");
  const tabelas = nomes();
  if (!tabelas.includes("Usuario")) { console.log("Banco sem usuários; criação inicial deve usar prisma db push."); process.exitCode = 0; }
  else {
    const novas = ["PapelAcesso", "RegraAcesso", "EventoAcesso", "RecursoGovernado", "EventoGovernanca"];
    const camposNovos = ["ativo", "acessoGlobal", "papelAcessoId", "permissoesExtras", "permissoesNegadas", "acessoVersao", "sessaoVersao"];
    const camposUsuario = colunas("Usuario");
    const completa = novas.every(n => tabelas.includes(n)) && camposNovos.every(c => camposUsuario.includes(c));
    if (completa) {
      const registro = tabelas.includes("_BrisaMigration") ? db.prepare("SELECT hash FROM _BrisaMigration WHERE versao=?").get(versao) : null;
      if (registro && registro.hash !== hash) throw new Error("MIGRACAO_APLICADA_FOI_ALTERADA");
      if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("INTEGRIDADE_REFERENCIAL_INVALIDA");
      console.log("RBAC e governança já instalados. Nenhum dado alterado.");
    } else {
      if (novas.some(n => tabelas.includes(n)) || camposNovos.some(c => camposUsuario.includes(c))) throw new Error("SCHEMA_PARCIAL_EXIGE_REVISAO");
      if (!args.includes("--aplicar")) console.log("Pendente: RBAC e governança. Use --aplicar com a aplicação parada; o script cria backup e valida preservação integral.");
      else {
        if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("BANCO_ORIGINAL_COM_INCONSISTENCIA");
        const pasta = join(dirname(caminho), "backups-rbac");
        mkdirSync(pasta, { recursive: true, mode: 0o700 });
        const backup = join(pasta, `antes-rbac-${Date.now()}-${randomUUID()}.db`);
        db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}';`);
        console.log(`Backup consistente criado: ${backup}`);
        const originais = tabelas.map(nome => ({ nome, campos: colunas(nome) }));
        db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;");
        try {
          const antes = fingerprint(originais);
          db.exec(sql);
          const depois = fingerprint(originais);
          if (JSON.stringify(antes) !== JSON.stringify(depois)) throw new Error("DADOS_ANTERIORES_DIVERGENTES");
          if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("INTEGRIDADE_REFERENCIAL_INVALIDA");
          db.exec("CREATE TABLE IF NOT EXISTS _BrisaMigration (versao TEXT NOT NULL PRIMARY KEY, hash TEXT NOT NULL, aplicadoEm TEXT NOT NULL)");
          db.prepare("INSERT INTO _BrisaMigration (versao,hash,aplicadoEm) VALUES (?,?,?)").run(versao, hash, new Date().toISOString());
          db.exec("COMMIT;");
          console.log(`Migração concluída: ${originais.length} tabelas anteriores conferidas, sem alteração nos dados originais. Não administradores precisam de liberação explícita de carteira.`);
        } catch (erro) { db.exec("ROLLBACK;"); throw erro; }
        finally { db.exec("PRAGMA foreign_keys=ON;"); }
      }
    }
  }
} catch (erro) {
  console.error(erro instanceof Error && /^[A-Z_]+$/.test(erro.message) ? erro.message : "FALHA_MIGRACAO_RBAC: aplicação não deve iniciar; confira schema, backup e permissões de arquivo.");
  process.exitCode = 1;
} finally { db.close(); }

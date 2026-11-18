import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const MOTIVO = "Implantação: manter somente os contratos de origem Widesys na operação, conforme solicitação da administração.";
const AUTOR = "SISTEMA:LIMPEZA_CONTRATOS_ORIGEM";
const TABELAS_PRESERVADAS = [
  "Contrato", "ContratoLegado", "ContratoParteLegado", "Recebimento",
  "TituloFinanceiroLegado", "BaixaFinanceiraLegado", "MovimentoFinanceiroLegado",
  "RecebimentoWidesysLocal", "LancamentoCaixa", "PagamentoRecebimento", "Boleto", "ContaBancaria",
];

function fingerprint(db) {
  return Object.fromEntries(TABELAS_PRESERVADAS.map(tabela => {
    const hash = createHash("sha256");
    let registros = 0;
    for (const linha of db.prepare(`SELECT * FROM "${tabela}" ORDER BY id`).iterate()) {
      hash.update(JSON.stringify(linha));
      hash.update("\n");
      registros++;
    }
    return [tabela, { registros, hash: hash.digest("hex") }];
  }));
}

function previa(db) {
  const contratos = db.prepare(`
    SELECT c.id, g.id AS governancaId, g.versao, g.status, g.destinoId, g.motivo, g.estadoAnterior
    FROM Contrato c
    LEFT JOIN RecursoGovernado g ON g.tipo = 'CONTRATO' AND g.origemId = c.id
    WHERE g.id IS NULL OR g.status = 'ATIVO'
    ORDER BY c.id
  `).all();
  const widesys = db.prepare(`
    SELECT COUNT(*) AS total
    FROM ContratoLegado c
    LEFT JOIN RecursoGovernado g ON g.tipo = 'CONTRATO_LEGADO' AND g.origemId = c.id
    WHERE c.origem = 'WIDESYS' AND (g.id IS NULL OR g.status = 'ATIVO')
  `).get().total;
  const duplicados = db.prepare(`
    SELECT COUNT(*) AS total FROM (
      SELECT 1 FROM ContratoLegado WHERE origem = 'WIDESYS'
      GROUP BY origem, legadoId HAVING COUNT(*) > 1
    )
  `).get().total;
  return { contratos, widesys, duplicados };
}

/** Limpeza pontual da base existente. A criação de novos contratos segue o fluxo normal. */
export function removerContratosForaWidesys(caminho, aplicar = false) {
  if (!existsSync(caminho)) throw new Error("BANCO_NAO_ENCONTRADO");
  const db = new DatabaseSync(caminho, { readOnly: !aplicar });
  let backup = null;
  try {
    db.exec("PRAGMA busy_timeout = 15000");
    const inicial = previa(db);
    if (!aplicar || !inicial.contratos.length) return {
      modo: aplicar ? "APLICADO" : "PREVIA",
      contratosBrisaParaRemover: inicial.contratos.length,
      contratosBrisaRemovidos: 0,
      contratosWidesysDisponiveis: inicial.widesys,
      duplicidadesWidesys: inicial.duplicados,
      backup,
    };
    if (!inicial.widesys || inicial.duplicados) throw new Error("CONTRATOS_WIDESYS_EXIGEM_REVISAO");
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw new Error("BANCO_COM_INCONSISTENCIA");

    const pasta = join(dirname(caminho), "backups-atualizacao");
    mkdirSync(pasta, { recursive: true, mode: 0o700 });
    backup = join(pasta, `antes-remover-contratos-brisa-${Date.now()}-${randomUUID()}.db`);
    db.prepare("VACUUM INTO ?").run(backup);
    chmodSync(backup, 0o600);
    const copia = new DatabaseSync(backup, { readOnly: true });
    try {
      if (copia.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw new Error("BACKUP_INVALIDO");
    } finally { copia.close(); }

    db.exec("PRAGMA foreign_keys = ON");
    db.exec("BEGIN IMMEDIATE");
    try {
      const antes = fingerprint(db);
      const atual = previa(db);
      const agora = Date.now();
      const inserir = db.prepare(`
        INSERT INTO RecursoGovernado
          (id, tipo, origemId, status, destinoId, motivo, autorId, versao, estadoAnterior, criadoEm, atualizadoEm)
        VALUES (?, 'CONTRATO', ?, 'EXCLUIDO', NULL, ?, ?, 1, ?, ?, ?)
      `);
      const atualizar = db.prepare(`
        UPDATE RecursoGovernado SET status = 'EXCLUIDO', destinoId = NULL, motivo = ?, autorId = ?,
          versao = versao + 1, estadoAnterior = ?, atualizadoEm = ?
        WHERE id = ? AND status = 'ATIVO' AND versao = ?
      `);
      const evento = db.prepare(`
        INSERT INTO EventoGovernanca
          (id, recursoId, acao, estadoAnterior, estadoNovo, autorId, motivo, criadoEm)
        VALUES (?, ?, 'EXCLUIDO', 'ATIVO', 'EXCLUIDO', ?, ?, ?)
      `);
      for (const contrato of atual.contratos) {
        const id = contrato.governancaId ?? randomUUID();
        const estado = JSON.stringify({ exclusaoAdministrativa: true, anterior: contrato.governancaId ? {
          status: contrato.status, destinoId: contrato.destinoId, motivo: contrato.motivo, estadoAnterior: contrato.estadoAnterior,
        } : null });
        if (contrato.governancaId) {
          const resultado = atualizar.run(MOTIVO, AUTOR, estado, agora, id, contrato.versao);
          if (resultado.changes !== 1) throw new Error("CONTRATO_ALTERADO_DURANTE_LIMPEZA");
        } else inserir.run(id, contrato.id, MOTIVO, AUTOR, estado, agora, agora);
        evento.run(randomUUID(), id, AUTOR, MOTIVO, agora);
      }
      const depois = previa(db);
      if (depois.contratos.length || depois.widesys !== atual.widesys || depois.duplicados) throw new Error("CONTAGEM_DIVERGENTE");
      if (JSON.stringify(antes) !== JSON.stringify(fingerprint(db))) throw new Error("DADOS_FINANCEIROS_OU_CONTRATOS_DIVERGENTES");
      db.exec("COMMIT");
      return {
        modo: "APLICADO", contratosBrisaParaRemover: 0, contratosBrisaRemovidos: atual.contratos.length,
        contratosWidesysDisponiveis: depois.widesys, duplicidadesWidesys: depois.duplicados,
        dadosFinanceirosEContratosPreservados: true, backup,
      };
    } catch (erro) { db.exec("ROLLBACK"); throw erro; }
  } finally { db.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => !["--aplicar", "--dry-run"].includes(arg)) || args.includes("--aplicar") && args.includes("--dry-run")) throw new Error("ARGUMENTO_INVALIDO");
    const url = process.env.DATABASE_URL;
    if (!url?.startsWith("file:") || url.includes("?") || url === "file::memory:") throw new Error("DATABASE_URL_SQLITE_OBRIGATORIA");
    const arquivo = url.slice(5);
    const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const caminho = isAbsolute(arquivo) ? arquivo : resolve(raiz, "prisma", arquivo);
    console.log(JSON.stringify(removerContratosForaWidesys(caminho, args.includes("--aplicar")), null, 2));
  } catch (erro) {
    console.error(erro instanceof Error && /^[A-Z_]+$/.test(erro.message) ? erro.message : "FALHA_AO_REMOVER_CONTRATOS");
    process.exitCode = 1;
  }
}

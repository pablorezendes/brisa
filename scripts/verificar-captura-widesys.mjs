import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [arquivoBanco = "/data/brisa.db", arquivoManifesto = "/app/data/legacy-widesys/operacao/manifest.json"] = process.argv.slice(2);
const manifesto = JSON.parse(readFileSync(arquivoManifesto, "utf8"));
const db = new DatabaseSync(arquivoBanco, { readOnly: true });

const identidades = {
  ContratoLegado: "origem, legadoId",
  ContratoParteLegado: "origem, legadoId",
  TituloFinanceiroLegado: "origem, escopo, legadoId",
  BaixaFinanceiraLegado: "origem, escopo, legadoId",
  MovimentoFinanceiroLegado: "origem, escopo, legadoId",
};

try {
  const lote = db.prepare(`
    SELECT capturaId, capturadoEm, status, totalEsperado, totalProcessado, totalQuarentena
    FROM ImportacaoLegadoLote
    WHERE origem = 'WIDESYS'
    ORDER BY capturadoEm DESC
    LIMIT 1
  `).get();
  const duplicidades = Object.fromEntries(Object.entries(identidades).map(([tabela, campos]) => {
    const resultado = db.prepare(`
      SELECT COUNT(*) AS grupos FROM (
        SELECT 1 FROM "${tabela}" WHERE origem = 'WIDESYS'
        GROUP BY ${campos} HAVING COUNT(*) > 1
      )
    `).get();
    return [tabela, resultado.grupos];
  }));
  const capturaAplicada = Boolean(manifesto.complete && lote && manifesto.captureId === lote.capturaId
    && ["CONCLUIDO", "QUARENTENA"].includes(lote.status) && lote.totalEsperado === lote.totalProcessado);

  console.log(JSON.stringify({
    capturaDisponivel: manifesto.captureId,
    capturaCompleta: manifesto.complete === true,
    ultimoLote: lote ? { ...lote, capturadoEm: new Date(lote.capturadoEm).toISOString() } : null,
    capturaAplicada,
    duplicidadesPorIdentidade: duplicidades,
  }, null, 2));
  if (!capturaAplicada || Object.values(duplicidades).some(grupos => grupos > 0)) process.exitCode = 1;
} finally {
  db.close();
}

/** SQLite temporário + dados sintéticos; não abre nem copia a base de clientes. */
import { deepStrictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { lerOperacaoUnificada } from "../src/lib/unificacao/servico";
import { lerListaFinanceira } from "../src/lib/unificacao/leitura-financeira";

async function main() {
  const diretorio = mkdtempSync(join(tmpdir(), "brisa-benchmark-listas-"));
  const original = process.cwd();
  const db = new PrismaClient({ datasourceUrl: `file:${join(diretorio, "sintetico.db").replaceAll("\\", "/")}`, log: [{ emit: "event", level: "query" }] });
  let consultas = 0;
  let sqlMs = 0;
  db.$on("query", evento => { consultas++; sqlMs += evento.duration; });
  try {
    // Impede até a leitura incidental de data/dataset.json da aplicação.
    process.chdir(diretorio);
    for (const modelo of Prisma.dmmf.datamodel.models) {
      const colunas = modelo.fields.filter(f => f.kind !== "object").map(f => {
        const tipo = ["Int", "BigInt", "Boolean"].includes(f.type) ? "INTEGER" : f.type === "Float" ? "REAL" : f.type === "DateTime" ? "DATETIME" : "TEXT";
        const d = f.default;
        const padrao = typeof d === "boolean" ? ` DEFAULT ${d ? 1 : 0}` : typeof d === "number" ? ` DEFAULT ${d}` : typeof d === "string" ? ` DEFAULT '${d.replaceAll("'", "''")}'` : f.type === "DateTime" ? " DEFAULT CURRENT_TIMESTAMP" : "";
        return `"${f.name}" ${tipo}${f.isId ? " PRIMARY KEY" : ""}${f.isRequired ? " NOT NULL" : ""}${f.isUnique ? " UNIQUE" : ""}${padrao}`;
      });
      for (const campos of modelo.uniqueFields) colunas.push(`UNIQUE (${campos.map(c => `"${c}"`).join(",")})`);
      await db.$executeRawUnsafe(`CREATE TABLE "${modelo.name}" (${colunas.join(",")})`);
    }
    await db.empreendimento.create({ data: { id: "emp", nome: "SINTETICO" } });
    await db.unidade.create({ data: { id: "unidade", empreendimentoId: "emp", identificacao: "SINTETICA" } });
    await db.contrato.create({ data: { id: "contrato", unidadeId: "unidade", valorBase: 10000 } });
    await db.recebimento.createMany({ data: Array.from({ length: 700 }, (_, i) => ({ id: `r${i}`, contratoId: "contrato", empreendimentoId: "emp", competencia: `2026-${String(i % 12 + 1).padStart(2, "0")}`, mesLancamento: "2026-01", valor: 10000 + i })) });
    await db.pessoa.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, legadoId: `p${i}`, nome: `PESSOA SINTETICA ${i}`, nomeNorm: `PESSOA SINTETICA ${i}`, snapshot: "{}", snapshotHash: "sintetico" })) });
    for (const natureza of ["RECEBER", "PAGAR"] as const) {
      await db.tituloFinanceiroLegado.createMany({ data: Array.from({ length: 1000 }, (_, i) => ({
        id: `${natureza}${i}`, escopo: `TITULO_${natureza}`, legadoId: `${natureza}${i}`, ultimoItemId: `${natureza}${i}`, natureza,
        pessoaLegadoId: `p${i % 200}`, competencia: `2026-${String(i % 12 + 1).padStart(2, "0")}`, vencimento: "2026-01-10",
        valorDevido: 30000 + i, valorPago: i % 2 ? 30000 + i : 0, valorAberto: i % 2 ? 0 : 30000 + i,
        situacaoNormalizada: i % 2 ? "PAGO" : "PENDENTE", capturadoEm: new Date("2026-01-01"), snapshot: "{}", snapshotHash: "sintetico",
      })) });
    }
    await db.lancamentoCaixa.createMany({ data: Array.from({ length: 2500 }, (_, i) => ({ id: `caixa${i}`, mesReferencia: "2026-01", centroCusto: "SINTETICO", tipo: i % 2 ? "ENTRADA" : "SAIDA", valor: 20000 + i, descricao: `Caixa sintético ${i}`, data: "2026-01-10" })) });
    await db.movimentoFinanceiroLegado.createMany({ data: Array.from({ length: 1800 }, (_, i) => ({ id: `mov${i}`, legadoId: `mov${i}`, ultimoItemId: `mov${i}`, natureza: i % 2 ? "ENTRADA" : "SAIDA", descricao: `Movimento sintético ${i}`, dataMovimento: "2026-01-11", valor: 40000 + i, capturadoEm: new Date("2026-01-01"), snapshot: "{}", snapshotHash: "sintetico" })) });

    // Fotografia já analisada: mede o caminho normal, não só candidaturas novas.
    const inicial = await lerOperacaoUnificada(db);
    await db.unificacaoRegistro.createMany({ data: inicial.fontes.map(f => ({ chave: f.chave, dominio: f.dominio, origem: f.origem, origemId: f.origemId, hashFonte: f.hash, status: "ATIVO", candidatos: "[]", motivos: "[]" })) });
    const medidas: { leitura: string; rodada: number; consultas: number; sqlMs: number; totalMs: number; linhas: number }[] = [];
    for (let rodada = 0; rodada < 3; rodada++) {
      let completa: Awaited<ReturnType<typeof lerOperacaoUnificada>> | undefined;
      for (const leitura of ["COMPLETA", "RECEBER", "PAGAR"] as const) {
        consultas = 0; sqlMs = 0;
        const inicio = performance.now();
        const resultado = leitura === "COMPLETA" ? await lerOperacaoUnificada(db) : await lerListaFinanceira(db, leitura);
        const totalMs = Math.round(performance.now() - inicio);
        if (leitura === "COMPLETA") completa = resultado;
        else deepStrictEqual(resultado.linhas, completa!.linhas.filter(l => l.dominio === leitura));
        medidas.push({ leitura, rodada: rodada + 1, consultas, sqlMs, totalMs, linhas: resultado.linhas.length });
      }
    }
    console.log(JSON.stringify({ tipo: "SQLite + CPU sintéticos, sequencial; não mede HTTP nem produção", resultadosIdenticos: true, medidas }, null, 2));
  } finally {
    process.chdir(original);
    await db.$disconnect();
    const alvo = resolve(diretorio);
    if (!alvo.toLowerCase().startsWith(`${resolve(tmpdir())}${sep}`.toLowerCase()) || !basename(alvo).startsWith("brisa-benchmark-listas-")) throw new Error("Diretório temporário fora do escopo.");
    rmSync(alvo, { recursive: true, force: true });
  }
}
main().catch(erro => { console.error(erro); process.exitCode = 1; });

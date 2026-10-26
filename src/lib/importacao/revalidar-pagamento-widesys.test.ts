import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { it, expect } from "vitest";
import { criarSchemaSinteticoDespesas } from "../despesas/testes-banco";
import { revalidarPagamentoWidesys } from "./revalidar-pagamento-widesys";

it("revalida sem alterar datas, valores, snapshots, decisões manuais ou duplicar títulos", async () => {
  const pasta = mkdtempSync(join(tmpdir(), "brisa-revalidar-data-"));
  const db = new PrismaClient({ datasourceUrl: `file:${join(pasta, "teste.db").replaceAll("\\", "/")}` });
  try {
    await criarSchemaSinteticoDespesas(db);
    await db.pessoa.create({ data: { id: "fornecedor", legadoId: "fornecedor", origem: "WIDESYS", nome: "Fornecedor teste", nomeNorm: "FORNECEDOR TESTE", snapshot: "{}", snapshotHash: "original" } });
    for (const id of ["futuro", "copia", "invalida", "manual", "outra", "pago", "receber"]) {
      await db.tituloFinanceiroLegado.create({ data: { id, legadoId: id, ultimoItemId: id,
        natureza: id === "receber" ? "RECEBER" : "PAGAR", escopo: id === "receber" ? "TITULO_RECEBER" : "TITULO_PAGAR",
        vencimento: "2027-06-10", valorDevido: 57924, valorPago: id === "pago" ? 1 : 0, valorAberto: 57924,
        pessoaLegadoId: ["futuro", "copia"].includes(id) ? "fornecedor" : null,
        situacaoNormalizada: "PENDENTE", capturadoEm: new Date(), statusImportacao: "QUARENTENA",
        quarentenaMotivo: "TITULO_PAGAMENTO_INVALIDO" + (id === "outra" ? ";OUTRA_INCONSISTENCIA" : ""),
        snapshotHash: "original", snapshot: JSON.stringify({ campos: { tipo_de_pagamento: ["Cobrança Bancária"], ...(id === "invalida" ? { data_pagamento: "inválida" } : {}) } }),
      } });
      if (id === "manual") await db.unificacaoRegistro.create({ data: { chave: "WIDESYS:PAGAR:manual", origem: "WIDESYS", origemId: id,
        dominio: "PAGAR", status: "VINCULADO", destinoChave: "outro", hashFonte: "original", decisao: "MANUAL" } });
    }
    const antes = await db.tituloFinanceiroLegado.findMany({ orderBy: { id: "asc" } });
    expect(await revalidarPagamentoWidesys(db)).toMatchObject({ corrigiveis: 4, preservados: 3 });
    expect(await db.tituloFinanceiroLegado.findMany({ orderBy: { id: "asc" } })).toEqual(antes);
    const resultado = await revalidarPagamentoWidesys(db, true);
    expect(resultado.corrigiveis).toBe(4);
    expect(resultado.outrasInconsistencias).toBe(1);
    expect(await db.unificacaoRegistro.findMany({ where: { chave: { in: ["WIDESYS:PAGAR:futuro", "WIDESYS:PAGAR:copia"] } }, select: { status: true } })).toEqual([{ status: "PENDENTE" }, { status: "PENDENTE" }]);
    const depois = await db.tituloFinanceiroLegado.findMany({ orderBy: { id: "asc" } });
    const invariantes = (rows: typeof antes) => rows.map(row => Object.fromEntries(Object.entries(row)
      .filter(([key]) => !["statusImportacao", "quarentenaMotivo", "atualizadoEm"].includes(key))));
    expect(invariantes(depois)).toEqual(invariantes(antes));
    expect(await db.unificacaoDecisao.count()).toBe(4);
    expect(await db.unificacaoRegistro.findUnique({ where: { chave: "WIDESYS:PAGAR:manual" } })).toMatchObject({ decisao: "MANUAL", destinoChave: "outro" });
    expect(await revalidarPagamentoWidesys(db, true)).toMatchObject({ corrigiveis: 0 });
    expect(await db.unificacaoDecisao.count()).toBe(4);
    expect(await db.lancamentoCaixa.count()).toBe(0);
  } finally { await db.$disconnect(); rmSync(pasta, { recursive: true, force: true }); }
}, 30000);

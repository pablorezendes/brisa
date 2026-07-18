/**
 * Exportação Excel dos relatórios (GET ?tipo=comissao|resultado&ano=YYYY).
 * Abas e colunas com os mesmos nomes da planilha original (COMISSÃO, RESULTADO);
 * valores em reais com formato "#,##0.00".
 */

import ExcelJS from "exceljs";
import {
  matrizComissao,
  mesMaisRecenteComLancamentos,
  resultadoConsolidado,
} from "@/lib/consultas/relatorios";
import {
  NOME_MES_ABREV,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";

const FORMATO_MOEDA = "#,##0.00";

function reais(centavos: number): number {
  return centavos / 100;
}

function planilhaComissao(
  wb: ExcelJS.Workbook,
  m: Awaited<ReturnType<typeof matrizComissao>>
) {
  const ws = wb.addWorksheet("COMISSÃO");
  const meses = NOME_MES_ABREV.slice(1); // JAN..DEZ

  ws.columns = [
    { header: "EMPREENDIMENTO", key: "emp", width: 24 },
    ...meses.map((nome) => ({
      header: nome,
      key: nome,
      width: 12,
      style: { numFmt: FORMATO_MOEDA },
    })),
    {
      header: "TOTAL",
      key: "total",
      width: 14,
      style: { numFmt: FORMATO_MOEDA },
    },
  ];
  ws.getRow(1).font = { bold: true };

  for (const l of m.linhas) {
    ws.addRow([l.empreendimento, ...l.porMes.map(reais), reais(l.total)]);
  }
  const rodape = ws.addRow([
    "TOTAL",
    ...m.totalPorMes.map(reais),
    reais(m.totalGeral),
  ]);
  rodape.font = { bold: true };
}

function planilhaResultado(
  wb: ExcelJS.Workbook,
  r: Awaited<ReturnType<typeof resultadoConsolidado>>
) {
  const ws = wb.addWorksheet("RESULTADO");
  const moeda = { numFmt: FORMATO_MOEDA };
  ws.columns = [
    { header: "EMPREENDIMENTO", key: "emp", width: 22 },
    { header: "LOCALIZAÇÃO", key: "loc", width: 24 },
    { header: "LOCATÁRIO", key: "locatario", width: 30 },
    { header: "RECEBIDOS", key: "recebidos", width: 14, style: moeda },
    { header: "IPTU", key: "iptu", width: 12, style: moeda },
    { header: "COND.", key: "cond", width: 12, style: moeda },
    { header: "BASE CALCULO", key: "base", width: 14, style: moeda },
    { header: "COMISSÃO", key: "comissao", width: 14, style: moeda },
  ];
  ws.getRow(1).font = { bold: true };

  for (const l of r.linhas) {
    ws.addRow([
      l.empreendimento,
      l.identificacao,
      l.locatario ?? "",
      reais(l.recebidos),
      reais(l.iptu),
      reais(l.cond),
      reais(l.base),
      reais(l.comissao),
    ]);
  }
  const t = r.totalGeral;
  const rodape = ws.addRow([
    "TOTAL GERAL",
    "",
    "",
    reais(t.recebidos),
    reais(t.iptu),
    reais(t.cond),
    reais(t.base),
    reais(t.comissao),
  ]);
  rodape.font = { bold: true };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tipo = params.get("tipo");
  if (tipo !== "comissao" && tipo !== "resultado") {
    return Response.json(
      { erro: "Parâmetro tipo deve ser 'comissao' ou 'resultado'." },
      { status: 400 }
    );
  }

  const anoParam = Number(params.get("ano"));
  const ano =
    Number.isInteger(anoParam) && anoParam >= 2000 && anoParam <= 2100
      ? anoParam
      : parseCompetencia(await mesMaisRecenteComLancamentos()).ano;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Brisa — Gestão de Imóveis";

  if (tipo === "comissao") {
    planilhaComissao(wb, await matrizComissao(ano));
  } else {
    planilhaResultado(wb, await resultadoConsolidado(ano));
  }

  const buffer = await wb.xlsx.writeBuffer();

  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${tipo}-${ano}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Exportação Excel dos relatórios.
 * GET ?tipo=comissao|resultado & (ano=YYYY | de=YYYY-MM-DD&ate=YYYY-MM-DD).
 * Quando ?de/?ate estão presentes e válidos, exporta a janela do período
 * (mesma regra das telas); senão, o ano — comportamento original intacto.
 * Abas e colunas com os mesmos nomes da planilha original (COMISSÃO, RESULTADO);
 * valores em reais com formato "#,##0.00".
 */

import ExcelJS from "exceljs";
import {
  matrizComissao,
  matrizComissaoPeriodo,
  mesMaisRecenteComLancamentos,
  resultadoConsolidado,
  resultadoConsolidadoPeriodo,
  type LinhaResultado,
} from "@/lib/consultas/relatorios";
import {
  NOME_MES_ABREV,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";
import { parsePeriodo, rotulosCompetencias } from "@/lib/dominio/periodo";

const FORMATO_MOEDA = "#,##0.00";

function reais(centavos: number): number {
  return centavos / 100;
}

/** Dados da aba COMISSÃO — mesmo shape no modo ano (12 colunas) e período. */
interface DadosComissao {
  linhas: { empreendimento: string; porMes: number[]; total: number }[];
  totalPorMes: number[];
  totalGeral: number;
}

function planilhaComissao(
  wb: ExcelJS.Workbook,
  m: DadosComissao,
  colunas: string[]
) {
  const ws = wb.addWorksheet("COMISSÃO");

  ws.columns = [
    { header: "EMPREENDIMENTO", key: "emp", width: 24 },
    ...colunas.map((nome, i) => ({
      header: nome,
      key: `m${i}`,
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

/** Dados da aba RESULTADO — mesmo shape no modo ano e período. */
interface DadosResultado {
  linhas: LinhaResultado[];
  totalGeral: Pick<
    LinhaResultado,
    "recebidos" | "iptu" | "cond" | "base" | "comissao"
  >;
}

function planilhaResultado(wb: ExcelJS.Workbook, r: DadosResultado) {
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

  // ?de/?ate válidos vencem o ?ano — mesma regra das telas de relatório
  const periodo = parsePeriodo(
    params.get("de") ?? undefined,
    params.get("ate") ?? undefined
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = "Brisa — Gestão de Imóveis";

  let sufixoArquivo: string;

  if (periodo) {
    if (tipo === "comissao") {
      planilhaComissao(
        wb,
        await matrizComissaoPeriodo(periodo.meses),
        rotulosCompetencias(periodo.meses)
      );
    } else {
      planilhaResultado(wb, await resultadoConsolidadoPeriodo(periodo.meses));
    }
    sufixoArquivo = `${periodo.de}-a-${periodo.ate}`;
  } else {
    const anoParam = Number(params.get("ano"));
    const ano =
      Number.isInteger(anoParam) && anoParam >= 2000 && anoParam <= 2100
        ? anoParam
        : parseCompetencia(await mesMaisRecenteComLancamentos()).ano;

    if (tipo === "comissao") {
      planilhaComissao(wb, await matrizComissao(ano), NOME_MES_ABREV.slice(1));
    } else {
      planilhaResultado(wb, await resultadoConsolidado(ano));
    }
    sufixoArquivo = String(ano);
  }

  const buffer = await wb.xlsx.writeBuffer();

  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${tipo}-${sufixoArquivo}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

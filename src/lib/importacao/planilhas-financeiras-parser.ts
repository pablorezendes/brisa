import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import ExcelJS from "exceljs";

export const VERSAO_PARSER_PLANILHAS = "1";
export type TipoArquivoPlanilha = "CONTA_ACAMARGO" | "GASTOS_BRISA";
export type StatusRegistroPlanilha = "PRONTO" | "PENDENTE" | "PENDENTE_AUXILIAR" | "PENDENTE_RESERVADO";
export type RegistroPlanilhaFinanceira = {
  origemArquivo: string; hashArquivo: string; aba: string; linha: number;
  caixaOrigem: string;
  faixa: string; celulas: string; mesReferencia: string | null; data: string | null;
  centroCusto: "AL" | "CH" | "BRISA" | "GERAL";
  tipo: "SAIDA" | "ENTRADA" | "RECEB_DINHEIRO";
  valor: number | null; descricao: string | null; cliente: string | null;
  local: string | null; categoria: string | null; motivos: string[];
  status: StatusRegistroPlanilha; sourceJSON: string;
};
export type ControlePlanilhaFinanceira = {
  aba: string; celula: string; faixa: string | null;
  tipo: "SALDO_INICIAL" | "SUBTOTAL" | "TOTAL_FAIXA" | "RESUMO";
  formula: string | null; valorFonte: number | null; valorCalculado: number | null;
  diferenca: number | null; motivos: string[];
};
export type ResultadoPlanilhaFinanceira = {
  origemArquivo: string; hashArquivo: string; tipoArquivo: TipoArquivoPlanilha;
  registros: RegistroPlanilhaFinanceira[]; controles: ControlePlanilhaFinanceira[]; avisos: string[];
};

type Contexto = Pick<ResultadoPlanilhaFinanceira, "origemArquivo" | "hashArquivo" | "tipoArquivo">;
type Banda = { faixa: string; data: number; valor: number; descricao: number; local?: number;
  centroCusto: RegistroPlanilhaFinanceira["centroCusto"]; tipo: RegistroPlanilhaFinanceira["tipo"] };
type ValorCelula = ReturnType<typeof valor>;
const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
const texto = (v: unknown) => typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
const reservado = (s: string) => /COMISS|TAXA\s*(?:DE\s*)?ADM|HONORARIOS?\s*(?:DE\s*)?ADMIN/.test(normalizar(s));

function valor(c: ExcelJS.Cell): string | number | boolean | Date | ExcelJS.CellErrorValue | null {
  const v = c.value;
  if (v === null || v === undefined) return null;
  if (typeof v !== "object" || v instanceof Date || "error" in v) return v;
  // ExcelJS omits a cached zero from Cell.value's formula object, but exposes
  // the original cached result through Cell.result. Zero is not missing data.
  if ("formula" in v || "sharedFormula" in v) return c.result ?? null;
  if ("richText" in v) return v.richText.map((t) => t.text).join("");
  if ("text" in v) return v.text;
  return null;
}
function formula(c: ExcelJS.Cell): string | null {
  return c.type === ExcelJS.ValueType.Formula ? c.formula : null;
}
function dinheiro(v: unknown): number | null {
  if (typeof v === "string") {
    const limpo = v.trim().replace(/^R\$\s*/, "");
    if (!/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(limpo)) return null;
    v = Number(limpo.replace(/\./g, "").replace(",", "."));
  }
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const cents = Math.round((v + Math.sign(v) * Number.EPSILON) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Arithmetic-only evaluator: no eval, cell references, names, functions or external links. */
export function calcularAritmeticaPlanilha(input: string): number | null {
  if (/\d\s+\d/.test(input)) return null;
  const expr = input.replace(/^=/, "").replace(/\s+/g, "");
  if (!expr || expr.length > 250 || !/^[\d.+\-*/()]+$/.test(expr)) return null;
  const tokens = expr.match(/(?:\d+(?:\.\d*)?|\.\d+)|[+\-*/()]/g) ?? [];
  if (tokens.join("") !== expr) return null;
  let i = 0;
  function primary(): number {
    if (tokens[i] === "+") { i++; return primary(); }
    if (tokens[i] === "-") { i++; return -primary(); }
    if (tokens[i] === "(") { i++; const r = sum(); if (tokens[i++] !== ")") throw Error(); return r; }
    const token = tokens[i++];
    if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) throw Error();
    return Number(token);
  }
  function product(): number {
    let n = primary();
    while (tokens[i] === "*" || tokens[i] === "/") { const op = tokens[i++]; const r = primary(); n = op === "*" ? n * r : n / r; }
    return n;
  }
  function sum(): number {
    let n = product();
    while (tokens[i] === "+" || tokens[i] === "-") { const op = tokens[i++]; const r = product(); n = op === "+" ? n + r : n - r; }
    return n;
  }
  try { const n = sum(); return i === tokens.length && Number.isFinite(n) ? n : null; } catch { return null; }
}

function mesNome(s: string): number | null {
  const n = normalizar(s).replace(/\b20\d{2}\b/g, "").trim();
  const index = MESES.findIndex((m) => n.startsWith(m));
  return index < 0 ? null : index + 1;
}
function cabecalhoMes(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = normalizar(v);
  return /^(JAN(?:EIRO)?|FEV(?:EREIRO)?|MAR(?:C|CO)?|ABR(?:IL)?|MAI(?:O)?|JUN(?:HO)?|JUL(?:HO)?|AGO(?:STO)?|SET(?:EMBRO)?|OUT(?:UBRO)?|NOV(?:EMBRO)?|DEZ(?:EMBRO)?)(?:\s+20\d{2})?$/.test(s) ? mesNome(s) : null;
}
function anoCabecalho(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^20\d{2}$/.test(v.trim()) ? Number(v) : null;
  return n && Number.isInteger(n) && n >= 2000 && n <= 2099 ? n : null;
}
function competencia(ano: number | null, mes: number | null): string | null {
  return ano && mes ? `${ano}-${String(mes).padStart(2, "0")}` : null;
}
function dataISO(v: ValorCelula, periodo: string | null): { data: string | null; motivos: string[] } {
  let data: string | null = null;
  if (v instanceof Date && Number.isFinite(v.getTime())) data = v.toISOString().slice(0, 10);
  else if (typeof v === "string") {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(s)) data = s.slice(0, 10);
    else {
      const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2}|\d{4}))?$/);
      if (m && (m[3] || periodo)) {
        const ano = m[3] ? m[3].length === 2 ? `20${m[3]}` : m[3] : periodo!.slice(0, 4);
        data = `${ano}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      }
    }
  }
  if (data) {
    const d = new Date(`${data}T00:00:00.000Z`);
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== data) return { data: null, motivos: ["DATA_INVALIDA"] };
    return { data, motivos: periodo && data.slice(0, 7) !== periodo ? ["DATA_FORA_PERIODO"] : [] };
  }
  return { data: null, motivos: [v === null || v === "" ? "DATA_AUSENTE" : "DATA_INVALIDA"] };
}
function jsonCelula(c: ExcelJS.Cell): unknown {
  const v = valor(c);
  const f = formula(c);
  const serializavel = v instanceof Date ? Number.isFinite(v.getTime()) ? v.toISOString() : "DATA_INVALIDA" : v;
  return f ? { formula: f, resultado: serializavel } : serializavel;
}
function celulasDaBanda(s: ExcelJS.Worksheet, linha: number, b: Banda): ExcelJS.Cell[] {
  return [...new Set([b.data, b.valor, b.descricao, b.local].filter((v): v is number => !!v))]
    .sort((a, z) => a - z).map((col) => s.getCell(linha, col));
}
function registro(s: ExcelJS.Worksheet, linha: number, banda: Banda, periodo: string | null,
  categoria: string | null, ctx: Contexto, auxiliar = false): RegistroPlanilhaFinanceira {
  const data = dataISO(valor(s.getCell(linha, banda.data)), periodo);
  const valueCell = s.getCell(linha, banda.valor);
  const monetario = dinheiro(valor(valueCell));
  const descricao = texto(valor(s.getCell(linha, banda.descricao))) || null;
  const local = banda.local ? texto(valor(s.getCell(linha, banda.local))) || null : null;
  const motivos = [...data.motivos];
  const f = formula(valueCell);
  if (monetario === null) motivos.push("VALOR_INVALIDO_OU_AUSENTE");
  else if (monetario <= 0) motivos.push("VALOR_NAO_POSITIVO");
  if (f) {
    const calculado = calcularAritmeticaPlanilha(f);
    if (calculado === null) motivos.push("FORMULA_NAO_ARITMETICA");
    else if (monetario === null || dinheiro(calculado) !== monetario) motivos.push("FORMULA_CACHE_DIVERGENTE");
  }
  if (!descricao) motivos.push("DESCRICAO_AUSENTE");
  const mesReferencia = periodo ?? data.data?.slice(0, 7) ?? null;
  if (!mesReferencia) motivos.push("PERIODO_AUSENTE");
  if (auxiliar) motivos.push("ABA_OU_TABELA_AUXILIAR");
  const restrito = reservado(`${descricao ?? ""} ${categoria ?? ""}`);
  if (restrito) motivos.push("INFORMACAO_RESERVADA");
  const cells = celulasDaBanda(s, linha, banda);
  return {
    ...ctx, aba: s.name, linha, faixa: banda.faixa,
    caixaOrigem: ctx.tipoArquivo === "CONTA_ACAMARGO" ? "CONTA_ACAMARGO" : `GASTOS_BRISA:${s.name}`,
    celulas: `${cells[0].address}:${cells.at(-1)!.address}`, mesReferencia, data: data.data,
    centroCusto: banda.centroCusto, tipo: banda.tipo, valor: monetario,
    descricao: banda.tipo === "RECEB_DINHEIRO" ? null : descricao,
    cliente: banda.tipo === "RECEB_DINHEIRO" ? descricao : null, local, categoria, motivos,
    status: restrito ? "PENDENTE_RESERVADO" : auxiliar ? "PENDENTE_AUXILIAR" : motivos.length ? "PENDENTE" : "PRONTO",
    sourceJSON: JSON.stringify({ versao: VERSAO_PARSER_PLANILHAS, arquivo: ctx.origemArquivo,
      hashArquivo: ctx.hashArquivo, aba: s.name, linha, faixa: banda.faixa,
      celulas: Object.fromEntries(cells.map((c) => [c.address, jsonCelula(c)])) }),
  };
}
function controle(s: ExcelJS.Worksheet, cell: ExcelJS.Cell, faixa: string | null,
  tipo: ControlePlanilhaFinanceira["tipo"], calculado: number | null = null): ControlePlanilhaFinanceira {
  const fonte = dinheiro(valor(cell));
  const diferenca = fonte !== null && calculado !== null ? fonte - calculado : null;
  return { aba: s.name, celula: cell.address, faixa, tipo, formula: formula(cell),
    valorFonte: fonte, valorCalculado: calculado, diferenca,
    motivos: fonte === null ? ["CONTROLE_SEM_RESULTADO_VALIDO"] : diferenca !== null && diferenca !== 0 ? ["CONTROLE_DIVERGENTE"] : [] };
}
function saldoInicial(s: ExcelJS.Worksheet, cell: ExcelJS.Cell, faixa: string, out: ResultadoPlanilhaFinanceira) {
  out.controles.push(controle(s, cell, faixa, "SALDO_INICIAL"));
}
function formulaResumo(f: string | null, data: ValorCelula, descricao: string): boolean {
  if (!f) return false;
  if (/\b(?:SUM|SUBTOTAL|SUMIF|SUMIFS|SOMA)\s*\(/i.test(f)) return true;
  return calcularAritmeticaPlanilha(f) === null && (data === null || !descricao);
}
function cabeResumo(s: string) {
  return /^(?:TOTAL(?:\b|_)|SUBTOTAL|SALDO(?:\b|_))/i.test(normalizar(s));
}
function sumarizarBanda(s: ExcelJS.Worksheet, b: Banda, out: ResultadoPlanilhaFinanceira) {
  const controles = out.controles.filter((c) => c.aba === s.name && c.faixa === b.faixa && c.tipo === "SUBTOTAL");
  for (const c of controles) {
    const range = c.formula?.match(/^SUM\(\$?([A-Z]+)\$?(\d+)(?::\$?\1\$?(\d+))?\)$/i);
    if (range) {
      const start = Number(range[2]); const end = Number(range[3] ?? range[2]);
      const items = out.registros.filter((r) => r.aba === s.name && r.faixa === b.faixa && r.linha >= start && r.linha <= end);
      const otherControls = out.controles.filter((o) => o.aba === s.name && o.faixa === b.faixa && o.tipo !== "SALDO_INICIAL" && o !== c
        && Number(s.getCell(o.celula).row) >= start && Number(s.getCell(o.celula).row) <= end);
      if (!otherControls.length && items.every((r) => r.valor !== null)) {
        const saldos = out.controles.filter((o) => o.aba === s.name && o.faixa === b.faixa && o.tipo === "SALDO_INICIAL"
          && Number(s.getCell(o.celula).row) >= start && Number(s.getCell(o.celula).row) <= end);
        Object.assign(c, controle(s, s.getCell(c.celula), b.faixa, "SUBTOTAL", items.reduce((sum, r) => sum + (r.valor ?? 0), 0)
          + saldos.reduce((sum, r) => sum + (r.valorFonte ?? 0), 0)));
      }
    }
  }
  if (out.tipoArquivo !== "CONTA_ACAMARGO") return;
  const last = controles.at(-1);
  const rows = out.registros.filter((r) => r.aba === s.name && r.faixa === b.faixa);
  // The last SUM of one category is not a whole-band total. Require either a
  // formula combining subtotal cells or a single SUM that covers every row.
  if (!last || !rows.length || rows.some((r) => r.valor === null || r.linha > Number(s.getCell(last.celula).row))) return;
  const wholeRange = last.formula?.match(/^SUM\([A-Z]+(\d+):[A-Z]+(\d+)\)$/i);
  if (!wholeRange && !/\w\d+\s*\+\s*\w\d+/.test(last.formula ?? "")) return;
  if (wholeRange && rows.some((r) => r.linha < Number(wholeRange[1]) || r.linha > Number(wholeRange[2]))) return;
  const saldos = out.controles.filter((r) => r.aba === s.name && r.faixa === b.faixa && r.tipo === "SALDO_INICIAL"
    && (!wholeRange || (Number(s.getCell(r.celula).row) >= Number(wholeRange[1]) && Number(s.getCell(r.celula).row) <= Number(wholeRange[2]))));
  Object.assign(last, controle(s, s.getCell(last.celula), b.faixa, "TOTAL_FAIXA",
    rows.reduce((sum, r) => sum + (r.valor ?? 0), 0) + saldos.reduce((sum, r) => sum + (r.valorFonte ?? 0), 0)));
}

function parseConta(s: ExcelJS.Worksheet, ctx: Contexto, out: ResultadoPlanilhaFinanceira) {
  const ano = s.name.match(/\b(20\d{2})\b/)?.[1];
  const periodo = competencia(ano ? Number(ano) : null, mesNome(s.name));
  if (!periodo) { out.avisos.push(`${s.name}: aba de legenda ou sem período, não gera movimentos.`); return; }
  let shift = 0;
  let header = 0;
  for (let r = 1; r <= Math.min(8, s.rowCount); r++) {
    if (normalizar(texto(valor(s.getCell(r, 1)))) === "SAIDA") { header = r; break; }
    if (normalizar(texto(valor(s.getCell(r, 2)))) === "SAIDA") { header = r; shift = 1; break; }
  }
  if (!header) { out.avisos.push(`${s.name}: layout não reconhecido; nenhuma linha promovível.`); return; }
  const bandas: Banda[] = [
    { faixa: "SAIDA_AL", data: 1 + shift, valor: 2 + shift, descricao: 3 + shift, centroCusto: "AL", tipo: "SAIDA" },
    { faixa: "SAIDA_CH", data: 5 + shift, valor: 6 + shift, descricao: 7 + shift, centroCusto: "CH", tipo: "SAIDA" },
    { faixa: "ENTRADA", data: 9 + shift, valor: 10 + shift, descricao: 11 + shift, centroCusto: "GERAL", tipo: "ENTRADA" },
  ];
  const cash = normalizar(texto(valor(s.getCell(header, 13 + shift))));
  if (cash.startsWith("RECEBIMENTOS EM DINHEIRO")) bandas.push({ faixa: "RECEB_DINHEIRO", data: 13 + shift,
    valor: 14 + shift, descricao: 15 + shift, local: 16 + shift, centroCusto: "GERAL", tipo: "RECEB_DINHEIRO" });
  if (normalizar(texto(valor(s.getCell(header, 12 + shift)))) === "SAIDA") bandas.push({ faixa: "SAIDA_EXTRA",
    data: 12 + shift, valor: 13 + shift, descricao: 14 + shift, centroCusto: "GERAL", tipo: "SAIDA" });
  for (const b of bandas) {
    let categoria: string | null = null;
    let seenEntry = false;
    for (let row = header + 1; row <= s.rowCount; row++) {
      const d = valor(s.getCell(row, b.data)); const v = valor(s.getCell(row, b.valor));
      const vc = s.getCell(row, b.valor); const desc = texto(valor(s.getCell(row, b.descricao)));
      const dateText = texto(d);
      if (cabeResumo(texto(v))) {
        const fonte = formula(s.getCell(row, b.data)) ? s.getCell(row, b.data) : vc;
        out.controles.push(controle(s, fonte, null, "RESUMO")); continue;
      }
      if (v === null && typeof d === "string" && dateText && !dataISO(d, periodo).data && !cabeResumo(dateText)) {
        if (b.tipo === "SAIDA") categoria = dateText;
        continue;
      }
      if (v === null && !formula(vc) && !(desc && dataISO(d, periodo).data)) continue;
      if (formulaResumo(formula(vc), d, desc) || cabeResumo(dateText) || cabeResumo(desc)) {
        out.controles.push(controle(s, vc, b.faixa, "SUBTOTAL")); continue;
      }
      if (b.tipo === "ENTRADA" && !seenEntry && !desc && row <= header + 3 && dinheiro(v) !== null) {
        saldoInicial(s, vc, b.faixa, out); continue;
      }
      seenEntry = true;
      out.registros.push(registro(s, row, b, periodo, b.tipo === "SAIDA" ? categoria : null, ctx));
    }
    sumarizarBanda(s, b, out);
  }
}

function parseGastos(s: ExcelJS.Worksheet, ctx: Contexto, out: ResultadoPlanilhaFinanceira) {
  if (normalizar(s.name) === "PLAN2") {
    s.eachRow((r) => r.eachCell((c) => { if (formula(c) || (Number(c.col) > 1 && typeof valor(c) === "number")) out.controles.push(controle(s, c, null, "RESUMO")); }));
    out.avisos.push(`${s.name}: resumo não transacional; rótulos de ano não definem o período das células referenciadas.`);
    return;
  }
  // The user confirmed that Plan1, Plan3, Plan4 and ALIANA are distinct cash
  // books, not copies. Similar content across them cannot prove duplication.
  const auxiliar = !["PLAN1", "PLAN3", "PLAN4", "ALIANA"].includes(normalizar(s.name));
  const bandas: Banda[] = [
    { faixa: "SAIDA_BRISA", data: 1, descricao: 2, valor: 3, centroCusto: "BRISA", tipo: "SAIDA" },
    { faixa: "ENTRADA_BRISA", data: 5, descricao: 6, valor: 7, centroCusto: "BRISA", tipo: "ENTRADA" },
  ];
  const anosDireita = new Set<number>();
  s.eachRow((r) => { const y = anoCabecalho(valor(r.getCell(5))); if (y) anosDireita.add(y); });
  for (const b of bandas) {
    let ano: number | null = null; let mes: number | null = null; let categoria: string | null = null;
    for (let row = 1; row <= s.rowCount; row++) {
      const d = valor(s.getCell(row, b.data)); const v = valor(s.getCell(row, b.valor));
      const desc = texto(valor(s.getCell(row, b.descricao))); const vc = s.getCell(row, b.valor);
      const year = anoCabecalho(d);
      const sharedYear = b.data === 5 && d === null && v === null ? anoCabecalho(valor(s.getCell(row, 1))) : null;
      if (year && v === null && !desc) { ano = year; mes = null; continue; }
      if (sharedYear && !anosDireita.has(sharedYear)) { ano = sharedYear; mes = null; continue; }
      const month = cabecalhoMes(d);
      if (month && v === null && !desc) {
        const namedYear = typeof d === "string" ? d.match(/20\d{2}/)?.[0] : null;
        if (namedYear) ano = Number(namedYear);
        mes = month; categoria = null; continue;
      }
      if (typeof d === "string" && !desc && v === null && /^(?:GASTOS CAIXA|DESPESAS)/.test(normalizar(d))) { categoria = texto(d); continue; }
      if (v === null && !formula(vc) && !(desc && dataISO(d, competencia(ano, mes)).data)) continue;
      if (formulaResumo(formula(vc), d, desc) || cabeResumo(texto(d)) || cabeResumo(desc)) {
        out.controles.push(controle(s, vc, b.faixa, "SUBTOTAL")); continue;
      }
      if (v !== null && typeof v === "string" && normalizar(v) === "VALOR") continue;
      if (!ano && mes) {
        const primeiraData = dataISO(d, null).data;
        if (primeiraData && Number(primeiraData.slice(5, 7)) === mes) ano = Number(primeiraData.slice(0, 4));
      }
      out.registros.push(registro(s, row, b, competencia(ano, mes), categoria, ctx, auxiliar));
    }
    sumarizarBanda(s, b, out);
  }
  // A separate memo of vouchers is not proof of an additional cash movement.
  // Preserve it in staging rather than counting it a second time.
  if (normalizar(s.name) === "PLAN1") {
    for (let row = 1; row <= s.rowCount; row++) {
      const d = valor(s.getCell(row, 11));
      if (!dataISO(d, null).data) continue;
      for (const coluna of [12, 13]) {
        if (dinheiro(valor(s.getCell(row, coluna))) === null) continue;
        const b: Banda = { faixa: `VALES_AUXILIAR_${coluna}`, data: 11, valor: coluna, descricao: 10,
          local: coluna + 1, centroCusto: "BRISA", tipo: "SAIDA" };
        out.registros.push(registro(s, row, b, null, "DETALHAMENTO DE VALES", ctx, true));
      }
    }
  }
}

function preservarNumeroForaDaFaixa(s: ExcelJS.Worksheet, cell: ExcelJS.Cell, ctx: Contexto, out: ResultadoPlanilhaFinanceira) {
  const linha = Number(cell.row);
  const anotacaoBancaria = ctx.tipoArquivo === "GASTOS_BRISA" && Number(cell.col) === 8;
  const descricao = anotacaoBancaria ? texto(valor(s.getCell(linha, 6))) || null : null;
  const local = anotacaoBancaria ? texto(valor(s.getCell(linha, 9))) || null : null;
  const registroContexto = out.registros.find((r) => r.aba === s.name && r.linha === linha && r.faixa === "ENTRADA_BRISA");
  const ano = s.name.match(/\b(20\d{2})\b/)?.[1];
  const periodo = ctx.tipoArquivo === "CONTA_ACAMARGO" ? competencia(ano ? Number(ano) : null, mesNome(s.name)) : registroContexto?.mesReferencia ?? null;
  const data = dataISO(anotacaoBancaria ? valor(s.getCell(linha, 5)) : null, periodo);
  const restrito = reservado(descricao ?? "");
  const motivos = ["VALOR_FORA_FAIXA_TRANSACIONAL", "ABA_OU_TABELA_AUXILIAR", ...data.motivos];
  if (restrito) motivos.push("INFORMACAO_RESERVADA");
  const cells: [string, unknown][] = [];
  s.getRow(linha).eachCell((c) => cells.push([c.address, jsonCelula(c)]));
  out.registros.push({ ...ctx, aba: s.name, linha,
    caixaOrigem: ctx.tipoArquivo === "CONTA_ACAMARGO" ? "CONTA_ACAMARGO" : `GASTOS_BRISA:${s.name}`,
    faixa: `VALOR_AVULSO_${cell.address.replace(/\d+$/, "")}`, celulas: cell.address,
    mesReferencia: periodo ?? data.data?.slice(0, 7) ?? null, data: data.data,
    centroCusto: ctx.tipoArquivo === "CONTA_ACAMARGO" ? "GERAL" : "BRISA",
    tipo: anotacaoBancaria ? "ENTRADA" : "SAIDA", valor: dinheiro(valor(cell)), descricao,
    cliente: null, local, categoria: null, motivos, status: restrito ? "PENDENTE_RESERVADO" : "PENDENTE_AUXILIAR",
    sourceJSON: JSON.stringify({ versao: VERSAO_PARSER_PLANILHAS, arquivo: ctx.origemArquivo, hashArquivo: ctx.hashArquivo,
      aba: s.name, linha, celulaValor: cell.address, classificacaoNaoConfirmada: true, celulas: Object.fromEntries(cells) }),
  });
}

/** In-memory entry point also used by fixtures; does not mutate the workbook. */
export function parseWorkbookFinanceiro(workbook: ExcelJS.Workbook, ctx: Contexto): ResultadoPlanilhaFinanceira {
  const out: ResultadoPlanilhaFinanceira = { ...ctx, registros: [], controles: [], avisos: [] };
  for (const sheet of workbook.worksheets) {
    if (ctx.tipoArquivo === "CONTA_ACAMARGO") parseConta(sheet, ctx, out);
    else parseGastos(sheet, ctx, out);
    const conhecidas = new Set(out.controles.filter((c) => c.aba === sheet.name).map((c) => c.celula));
    for (const r of out.registros.filter((r) => r.aba === sheet.name)) {
      for (const endereco of Object.keys(JSON.parse(r.sourceJSON).celulas)) conhecidas.add(endereco);
    }
    // Include balances and checks placed outside the transactional columns.
    // They remain controls even when their formula has an Excel error.
    sheet.eachRow((r) => r.eachCell((c) => {
      if (formula(c) && !conhecidas.has(c.address)) {
        out.controles.push(controle(sheet, c, null, "RESUMO")); conhecidas.add(c.address);
      }
    }));
    const legenda = ctx.tipoArquivo === "CONTA_ACAMARGO" && !mesNome(sheet.name);
    const resumo = ctx.tipoArquivo === "GASTOS_BRISA" && normalizar(sheet.name) === "PLAN2";
    if (!legenda && !resumo) sheet.eachRow((r) => r.eachCell((c) => {
      const numero = valor(c);
      const ano = ctx.tipoArquivo === "GASTOS_BRISA" && [1, 5].includes(Number(c.col)) && anoCabecalho(numero);
      if (typeof numero === "number" && !conhecidas.has(c.address) && !ano) preservarNumeroForaDaFaixa(sheet, c, ctx, out);
    }));
  }
  for (const c of out.controles) if (c.motivos.length) out.avisos.push(`${c.aba}!${c.celula}: ${c.motivos.join(", ")}.`);
  return out;
}

/** Read-only XLSX extraction. Source bytes and cached formula results are preserved. */
export async function parsePlanilhaFinanceira(caminho: string): Promise<ResultadoPlanilhaFinanceira> {
  const origemArquivo = basename(caminho);
  const nome = normalizar(origemArquivo);
  const tipoArquivo = /^CONTA\s+AC(?:AMARGO)?\.XLSX$/.test(nome) ? "CONTA_ACAMARGO"
    : /^GASTOS\s+BRISA\s+AZUL\.XLSX$/.test(nome) ? "GASTOS_BRISA" : null;
  if (!tipoArquivo) throw new Error("Arquivo sem layout de importação reconhecido.");
  const bytes = await readFile(caminho);
  const hashArquivo = createHash("sha256").update(bytes).digest("hex");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  return parseWorkbookFinanceiro(workbook, { origemArquivo, hashArquivo, tipoArquivo });
}

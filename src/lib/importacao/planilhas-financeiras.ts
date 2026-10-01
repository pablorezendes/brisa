import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LancamentoCaixa, PrismaClient, Prisma } from "@prisma/client";
import { normalizar } from "../dominio/normalizacao";
import { reconstruirProvenienciaPlanilhas, type DatasetProveniencia } from "../unificacao/proveniencia-planilhas";
import type { RegistroPlanilhaFinanceira, ResultadoPlanilhaFinanceira } from "./planilhas-financeiras-parser";

export const VERSAO_CARGA_PLANILHAS = "financeiro-incremental-1";
type Banco = PrismaClient | Prisma.TransactionClient;
type CamposCaixa = Pick<LancamentoCaixa, "mesReferencia" | "centroCusto" | "tipo" | "categoria" | "data" | "valor" | "descricao" | "cliente" | "local" | "caixaOrigem">;
type Movimento = { chave: string; data: string | null; mes: string | null; valor: number | null; tipo: string; descricao: string | null; caixaOrigem?: string | null };
export type AnteriorPlanilha = { hashConteudo: string; tipoArquivo: string; caixaOrigem: string; aba: string; linha: number; faixa: string; lancamentoCaixaId: string | null };
export type ContextoCarga = {
  caixa: LancamentoCaixa[]; anteriores: AnteriorPlanilha[]; legados: Movimento[];
  mesesFechados: Set<string>; caixaComProvenienciaInicial: Set<string>; hoje: string;
};
export type ItemPlanejado = {
  registro: RegistroPlanilhaFinanceira; hashConteudo: string;
  status: "IMPORTADO" | "JA_EXISTENTE" | "PENDENTE";
  motivos: string[]; candidatos: string[]; lancamentoCaixaId: string | null; reservado: boolean;
};

const texto = (valor: string | null | undefined) => valor ? normalizar(valor) : null;
export function hashConteudoCaixa(r: Partial<CamposCaixa>): string {
  return createHash("sha256").update(JSON.stringify([
    r.mesReferencia ?? null, r.centroCusto, r.tipo, texto(r.categoria), r.data ?? null,
    r.valor ?? null, texto(r.descricao), texto(r.cliente), texto(r.local),
  ])).digest("hex");
}
const caixaCompativel = (a?: string | null, b?: string | null) => !a || !b || a === b;
const movimento = (r: RegistroPlanilhaFinanceira): Movimento => ({ chave: `${r.hashArquivo}:${r.aba}:${r.faixa}:${r.linha}`, data: r.data, mes: r.mesReferencia, valor: r.valor, tipo: r.tipo, descricao: r.descricao ?? r.cliente, caixaOrigem: r.caixaOrigem });
const equivalente = (a: Movimento, b: Movimento) => caixaCompativel(a.caixaOrigem, b.caixaOrigem) && a.tipo === b.tipo && a.valor != null && a.valor === b.valor && (
  Boolean(a.data && a.data === b.data) || Boolean(a.mes && a.mes === b.mes && texto(a.descricao) && texto(a.descricao) === texto(b.descricao))
);

/** Sugestões não são fusões: só uma proveniência anterior comprovada permite JA_EXISTENTE. */
export function planejarLinhaPlanilha(r: RegistroPlanilhaFinanceira, tipoArquivo: string, contexto: ContextoCarga, todas: RegistroPlanilhaFinanceira[]): ItemPlanejado {
  const hashConteudo = hashConteudoCaixa(r as Partial<CamposCaixa>);
  const reservado = r.status === "PENDENTE_RESERVADO" || /COMISS|TAXA.{0,20}ADMINISTR/.test(normalizar(`${r.descricao ?? ""} ${r.categoria ?? ""}`));
  const motivos = [...r.motivos];
  const candidatos = new Set<string>();
  const item: ItemPlanejado = { registro: r, hashConteudo, status: "PENDENTE", motivos, candidatos: [], lancamentoCaixaId: null, reservado };
  const terminar = (motivo?: string) => { if (motivo) motivos.push(motivo); item.motivos = [...new Set(motivos)]; item.candidatos = [...candidatos]; return item; };
  if (reservado) return terminar("CONTEUDO_RESERVADO");

  const iguais = contexto.caixa.filter(c => caixaCompativel(c.caixaOrigem, r.caixaOrigem) && hashConteudoCaixa(c) === hashConteudo);
  for (const c of iguais) candidatos.add(`BRISA:MOVIMENTO:${c.id}`);
  const repetidas = todas.filter(outro => outro.status === "PRONTO" && outro.caixaOrigem === r.caixaOrigem && hashConteudoCaixa(outro as Partial<CamposCaixa>) === hashConteudo);
  if (r.status === "PENDENTE_AUXILIAR") return terminar("ABA_AUXILIAR_CONFERIR");
  if (repetidas.length > 1) return terminar("CONTEUDO_REPETIDO_NA_CARGA");
  const anteriores = contexto.anteriores.filter(a => a.tipoArquivo === tipoArquivo && a.caixaOrigem === r.caixaOrigem && a.hashConteudo === hashConteudo);
  const comprovado = iguais.length === 1 && (
    anteriores.some(a => a.lancamentoCaixaId === iguais[0].id) ||
    (tipoArquivo === "CONTA_ACAMARGO" && contexto.caixaComProvenienciaInicial.has(iguais[0].id))
  );
  if (comprovado) {
    item.status = "JA_EXISTENTE"; item.lancamentoCaixaId = iguais[0].id;
    return terminar("PROVENIENCIA_ANTERIOR_CONFIRMADA");
  }
  // Registros excluídos/editados no sistema não reaparecem ao reenviar planilha.
  if (anteriores.length) return terminar("DESTINO_ANTERIOR_ALTERADO_OU_AUSENTE");
  if (contexto.anteriores.some(a => a.tipoArquivo === tipoArquivo && a.caixaOrigem === r.caixaOrigem && a.aba === r.aba && a.faixa === r.faixa && a.linha === r.linha && a.hashConteudo !== hashConteudo)) motivos.push("POSICAO_DA_ORIGEM_ALTERADA");
  if (!r.mesReferencia || !/^\d{4}-(0[1-9]|1[0-2])$/.test(r.mesReferencia)) motivos.push("MES_NAO_COMPROVADO");
  if (!r.data || !/^\d{4}-\d{2}-\d{2}$/.test(r.data)) motivos.push("DATA_NAO_COMPROVADA");
  if (r.data && r.data > contexto.hoje) motivos.push("DATA_FUTURA_CONFERIR");
  if (r.data && r.mesReferencia && r.data.slice(0, 7) !== r.mesReferencia) motivos.push("DATA_FORA_DO_PERIODO");
  if (!Number.isSafeInteger(r.valor) || r.valor === null || r.valor <= 0 || r.valor > 2_147_483_647) motivos.push("VALOR_NAO_IMPORTAVEL");
  if (r.mesReferencia && contexto.mesesFechados.has(r.mesReferencia)) motivos.push("MES_FECHADO");
  const desc = normalizar(r.descricao ?? r.cliente);
  if (!desc) motivos.push("DESCRICAO_AUSENTE");
  // Transferência, saldo e previsão não são receita/despesa realizada comprovada.
  if (/TRANSFER|RESGAT|APLICACAO|EMPREST|SAQUE|DEPOSITO.*CONTA|DISTRIBUICAO.*LUCRO|SALDO ANTERIOR|SALDO INICIAL/.test(desc)) motivos.push("TRANSFERENCIA_OU_PATRIMONIO_CONFERIR");
  if (/A PAGAR|PREVISAO|PREVIST[AO]|ORCAMENTO|NAO PAGO/.test(desc)) motivos.push("REALIZACAO_NAO_COMPROVADA");

  const m = movimento(r);
  for (const c of contexto.caixa) if (equivalente(m, { chave: c.id, data: c.data, mes: c.mesReferencia, valor: c.valor, tipo: c.tipo, descricao: c.descricao ?? c.cliente, caixaOrigem: c.caixaOrigem })) candidatos.add(`BRISA:MOVIMENTO:${c.id}`);
  for (const c of contexto.legados) if (equivalente(m, c)) candidatos.add(c.chave);
  for (const outro of todas) if (outro !== r && outro.status === "PRONTO" && equivalente(m, movimento(outro))) candidatos.add(`PLANILHA:${movimento(outro).chave}`);
  if (candidatos.size) motivos.push("POSSIVEL_DUPLICIDADE");
  if (r.status !== "PRONTO" && !motivos.length) motivos.push("ORIGEM_REQUER_CONFERENCIA");
  if (!motivos.length && r.status === "PRONTO") item.status = "IMPORTADO";
  return terminar();
}

async function contextoAtual(db: Banco, hoje: string, dataset?: DatasetProveniencia): Promise<ContextoCarga> {
  const [caixa, anteriores, movimentos, pagamentos, fechamentos] = await Promise.all([
    db.lancamentoCaixa.findMany(),
    db.importacaoPlanilhaLinha.findMany({ where: { status: { in: ["IMPORTADO", "JA_EXISTENTE"] } }, select: { hashConteudo: true, caixaOrigem: true, aba: true, linha: true, faixa: true, lancamentoCaixaId: true, lote: { select: { tipoArquivo: true } } } }),
    db.movimentoFinanceiroLegado.findMany({ where: { origem: "WIDESYS" }, select: { id: true, dataMovimento: true, competencia: true, valor: true, natureza: true, descricao: true } }),
    db.pagamentoRecebimento.findMany({ where: { status: "CONFIRMADO" }, select: { id: true, dataPagamento: true, valor: true } }),
    db.fechamentoMensal.findMany({ select: { mesLancamento: true } }),
  ]);
  const prova = dataset ? reconstruirProvenienciaPlanilhas(dataset, { recebimentos: [], lancamentosCaixa: caixa }).lancamentosCaixa : new Map();
  return {
    caixa: caixa.map(c => ({ ...c, caixaOrigem: c.caixaOrigem ?? (prova.has(c.id) ? "CONTA_ACAMARGO" : null) })), hoje, caixaComProvenienciaInicial: new Set(prova.keys()),
    anteriores: anteriores.map(({ lote, ...a }) => ({ ...a, tipoArquivo: lote.tipoArquivo })),
    mesesFechados: new Set(fechamentos.map(f => f.mesLancamento)),
    legados: [
      ...movimentos.map(m => ({ chave: `WIDESYS:MOVIMENTO:${m.id}`, data: m.dataMovimento, mes: m.competencia?.slice(0, 7) ?? m.dataMovimento?.slice(0, 7) ?? null, valor: m.valor === null ? null : Math.abs(m.valor), tipo: m.natureza, descricao: m.descricao })),
      ...pagamentos.map(p => ({ chave: `BRISA:BAIXA_RECEBER:${p.id}`, data: p.dataPagamento, mes: p.dataPagamento.slice(0, 7), valor: p.valor, tipo: "ENTRADA", descricao: null })),
    ],
  };
}

function dadosCaixa(r: RegistroPlanilhaFinanceira): CamposCaixa {
  if (!r.mesReferencia || r.valor === null) throw new Error("LINHA_SEM_DADOS_OPERACIONAIS");
  return { mesReferencia: r.mesReferencia, data: r.data, tipo: r.tipo, centroCusto: r.centroCusto, caixaOrigem: r.caixaOrigem,
    valor: r.valor, descricao: r.descricao, categoria: r.categoria, cliente: r.cliente, local: r.local };
}

export async function carregarPlanilhasFinanceiras(db: PrismaClient, arquivos: ResultadoPlanilhaFinanceira[], opcoes: { aplicar?: boolean; hoje?: string; dataset?: DatasetProveniencia } = {}) {
  const hoje = opcoes.hoje ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  // Fonte original opcional para demonstrar identidade, nunca substituída.
  let dataset = opcoes.dataset;
  const caminhoDataset = resolve(process.cwd(), "data/dataset.json");
  if (!dataset && existsSync(caminhoDataset)) dataset = JSON.parse(readFileSync(caminhoDataset, "utf8"));
  if (dataset && (!Array.isArray(dataset.recebimentos) || !dataset.livro_caixa || typeof dataset.livro_caixa !== "object")) throw new Error("DATASET_DE_PROVENIENCIA_INVALIDO");
  return db.$transaction(async tx => {
    const contexto = await contextoAtual(tx, hoje, dataset);
    const todas = arquivos.flatMap(a => a.registros);
    const resultados = [];
    for (const arquivo of arquivos) {
      const anterior = await tx.importacaoPlanilhaLote.findUnique({ where: { hashArquivo_versao: { hashArquivo: arquivo.hashArquivo, versao: VERSAO_CARGA_PLANILHAS } }, select: { id: true, resumo: true } });
      if (anterior) { resultados.push({ arquivo: arquivo.origemArquivo, loteId: anterior.id, repetido: true, resumo: JSON.parse(anterior.resumo) as Record<string, unknown> }); continue; }
      const itens = arquivo.registros.map(r => planejarLinhaPlanilha(r, arquivo.tipoArquivo, contexto, todas));
      const resumo = { total: itens.length, importados: itens.filter(i => i.status === "IMPORTADO").length,
        existentes: itens.filter(i => i.status === "JA_EXISTENTE").length, pendentes: itens.filter(i => i.status === "PENDENTE").length,
        reservados: itens.filter(i => i.reservado).length, controles: arquivo.controles.length,
        motivos: Object.fromEntries([...new Set(itens.flatMap(i => i.motivos))].map(m => [m, itens.filter(i => i.motivos.includes(m)).length])) };
      let loteId: string | null = null;
      if (opcoes.aplicar) {
        const lote = await tx.importacaoPlanilhaLote.create({ data: { arquivo: arquivo.origemArquivo, hashArquivo: arquivo.hashArquivo, tipoArquivo: arquivo.tipoArquivo, versao: VERSAO_CARGA_PLANILHAS, resumo: JSON.stringify(resumo), controles: JSON.stringify(arquivo.controles), avisos: JSON.stringify(arquivo.avisos) } });
        loteId = lote.id;
        const linhas: Prisma.ImportacaoPlanilhaLinhaCreateManyInput[] = [];
        for (const i of itens) {
          const r = i.registro;
          if (i.status === "IMPORTADO") {
            const criado = await tx.lancamentoCaixa.create({ data: dadosCaixa(r) });
            i.lancamentoCaixaId = criado.id;
            contexto.caixa.push(criado);
          }
          linhas.push({ loteId, aba: r.aba, linha: r.linha, faixa: r.faixa, celulas: r.celulas, hashConteudo: i.hashConteudo,
            mesReferencia: r.mesReferencia, data: r.data, centroCusto: r.centroCusto, caixaOrigem: r.caixaOrigem, tipo: r.tipo,
            // Valores fora de Int32 ficam apenas na evidência bruta, nunca truncados.
            valor: r.valor !== null && Number.isSafeInteger(r.valor) && Math.abs(r.valor) <= 2_147_483_647 ? r.valor : null,
            descricao: r.descricao, categoria: r.categoria, cliente: r.cliente, local: r.local, status: i.status,
            reservado: i.reservado, motivos: JSON.stringify(i.motivos), candidatos: JSON.stringify(i.candidatos),
            origemDados: r.sourceJSON, lancamentoCaixaId: i.lancamentoCaixaId });
        }
        for (let p = 0; p < linhas.length; p += 100) await tx.importacaoPlanilhaLinha.createMany({ data: linhas.slice(p, p + 100) });
      } else {
        // Simula a mesma sequência entre arquivos, sem gravar nada.
        for (const i of itens) if (i.status === "IMPORTADO") contexto.caixa.push({ id: `PREVIA:${i.hashConteudo}`, ...dadosCaixa(i.registro) });
      }
      resultados.push({ arquivo: arquivo.origemArquivo, loteId, repetido: false, resumo });
    }
    return { modo: opcoes.aplicar ? "APLICADO" : "PREVIA", arquivos: resultados };
  }, { maxWait: 15000, timeout: 120000 });
}

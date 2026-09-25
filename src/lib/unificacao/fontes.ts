import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PrismaClient, Prisma } from "@prisma/client";
import { normalizar } from "../dominio/normalizacao";
import type { CampoFonte, DominioUnificacao, FonteUnificacao } from "./tipos";

export type BancoUnificacao = PrismaClient | Prisma.TransactionClient;
export const chaveFonte = (origem: string, dominio: string, id: string) => `${origem}:${dominio}:${id}`;
export function hashUnificacao(valor: unknown): string {
  return createHash("sha256").update(JSON.stringify(valor)).digest("hex");
}
const campo = (rotulo: string, valor: string | number | null | undefined, tipo: CampoFonte["tipo"] = "texto"): CampoFonte => ({ rotulo, valor: valor ?? null, tipo });
const dinheiro = (rotulo: string, valor?: number | null) => campo(rotulo, valor, "dinheiro");
const qualidade = (status: string): FonteUnificacao["qualidade"] => status === "QUARENTENA" ? "QUARENTENA" : status === "AUSENTE_NA_FONTE" ? "AUSENTE" : "OK";
const motivos = (valor?: string | null): string[] => valor ? valor.split(";").filter(Boolean) : [];
const mes = (data?: string | null) => data && /^\d{4}-\d{2}/.test(data) ? data.slice(0, 7) : null;

function fonte(dominio: DominioUnificacao, origem: "BRISA" | "WIDESYS", id: string, dados: Omit<FonteUnificacao, "chave" | "dominio" | "origem" | "origemId" | "hash" | "nomeNorm" | "qualidade" | "motivos"> & Partial<Pick<FonteUnificacao, "nomeNorm" | "qualidade" | "motivos">>): FonteUnificacao {
  const registro = { chave: chaveFonte(origem, dominio, id), dominio, origem, origemId: id,
    qualidade: "OK" as const, motivos: [], nomeNorm: normalizar(dados.titulo), ...dados };
  return { ...registro, hash: hashUnificacao(registro) };
}

/** Lê a operação nas tabelas originais. Valores não são duplicados em outra tabela. */
export async function carregarFontesUnificacao(db: BancoUnificacao): Promise<FonteUnificacao[]> {
  const [locatarios, pessoas, unidades, imoveis, contratos, contratosLegados, recebimentos, titulos, pagamentos, baixas, caixa, movimentos, parametros] = await Promise.all([
    db.locatario.findMany(),
    db.pessoa.findMany({ where: { origem: "WIDESYS" }, include: { papeis: true, emails: { orderBy: { principal: "desc" } }, telefones: { orderBy: { principal: "desc" } } } }),
    db.unidade.findMany({ include: { empreendimento: true } }),
    db.imovelLegado.findMany({ where: { origem: "WIDESYS" } }),
    db.contrato.findMany({ include: { locatario: true, unidade: { include: { empreendimento: true } } } }),
    db.contratoLegado.findMany({ where: { origem: "WIDESYS" }, include: { partes: { orderBy: { ordem: "asc" } } } }),
    db.recebimento.findMany({ include: { contrato: { include: { locatario: true, unidade: true } }, empreendimento: true } }),
    db.tituloFinanceiroLegado.findMany({ where: { origem: "WIDESYS" } }),
    db.pagamentoRecebimento.findMany(),
    db.baixaFinanceiraLegado.findMany({ where: { origem: "WIDESYS" } }),
    db.lancamentoCaixa.findMany(),
    db.movimentoFinanceiroLegado.findMany({ where: { origem: "WIDESYS" } }),
    db.catalogoLegadoRegistro.findMany({ where: { origem: "WIDESYS" }, select: { id: true, modulo: true, legadoId: true, titulo: true, label: true, status: true, quarentenaMotivo: true, snapshotHash: true } }),
  ]);
  const pLegado = new Map(pessoas.map(p => [p.legadoId, p]));
  const iLegado = new Map(imoveis.map(i => [i.legadoId, i]));
  const cLegado = new Map(contratosLegados.map(c => [c.legadoId, c]));
  const tLegado = new Map(titulos.map(t => [`${t.escopo}:${t.legadoId}`, t]));
  const locPorPessoa = new Map(locatarios.filter(l => l.pessoaId).map(l => [l.pessoaId!, l]));
  const pessoaContrato = (id?: string | null) => {
    const c = id ? cLegado.get(id) : null;
    const parte = c?.partes.find(p => p.papel === "INQUILINO" && p.statusImportacao !== "QUARENTENA");
    return parte?.pessoaLegadoId ? pLegado.get(parte.pessoaLegadoId) : null;
  };
  const pessoaTitulo = (t: typeof titulos[number]) => t.pessoaLegadoId
    ? pLegado.get(t.pessoaLegadoId)
    : t.natureza === "RECEBER" ? pessoaContrato(t.contratoLegadoId) : null;
  const fontes: FonteUnificacao[] = [];
  for (const l of locatarios) fontes.push(fonte("PESSOA", "BRISA", l.id, {
    titulo: l.nome, descricao: "Inquilino da operação atual", href: `/cadastros/locatarios?editar=${l.id}`,
    documento: l.cpfCnpj, papeis: ["INQUILINO"], campos: {
      nome: campo("Nome", l.nome), documento: campo("CPF/CNPJ", l.cpfCnpj, "documento"), email: campo("E-mail", l.email), telefone: campo("Telefone", l.telefone ?? l.contato),
      endereco: campo("Endereço", l.endereco), numero: campo("Número", l.numeroEndereco), bairro: campo("Bairro", l.bairro), cidade: campo("Cidade", l.cidade), uf: campo("UF", l.uf), cep: campo("CEP", l.cep),
    },
  }));
  for (const p of pessoas) fontes.push(fonte("PESSOA", "WIDESYS", p.id, {
    titulo: p.nome, descricao: p.papeis.map(v => v.papel).join(" · "), href: `/cadastros/pessoas/${p.id}`,
    documento: p.cpfCnpj, papeis: p.papeis.map(v => v.papel), vinculoExplicito: locPorPessoa.has(p.id) ? chaveFonte("BRISA", "PESSOA", locPorPessoa.get(p.id)!.id) : null,
    campos: { nome: campo("Nome", p.nome), documento: campo("CPF/CNPJ", p.cpfCnpj, "documento"), email: campo("E-mail", p.emails[0]?.email), telefone: campo("Telefone", p.telefones[0]?.telefone), endereco: campo("Endereço", p.endereco), numero: campo("Número", p.numeroEndereco), bairro: campo("Bairro", p.bairro), cidade: campo("Cidade", p.cidade), uf: campo("UF", p.uf), cep: campo("CEP", p.cep), papel: campo("Papéis", p.papeis.map(v => v.papel).join(", ")) },
  }));
  for (const u of unidades) fontes.push(fonte("IMOVEL", "BRISA", u.id, {
    titulo: `${u.empreendimento.nome} · ${u.identificacao}`, nomeNorm: normalizar(u.identificacao), descricao: u.tipo, href: `/cadastros/unidades?editar=${u.id}`,
    campos: { nome: campo("Identificação", u.identificacao), empreendimento: campo("Empreendimento", u.empreendimento.nome), tipo: campo("Tipo", u.tipo), ativo: campo("Ativo", u.ativo ? "Sim" : "Não") },
  }));
  for (const i of imoveis) fontes.push(fonte("IMOVEL", "WIDESYS", i.id, {
    titulo: i.nome ?? i.referencia ?? `Imóvel ${i.legadoId}`, descricao: [i.empreendimentoNome, i.endereco, i.numeroEndereco].filter(Boolean).join(" · "), href: `/cadastros/imoveis-legado/${i.id}`,
    campos: { nome: campo("Identificação", i.nome), referencia: campo("Referência", i.referencia), empreendimento: campo("Empreendimento", i.empreendimentoNome), tipo: campo("Tipo", i.tipo), endereco: campo("Endereço", i.endereco), numero: campo("Número", i.numeroEndereco), cidade: campo("Cidade", i.cidade), uf: campo("UF", i.uf), aluguel: dinheiro("Aluguel", i.valorLocacao), iptu: dinheiro("IPTU", i.valorIptu), cond: dinheiro("Condomínio", i.valorCondominio) },
  }));
  for (const c of contratos) fontes.push(fonte("CONTRATO", "BRISA", c.id, {
    titulo: `${c.unidade.empreendimento.nome} · ${c.unidade.identificacao}`, descricao: c.locatario?.nome ?? "Sem inquilino", href: `/contratos/${c.id}`,
    pessoaChave: c.locatarioId ? chaveFonte("BRISA", "PESSOA", c.locatarioId) : null, imovelChave: chaveFonte("BRISA", "IMOVEL", c.unidadeId), valor: c.valorBase,
    campos: { pessoa: campo("Inquilino", c.locatario?.nome), imovel: campo("Imóvel", c.unidade.identificacao), inicio: campo("Início", c.inicio), fim: campo("Fim", c.fim), aluguel: dinheiro("Aluguel", c.valorBase), iptu: dinheiro("IPTU", c.iptu), cond: dinheiro("Condomínio", c.condominio), situacao: campo("Situação", c.status), observacao: campo("Observação", c.observacao) },
  }));
  for (const c of contratosLegados) {
    const p = pessoaContrato(c.legadoId); const i = c.imovelLegadoId ? iLegado.get(c.imovelLegadoId) : null;
    fontes.push(fonte("CONTRATO", "WIDESYS", c.id, {
      titulo: `Contrato ${c.numeroContrato ?? c.legadoId} · ${i?.nome ?? i?.referencia ?? "Imóvel a conferir"}`, descricao: p?.nome ?? "Partes a conferir", href: null,
      qualidade: qualidade(c.statusImportacao), motivos: motivos(c.quarentenaMotivo), valor: c.valorLocacao,
      pessoaChave: p ? chaveFonte("WIDESYS", "PESSOA", p.id) : null, imovelChave: i ? chaveFonte("WIDESYS", "IMOVEL", i.id) : null,
      campos: { numero: campo("Contrato", c.numeroContrato), pessoa: campo("Inquilino", p?.nome), imovel: campo("Imóvel", i?.nome ?? i?.referencia), inicio: campo("Início", c.inicio), fim: campo("Fim", c.fim), aluguel: dinheiro("Aluguel", c.valorLocacao), administracao: dinheiro("Administração na fonte", c.valorAdministracao), situacao: campo("Situação", c.situacaoOrigem), partes: campo("Partes contratuais", c.partes.map(parte => `${parte.papel}: ${pLegado.get(parte.pessoaLegadoId ?? "")?.nome ?? "referência " + (parte.pessoaLegadoId ?? "não informada")}`).join("; ")) },
    }));
  }
  for (const r of recebimentos) {
    const devido = r.valor + r.iptu + r.cond; const pago = r.recebido ?? 0;
    const dia = r.contrato.diaVencimento;
    const venc = dia ? `${r.competencia}-${String(Math.min(dia, new Date(Number(r.competencia.slice(0, 4)), Number(r.competencia.slice(5, 7)), 0).getDate())).padStart(2, "0")}` : null;
    fontes.push(fonte("RECEBER", "BRISA", r.id, {
      titulo: r.contrato.locatario?.nome ?? r.contrato.unidade.identificacao, descricao: `${r.empreendimento.nome} · ${r.contrato.unidade.identificacao}`, href: `/recebimentos?visao=locacao&mes=${r.mesLancamento}&editar=${r.id}`,
      pessoaChave: r.contrato.locatarioId ? chaveFonte("BRISA", "PESSOA", r.contrato.locatarioId) : null, contratoChave: chaveFonte("BRISA", "CONTRATO", r.contratoId), imovelChave: chaveFonte("BRISA", "IMOVEL", r.contrato.unidadeId),
      competencia: r.competencia, data: r.dataPagamento, vencimento: venc, valor: devido, pago, aberto: Math.max(devido - pago, 0), informativo: devido === 0 && pago === 0,
      campos: { pessoa: campo("Pagador", r.contrato.locatario?.nome), imovel: campo("Imóvel", r.contrato.unidade.identificacao), competencia: campo("Competência", r.competencia), mesLancamento: campo("Mês operacional", r.mesLancamento), vencimento: campo("Vencimento pelo contrato", venc), valor: dinheiro("Devido", devido), pago: dinheiro("Pago", pago), aberto: dinheiro("Saldo", Math.max(devido-pago,0)), aluguel: dinheiro("Aluguel", r.valor), iptu: dinheiro("IPTU", r.iptu), cond: dinheiro("Condomínio", r.cond), taxa: campo("Comissão (bps)", r.taxaComissaoBps), observacao: campo("Observação", r.observacao), origemAgregada: campo("Temporada agregada", r.origemAgregada ? "Sim" : "Não") },
    }));
  }
  for (const t of titulos) {
    const p = pessoaTitulo(t); const c = cLegado.get(t.contratoLegadoId ?? ""); const i = c?.imovelLegadoId ? iLegado.get(c.imovelLegadoId) : null;
    fontes.push(fonte(t.natureza === "PAGAR" ? "PAGAR" : "RECEBER", "WIDESYS", t.id, {
      titulo: p?.nome ?? `${t.natureza === "PAGAR" ? "Pagamento" : "Cobrança"} ${t.legadoId}`, descricao: [i?.nome ?? i?.referencia, t.tipoCobrancaRotulo, t.planoContaRotulo].filter(Boolean).join(" · "), href: null,
      qualidade: qualidade(t.statusImportacao), motivos: motivos(t.quarentenaMotivo), pessoaChave: p ? chaveFonte("WIDESYS", "PESSOA", p.id) : null, contratoChave: c ? chaveFonte("WIDESYS", "CONTRATO", c.id) : null, imovelChave: i ? chaveFonte("WIDESYS", "IMOVEL", i.id) : null,
      competencia: mes(t.competencia) ?? mes(t.vencimento), data: t.pagamento, vencimento: t.vencimento, valor: t.valorDevido, pago: t.valorPago, aberto: t.valorAberto, cancelado: t.situacaoNormalizada === "CANCELADO",
      campos: { pessoa: campo("Contraparte", p?.nome), imovel: campo("Imóvel", i?.nome ?? i?.referencia), competencia: campo("Competência", t.competencia), vencimento: campo("Vencimento", t.vencimento), valor: dinheiro("Devido", t.valorDevido), pago: dinheiro("Pago", t.valorPago), aberto: dinheiro("Saldo", t.valorAberto), documento: campo("Documento", t.numeroDocumento), parcela: campo("Parcela", t.parcela), conta: campo("Conta bancária", t.contaBancariaRotulo), plano: campo("Plano de contas", t.planoContaRotulo), situacao: campo("Situação na captura", t.situacaoNormalizada), composicao: campo("Composição para comissão", "Pendente de discriminar aluguel, IPTU, condomínio e taxa") },
    }));
  }
  for (const b of pagamentos) fontes.push(fonte("BAIXA_RECEBER", "BRISA", b.id, {
    titulo: `Recebimento · ${b.forma}`, descricao: b.status, href: "/financeiro/conciliacao", tituloChave: chaveFonte("BRISA", "RECEBER", b.recebimentoId), data: b.dataPagamento, valor: b.valor, cancelado: b.status === "ESTORNADO", informativo: true,
    campos: { data: campo("Data", b.dataPagamento), valor: dinheiro("Valor", b.valor), forma: campo("Forma", b.forma), situacao: campo("Situação", b.status), identificador: campo("Identificador bancário", b.identificadorBanco) },
  }));
  for (const b of baixas) {
    const t = tLegado.get(`${b.tituloEscopo}:${b.tituloLegadoId}`); const p = t ? pessoaTitulo(t) : null;
    const dominio = b.escopo === "BAIXA_PAGAR" ? "BAIXA_PAGAR" : "BAIXA_RECEBER";
    fontes.push(fonte(dominio, "WIDESYS", b.id, {
      titulo: p?.nome ?? `${dominio === "BAIXA_PAGAR" ? "Pagamento" : "Recebimento"} ${b.legadoId}`, descricao: b.forma ?? "Forma não informada", href: null, qualidade: qualidade(b.statusImportacao), motivos: motivos(b.quarentenaMotivo),
      tituloChave: t ? chaveFonte("WIDESYS", t.natureza === "PAGAR" ? "PAGAR" : "RECEBER", t.id) : null, valor: b.valor, data: b.dataPagamento, cancelado: b.estornada, informativo: true,
      campos: { data: campo("Data", b.dataPagamento), valor: dinheiro("Valor", b.valor), forma: campo("Forma", b.forma), conta: campo("Conta", b.contaBancariaRotulo), movimento: campo("Movimento na origem", b.movimentoLegadoId), situacao: campo("Situação", b.estornada ? "Estornado" : "Confirmado"), tratamento: campo("Tratamento", "Detalhe de liquidação já considerado no valor pago do título; não soma uma segunda vez") },
    }));
  }
  for (const l of caixa) fontes.push(fonte("MOVIMENTO", "BRISA", l.id, {
    titulo: l.descricao ?? l.cliente ?? l.categoria ?? "Lançamento", descricao: `${l.centroCusto} · ${l.categoria ?? l.tipo}`, href: `/caixa/${l.id}/editar`, data: l.data, competencia: l.mesReferencia,
    natureza: l.tipo === "SAIDA" ? "SAIDA" : "ENTRADA", valor: l.valor, informativo: l.tipo === "RECEB_DINHEIRO",
    campos: { data: campo("Data", l.data), valor: dinheiro("Valor", l.valor), natureza: campo("Natureza", l.tipo), descricao: campo("Descrição", l.descricao), centro: campo("Centro de custo", l.centroCusto), categoria: campo("Categoria", l.categoria), tratamento: campo("Tratamento", l.tipo === "RECEB_DINHEIRO" ? "Registro paralelo, fora do saldo" : "Compõe o saldo") },
  }));
  for (const m of movimentos) {
    const t = m.tituloEscopo && m.tituloLegadoId ? tLegado.get(`${m.tituloEscopo}:${m.tituloLegadoId}`) : null;
    fontes.push(fonte("MOVIMENTO", "WIDESYS", m.id, {
      titulo: m.descricao ?? m.planoContaRotulo ?? `Movimento ${m.legadoId}`, descricao: m.contaBancariaRotulo ?? "Conta não informada", href: null, qualidade: qualidade(m.statusImportacao), motivos: motivos(m.quarentenaMotivo),
      data: m.dataMovimento, competencia: mes(m.competencia) ?? mes(m.dataMovimento), natureza: m.natureza, valor: m.valor === null ? null : Math.abs(m.valor), informativo: m.natureza === "TRANSFERENCIA",
      tituloChave: t ? chaveFonte("WIDESYS", t.natureza === "PAGAR" ? "PAGAR" : "RECEBER", t.id) : null,
      campos: { data: campo("Data", m.dataMovimento), valor: dinheiro("Valor", m.valor === null ? null : Math.abs(m.valor)), natureza: campo("Natureza", m.natureza), descricao: campo("Descrição", m.descricao), conta: campo("Conta", m.contaBancariaRotulo), categoria: campo("Plano de contas", m.planoContaRotulo), documento: campo("Documento", m.documento), tratamento: campo("Tratamento", m.natureza === "TRANSFERENCIA" ? "Transferência interna, fora de receita/despesa" : "Movimento de caixa; não resoma a baixa do título") },
    }));
  }
  for (const p of parametros) fontes.push(fonte("PARAMETRO", "WIDESYS", p.id, {
    titulo: p.status === "QUARENTENA" ? `Parâmetro protegido · ${p.modulo}` : p.label ?? p.titulo ?? `${p.modulo} ${p.legadoId}`, descricao: p.modulo, href: null, qualidade: qualidade(p.status), motivos: motivos(p.quarentenaMotivo),
    campos: { modulo: campo("Módulo", p.modulo), referencia: campo("Referência na origem", p.legadoId), uso: campo("Uso", "Referência importada; parâmetros bancários exigem configuração própria") },
  }));
  // Proveniência das planilhas só será atribuída quando comprovada pelo
  // fingerprint completo. A ausência do dataset no servidor não impede uso.
  const datasetPath = resolve(process.cwd(), "data/dataset.json");
  if (existsSync(datasetPath)) {
    const { reconstruirProvenienciaPlanilhas } = await import("./proveniencia-planilhas");
    const prova = reconstruirProvenienciaPlanilhas(JSON.parse(readFileSync(datasetPath, "utf8")), {
      recebimentos: recebimentos.map(r => ({ ...r, empreendimentoNome: r.empreendimento.nome, unidadeIdentificacao: r.contrato.unidade.identificacao, locatarioNome: r.contrato.locatario?.nome ?? null })),
      lancamentosCaixa: caixa,
    });
    for (const f of fontes) {
      if (f.origem !== "BRISA") continue;
      const p = f.dominio === "RECEBER" ? prova.recebimentos.get(f.origemId) : f.dominio === "MOVIMENTO" ? prova.lancamentosCaixa.get(f.origemId) : null;
      if (p) f.proveniencia = { ...p };
    }
  }
  return fontes;
}

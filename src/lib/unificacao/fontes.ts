import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LancamentoCaixa, PrismaClient, Prisma } from "@prisma/client";
import { normalizar } from "../dominio/normalizacao";
import { categoriaDespesa } from "../despesas/categorias";
import { referenciaDocumentoDespesa, ROTULOS_DOCUMENTO_DESPESA } from "../despesas/apresentacao";
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

/** Mesma identidade/hash usada na lista e na confirmação de vínculo de um PIX. */
export function fonteLancamentoCaixa(l: Pick<LancamentoCaixa, "id" | "descricao" | "cliente" | "categoria" | "centroCusto" | "tipo" | "data" | "mesReferencia" | "valor" | "caixaOrigem">): FonteUnificacao {
  return fonte("MOVIMENTO", "BRISA", l.id, {
    ...(l.caixaOrigem ? { caixaChave: l.caixaOrigem } : {}),
    titulo: l.descricao ?? l.cliente ?? l.categoria ?? "Lançamento", descricao: `${l.centroCusto} · ${l.categoria ?? l.tipo}`, href: `/caixa/${l.id}/editar`, data: l.data, competencia: l.mesReferencia,
    natureza: l.tipo === "SAIDA" ? "SAIDA" : "ENTRADA", valor: l.valor, informativo: l.tipo === "RECEB_DINHEIRO",
    campos: { data: campo("Data", l.data), valor: dinheiro("Valor", l.valor), natureza: campo("Natureza", l.tipo), descricao: campo("Descrição", l.descricao), centro: campo("Centro de custo", l.centroCusto), categoria: campo("Categoria", l.categoria), tratamento: campo("Tratamento", l.tipo === "RECEB_DINHEIRO" ? "Registro paralelo, fora do saldo" : "Compõe o saldo") },
  });
}

/**
 * Fotografia mínima das tabelas originais. Snapshots de importação, anexos e
 * metadados não usados na projeção não precisam atravessar o Prisma em cada
 * navegação. Todos os insumos dos hashes e da proveniência são preservados.
 */
export async function carregarDadosFontesUnificacao(db: BancoUnificacao, dominioFinanceiro?: "RECEBER" | "PAGAR") {
  const completa = !dominioFinanceiro;
  const [locatarios, pessoas, unidades, imoveis, contratos, contratosLegados, recebimentos, titulos, pagamentos, baixas, caixa, movimentos, parametros, importacoesPlanilha, despesas] = await Promise.all([
    completa ? db.locatario.findMany({ select: {
      id: true, nome: true, cpfCnpj: true, pessoaId: true, email: true,
      telefone: true, contato: true, endereco: true, numeroEndereco: true,
      bairro: true, cidade: true, uf: true, cep: true,
    } }) : [],
    db.pessoa.findMany({ where: { origem: "WIDESYS" }, select: {
      id: true, legadoId: true, nome: true, cpfCnpj: true, endereco: true,
      numeroEndereco: true, bairro: true, cidade: true, uf: true, cep: true,
      papeis: { select: { papel: true } },
      emails: { orderBy: { principal: "desc" }, select: { email: true } },
      telefones: { orderBy: { principal: "desc" }, select: { telefone: true } },
    } }),
    completa ? db.unidade.findMany({ select: {
      id: true, identificacao: true, tipo: true, ativo: true,
      empreendimento: { select: { nome: true } },
    } }) : [],
    db.imovelLegado.findMany({ where: { origem: "WIDESYS" }, select: {
      id: true, legadoId: true, nome: true, referencia: true, empreendimentoNome: true,
      endereco: true, numeroEndereco: true, tipo: true, cidade: true, uf: true,
      valorLocacao: true, valorIptu: true, valorCondominio: true,
    } }),
    completa ? db.contrato.findMany({ select: {
      id: true, locatarioId: true, unidadeId: true, valorBase: true, inicio: true,
      fim: true, iptu: true, condominio: true, status: true, observacao: true,
      locatario: { select: { nome: true } },
      unidade: { select: { identificacao: true, empreendimento: { select: { nome: true } } } },
    } }) : [],
    db.contratoLegado.findMany({ where: { origem: "WIDESYS" }, select: {
      id: true, legadoId: true, imovelLegadoId: true, numeroContrato: true,
      statusImportacao: true, quarentenaMotivo: true, valorLocacao: true,
      valorAdministracao: true, inicio: true, fim: true, situacaoOrigem: true,
      partes: { orderBy: { ordem: "asc" }, select: { papel: true, pessoaLegadoId: true, statusImportacao: true } },
    } }),
    completa || dominioFinanceiro === "RECEBER" ? db.recebimento.findMany({ select: {
      id: true, contratoId: true, valor: true, iptu: true, cond: true,
      recebido: true, competencia: true, mesLancamento: true, dataPagamento: true,
      taxaComissaoBps: true, observacao: true, origemAgregada: true, via: true,
      empreendimento: { select: { nome: true } },
      contrato: { select: {
        diaVencimento: true, locatarioId: true, unidadeId: true,
        locatario: { select: { nome: true } }, unidade: { select: { identificacao: true } },
      } },
    } }) : [],
    db.tituloFinanceiroLegado.findMany({ where: {
      origem: "WIDESYS",
      // A derivação histórica classifica qualquer natureza diferente de PAGAR
      // como RECEBER. Preserva inclusive inconsistências para conferência.
      ...(dominioFinanceiro === "PAGAR" ? { natureza: "PAGAR" } : dominioFinanceiro === "RECEBER" ? { natureza: { not: "PAGAR" } } : {}),
    }, select: {
      id: true, legadoId: true, escopo: true, natureza: true, pessoaLegadoId: true,
      contratoLegadoId: true, tipoCobrancaRotulo: true, planoContaRotulo: true,
      statusImportacao: true, quarentenaMotivo: true, competencia: true,
      vencimento: true, pagamento: true, valorDevido: true, valorPago: true,
      valorAberto: true, situacaoNormalizada: true, numeroDocumento: true,
      parcela: true, contaBancariaRotulo: true,
    } }),
    completa ? db.pagamentoRecebimento.findMany({ select: {
      id: true, forma: true, status: true, recebimentoId: true,
      dataPagamento: true, valor: true, identificadorBanco: true,
    } }) : [],
    completa ? db.baixaFinanceiraLegado.findMany({ where: { origem: "WIDESYS" }, select: {
      id: true, legadoId: true, tituloEscopo: true, tituloLegadoId: true,
      escopo: true, forma: true, statusImportacao: true, quarentenaMotivo: true,
      valor: true, dataPagamento: true, estornada: true, contaBancariaRotulo: true,
      movimentoLegadoId: true,
    } }) : [],
    completa ? db.lancamentoCaixa.findMany({ select: {
      id: true, mesReferencia: true, centroCusto: true, tipo: true, categoria: true,
      data: true, valor: true, descricao: true, cliente: true, local: true, caixaOrigem: true,
    } }) : [],
    completa ? db.movimentoFinanceiroLegado.findMany({ where: { origem: "WIDESYS" }, select: {
      id: true, legadoId: true, tituloEscopo: true, tituloLegadoId: true,
      descricao: true, planoContaRotulo: true, contaBancariaRotulo: true,
      statusImportacao: true, quarentenaMotivo: true, dataMovimento: true,
      competencia: true, natureza: true, valor: true, documento: true,
    } }) : [],
    completa ? db.catalogoLegadoRegistro.findMany({ where: { origem: "WIDESYS" }, select: {
      id: true, modulo: true, legadoId: true, titulo: true, label: true,
      status: true, quarentenaMotivo: true,
    } }) : [],
    // A relação reversa LancamentoCaixa.importacoesPlanilha dispara panic no
    // engine Prisma/SQLite desta versão quando há linhas vinculadas. Uma leitura
    // em lote pela FK evita a expansão reversa e mantém a mesma fotografia.
    completa ? db.importacaoPlanilhaLinha.findMany({
      where: { reservado: false, status: { in: ["IMPORTADO", "JA_EXISTENTE"] }, lancamentoCaixaId: { not: null } },
      orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
      select: { lancamentoCaixaId: true, aba: true, linha: true, faixa: true, celulas: true, caixaOrigem: true,
        hashConteudo: true, lote: { select: { arquivo: true, hashArquivo: true } } },
    }) : [],
    // O documento é a obrigação; suas linhas de rateio são só dimensões de
    // custo. Overlays do Widesys nunca viram outro título nesta projeção;
    // somente os restritos são lidos para manter seu sigilo na fonte original.
    completa || dominioFinanceiro === "PAGAR" ? db.despesaDocumento.findMany({ where: { OR: [{ origemChave: null }, { restrita: true }] }, select: {
      id: true, origemChave: true, fornecedorNome: true, fornecedorDocumento: true, numero: true, restrita: true,
      serie: true, tomadorNome: true, tomadorDocumento: true, competencia: true,
      emissao: true, vencimento: true, total: true, lancamentoCaixaId: true,
      pagamentoVia: true,
      categoriaCodigo: true, descricao: true, tipoDocumento: true, destinoCusto: true,
      lancamentoCaixa: { select: { id: true, tipo: true, valor: true, data: true, descricao: true, cliente: true,
        categoria: true, centroCusto: true, mesReferencia: true, caixaOrigem: true } },
    } }) : [],
  ]);
  const caixasDespesaIds = despesas.flatMap(d => d.lancamentoCaixaId ? [d.lancamentoCaixaId] : []);
  const caixasDespesasGovernados = caixasDespesaIds.length ? await db.recursoGovernado.findMany({
    where: { tipo: "CAIXA", origemId: { in: caixasDespesaIds }, status: { not: "ATIVO" } },
    select: { origemId: true, status: true },
  }) : [];
  const caixasDespesasDecisoes = caixasDespesaIds.length ? await db.unificacaoRegistro.findMany({
    where: { chave: { in: caixasDespesaIds.map(id => chaveFonte("BRISA", "MOVIMENTO", id)) } },
    select: { chave: true, status: true, hashFonte: true },
  }) : [];
  const primeiraProveniencia = new Map<string, (typeof importacoesPlanilha)[number]>();
  for (const item of importacoesPlanilha) {
    if (item.lancamentoCaixaId && !primeiraProveniencia.has(item.lancamentoCaixaId)) primeiraProveniencia.set(item.lancamentoCaixaId, item);
  }
  const caixaComProveniencia = caixa.map(lancamento => {
    const item = primeiraProveniencia.get(lancamento.id);
    return { ...lancamento, importacoesPlanilha: item ? [item] : [] };
  });
  return { locatarios, pessoas, unidades, imoveis, contratos, contratosLegados, recebimentos, titulos, pagamentos, baixas, caixa: caixaComProveniencia, movimentos, parametros, despesas, caixasDespesasGovernados, caixasDespesasDecisoes };
}

export type DadosFontesUnificacao = Awaited<ReturnType<typeof carregarDadosFontesUnificacao>>;

/** Deriva hashes e proveniência da fotografia, sem novas consultas ao banco. */
export async function derivarFontesUnificacao(dados: DadosFontesUnificacao): Promise<FonteUnificacao[]> {
  const { locatarios, pessoas, unidades, imoveis, contratos, contratosLegados, recebimentos, titulos, pagamentos, baixas, caixa, movimentos, parametros, despesas, caixasDespesasGovernados, caixasDespesasDecisoes } = dados;
  const pLegado = new Map(pessoas.map(p => [p.legadoId, p]));
  const iLegado = new Map(imoveis.map(i => [i.legadoId, i]));
  const cLegado = new Map(contratosLegados.map(c => [c.legadoId, c]));
  const tLegado = new Map(titulos.map(t => [`${t.escopo}:${t.legadoId}`, t]));
  const overlaysRestritos = new Set(despesas.filter(d => d.restrita && d.origemChave).map(d => d.origemChave!));
  const titulosRestritos = new Set(titulos.filter(t => t.natureza === "PAGAR" && (overlaysRestritos.has(chaveFonte("WIDESYS", "PAGAR", t.id))
    || /comiss|corretagem|honor[aá]rio|taxa\s+de\s+administra/i.test(`${t.planoContaRotulo ?? ""} ${t.tipoCobrancaRotulo ?? ""}`))).map(t => t.id));
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
  const caixasDespesaInativos = new Set(caixasDespesasGovernados.map(c => c.origemId));
  const decisoesCaixa = new Map(caixasDespesasDecisoes.map(d => [d.chave, d]));
  for (const d of despesas) {
    if (d.origemChave) continue;
    const pagamento = d.lancamentoCaixa;
    const decisaoCaixa = pagamento ? decisoesCaixa.get(chaveFonte("BRISA", "MOVIMENTO", pagamento.id)) : null;
    const caixaEmRevisao = decisaoCaixa && (decisaoCaixa.status !== "ATIVO" || (pagamento && decisaoCaixa.hashFonte !== fonteLancamentoCaixa(pagamento).hash));
    const pagamentoInconsistente = Boolean(d.lancamentoCaixaId && (!pagamento || caixasDespesaInativos.has(d.lancamentoCaixaId) || caixaEmRevisao || pagamento.tipo !== "SAIDA" || pagamento.valor !== d.total));
    const pago = !pagamentoInconsistente && pagamento ? pagamento.valor : 0;
    // Campos adicionados não mudam os hashes de notas antigas por simples
    // atualização do schema. Só uma classificação explícita altera a projeção.
    const classificada = Boolean(d.categoriaCodigo || d.descricao || d.destinoCusto === "ADMINISTRADORA" || (d.tipoDocumento && d.tipoDocumento !== "NOTA_FISCAL"));
    const categoria = categoriaDespesa(d.categoriaCodigo);
    const documento = referenciaDocumentoDespesa(d);
    fontes.push(fonte("PAGAR", "BRISA", d.id, {
      titulo: d.fornecedorNome, descricao: classificada
        ? [categoria?.rotulo, d.descricao, d.destinoCusto === "ADMINISTRADORA" ? "Administradora" : "Empreendimentos", d.numero ? documento : null].filter(Boolean).join(" · ")
        : `NF ${d.numero}${d.serie ? ` · série ${d.serie}` : ""}`, href: null,
      proveniencia: { tipo: "CADASTRO_MANUAL" },
      restrito: d.restrita,
      qualidade: pagamentoInconsistente ? "QUARENTENA" : "OK",
      motivos: pagamentoInconsistente ? ["PAGAMENTO_DESPESA_CONFERIR"] : [],
      competencia: d.competencia, data: pagamento?.data ?? null, vencimento: d.vencimento,
      valor: d.total, pago, aberto: Math.max(d.total - pago, 0),
      campos: {
        pessoa: campo("Fornecedor", d.fornecedorNome), documentoFornecedor: campo("CPF/CNPJ do fornecedor", d.fornecedorDocumento, "documento"),
        documento: campo("Documento", d.numero), serie: campo("Série", d.serie),
        tomador: campo("Tomador original da nota", d.tomadorNome), documentoTomador: campo("CPF/CNPJ do tomador", d.tomadorDocumento, "documento"),
        emissao: campo("Emissão", d.emissao), competencia: campo("Competência", d.competencia), vencimento: campo("Vencimento", d.vencimento),
        valor: dinheiro("Devido", d.total), pago: dinheiro("Pago", pago), aberto: dinheiro("Saldo", Math.max(d.total - pago, 0)),
        pagamento: campo("Pagamento", pagamentoInconsistente ? "Vínculo de caixa alterado ou excluído: conferir. Não gera nova cobrança." : pagamento ? `Saída única vinculada${d.pagamentoVia ? ` · ${d.pagamentoVia}` : ""}` : "Sem saída vinculada"),
        tratamento: campo("Tratamento", classificada ? "Uma despesa e um pagamento. A divisão do custo não gera novas contas a pagar nem saídas de caixa." : "Uma nota e uma obrigação. O rateio apenas distribui custos; o pagamento permanece uma única saída no caixa."),
        ...(classificada ? {
          categoria: campo("Categoria da despesa", categoria?.rotulo), descricaoDespesa: campo("Descrição da despesa", d.descricao),
          tipoDocumento: campo("Tipo de documento", ROTULOS_DOCUMENTO_DESPESA[d.tipoDocumento] ?? "Documento"),
          responsavelCusto: campo("Responsável pelo custo", d.destinoCusto === "ADMINISTRADORA" ? "Administradora" : "Empreendimentos"),
        } : {}),
      },
    }));
  }
  for (const t of titulos) {
    const p = pessoaTitulo(t); const c = cLegado.get(t.contratoLegadoId ?? ""); const i = c?.imovelLegadoId ? iLegado.get(c.imovelLegadoId) : null;
    fontes.push(fonte(t.natureza === "PAGAR" ? "PAGAR" : "RECEBER", "WIDESYS", t.id, {
      ...(titulosRestritos.has(t.id) ? { restrito: true } : {}),
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
      ...(t && titulosRestritos.has(t.id) ? { restrito: true } : {}),
      titulo: p?.nome ?? `${dominio === "BAIXA_PAGAR" ? "Pagamento" : "Recebimento"} ${b.legadoId}`, descricao: b.forma ?? "Forma não informada", href: null, qualidade: qualidade(b.statusImportacao), motivos: motivos(b.quarentenaMotivo),
      tituloChave: t ? chaveFonte("WIDESYS", t.natureza === "PAGAR" ? "PAGAR" : "RECEBER", t.id) : null, valor: b.valor, data: b.dataPagamento, cancelado: b.estornada, informativo: true,
      campos: { data: campo("Data", b.dataPagamento), valor: dinheiro("Valor", b.valor), forma: campo("Forma", b.forma), conta: campo("Conta", b.contaBancariaRotulo), movimento: campo("Movimento na origem", b.movimentoLegadoId), situacao: campo("Situação", b.estornada ? "Estornado" : "Confirmado"), tratamento: campo("Tratamento", "Detalhe de liquidação já considerado no valor pago do título; não soma uma segunda vez") },
    }));
  }
  const caixasComNotaRestrita = new Set(despesas.filter(d => d.restrita && d.lancamentoCaixaId).map(d => d.lancamentoCaixaId!));
  for (const l of caixa) {
    const f = fonteLancamentoCaixa(l);
    // A classificação de sigilo não muda o fato financeiro/assinatura do PIX,
    // mas impede que a lista global revele o total da nota por outro módulo.
    if (caixasComNotaRestrita.has(l.id)) f.restrito = true;
    fontes.push(f);
  }
  for (const m of movimentos) {
    const t = m.tituloEscopo && m.tituloLegadoId ? tLegado.get(`${m.tituloEscopo}:${m.tituloLegadoId}`) : null;
    fontes.push(fonte("MOVIMENTO", "WIDESYS", m.id, {
      ...(t && titulosRestritos.has(t.id) ? { restrito: true } : {}),
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
  if ((recebimentos.length || caixa.length) && existsSync(datasetPath)) {
    const { reconstruirProvenienciaPlanilhas } = await import("./proveniencia-planilhas");
    const prova = reconstruirProvenienciaPlanilhas(JSON.parse(readFileSync(datasetPath, "utf8")), {
      recebimentos: recebimentos.map(r => ({ ...r, empreendimentoNome: r.empreendimento.nome, unidadeIdentificacao: r.contrato.unidade.identificacao, locatarioNome: r.contrato.locatario?.nome ?? null })),
      lancamentosCaixa: caixa,
    });
    for (const f of fontes) {
      if (f.origem !== "BRISA") continue;
      const p = f.dominio === "RECEBER" ? prova.recebimentos.get(f.origemId) : f.dominio === "MOVIMENTO" ? prova.lancamentosCaixa.get(f.origemId) : null;
      if (p) {
        f.proveniencia = { ...p };
        if (f.dominio === "MOVIMENTO") f.caixaChave = "CONTA_ACAMARGO";
      }
    }
  }
  const porCaixa = new Map(caixa.map(c => [c.id, c]));
  for (const f of fontes) {
    if (f.origem !== "BRISA" || f.dominio !== "MOVIMENTO") continue;
    const original = porCaixa.get(f.origemId);
    if (original?.caixaOrigem) {
      f.caixaChave = original.caixaOrigem;
      f.campos = { ...f.campos, caixa: campo("Caixa de origem", original.caixaOrigem) };
    }
    const i = original?.importacoesPlanilha?.[0];
    if (i) f.proveniencia = { ...f.proveniencia, arquivo: i.lote.arquivo, hashArquivo: i.lote.hashArquivo, aba: i.aba, linha: i.linha, faixa: i.faixa, celulas: i.celulas, caixaOrigem: i.caixaOrigem, hash: i.hashConteudo };
  }
  return fontes;
}

/** Mutações continuam lendo e verificando as fontes dentro da própria transação. */
export async function carregarFontesUnificacao(db: BancoUnificacao): Promise<FonteUnificacao[]> {
  return derivarFontesUnificacao(await carregarDadosFontesUnificacao(db));
}

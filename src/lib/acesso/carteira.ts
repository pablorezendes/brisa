import "server-only";
import type { PrismaClient, Prisma } from "@prisma/client";
import { pode, type PoliticaAcesso, type TipoEscopo } from "./politica";
import { lerOperacaoUnificada } from "../unificacao/servico";

const ids = (p: PoliticaAcesso, tipo: TipoEscopo, efeito: string) => p.regras.filter(r => r.tipo === tipo && r.efeito === efeito).map(r => r.recursoId);
export function filtroUnidades(p: PoliticaAcesso): Prisma.UnidadeWhereInput {
  return { AND: [
    p.global ? {} : { OR: [{ id: { in: ids(p, "UNIDADE", "PERMITIR") } }, { empreendimentoId: { in: ids(p, "EMPREENDIMENTO", "PERMITIR") } }] },
    { id: { notIn: ids(p, "UNIDADE", "BLOQUEAR") }, empreendimentoId: { notIn: ids(p, "EMPREENDIMENTO", "BLOQUEAR") } },
  ] };
}
const referencia = (origem: string, id: string) => `${origem}:${id}`;
export type ItemCarteira = { id: string; origem: string; nome: string; grupo: string; documento?: string | null; contato?: string | null };
export type ContratoCarteira = { id: string; origem: string; imovel: string; cliente: string; situacao: string; inicio: string | null; fim: string | null };
export type TituloCarteira = { id: string; origem: string; natureza: string; imovel: string; cliente: string; competencia: string; vencimento: string | null; devido: number; pago: number; aberto: number };
export type Carteira = { imoveis: ItemCarteira[]; empreendimentos: ItemCarteira[]; clientes: ItemCarteira[]; contratos: ContratoCarteira[]; titulos: TituloCarteira[] };
const vazia = (): Carteira => ({ imoveis: [], empreendimentos: [], clientes: [], contratos: [], titulos: [] });

/** DAL de leitura. Autoriza pelas FKs e identidades externas, nunca por nome.
 * Retorna somente DTOs explícitos; snapshots, comissões e candidatos não saem daqui.
 * Quem conhece um cliente não ganha, por isso, acesso a toda a carteira dele.
 */
export async function consultarCarteira(db: PrismaClient, p: PoliticaAcesso, mes: string): Promise<Carteira> {
  if (!pode(p, "carteira.ver")) return vazia();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error("Competência inválida.");
  const estados = await db.recursoGovernado.findMany({ where: { status: { not: "ATIVO" } }, select: { tipo: true, origemId: true } });
  const inativos = (tipo: string) => estados.filter(e => e.tipo === tipo).map(e => e.origemId);
  const locatariosNegados = [...new Set([...ids(p, "LOCATARIO", "BLOQUEAR"), ...inativos("LOCATARIO")])];
  const vinculosNegados = await db.locatario.findMany({ where: { id: { in: locatariosNegados } }, select: { pessoaId: true } });
  const negados = (tipo: TipoEscopo) => [...new Set([...ids(p, tipo, "BLOQUEAR"), ...inativos(tipo), ...(tipo === "PESSOA" ? vinculosNegados.flatMap(l => l.pessoaId ? [l.pessoaId] : []) : [])])];
  const unidades = await db.unidade.findMany({ where: { AND: [filtroUnidades(p), { id: { notIn: inativos("UNIDADE") }, empreendimentoId: { notIn: inativos("EMPREENDIMENTO") } }] }, select: {
    id: true, identificacao: true, empreendimentoId: true, empreendimento: { select: { nome: true } },
  }, orderBy: [{ empreendimentoId: "asc" }, { identificacao: "asc" }] });
  const empreendimentos = await db.empreendimento.findMany({ where: { AND: [p.global ? {} : { id: { in: [...ids(p, "EMPREENDIMENTO", "PERMITIR"), ...unidades.map(u => u.empreendimentoId)] } }, { id: { notIn: negados("EMPREENDIMENTO") } }] }, select: { id: true, nome: true }, orderBy: { nome: "asc" } });
  const pessoasBloqueadas = await db.pessoa.findMany({ where: { id: { in: negados("PESSOA") } }, select: { origem: true, legadoId: true } });
  const bloqueioPessoaExterna = new Set(pessoasBloqueadas.map(x => referencia(x.origem, x.legadoId)));
  const contratos = await db.contrato.findMany({ where: { id: { notIn: inativos("CONTRATO") }, unidadeId: { in: unidades.map(u => u.id) }, OR: [
    { locatarioId: null }, { locatario: { is: { id: { notIn: negados("LOCATARIO") }, OR: [{ pessoaId: null }, { pessoaId: { notIn: negados("PESSOA") } }] } } },
  ] }, select: { id: true, unidadeId: true, locatarioId: true, status: true, inicio: true, fim: true } });
  const locatarios = await db.locatario.findMany({ where: { AND: [
    p.global ? {} : { OR: [{ id: { in: contratos.flatMap(c => c.locatarioId ? [c.locatarioId] : []) } }, { id: { in: ids(p, "LOCATARIO", "PERMITIR") } }, { pessoaId: { in: ids(p, "PESSOA", "PERMITIR") } }] },
    { id: { notIn: negados("LOCATARIO") }, OR: [{ pessoaId: null }, { pessoaId: { notIn: negados("PESSOA") } }] },
  ] }, select: { id: true, nome: true, pessoaId: true, ...(pode(p, "cadastros.ver") && pode(p, "cadastros.sensiveis") ? { cpfCnpj: true, email: true, telefone: true } : {}) } });
  const imoveisLegados = await db.imovelLegado.findMany({ where: { AND: [p.global ? {} : { id: { in: ids(p, "IMOVEL_LEGADO", "PERMITIR") } }, { id: { notIn: negados("IMOVEL_LEGADO") } }] }, select: {
    id: true, origem: true, legadoId: true, nome: true, referencia: true,
  } });
  // Contratos importados só entram mediante identidade externa exata do imóvel.
  const contratosLegados = (await db.contratoLegado.findMany({ where: { id: { notIn: inativos("CONTRATO_LEGADO") }, OR: imoveisLegados.map(i => ({ origem: i.origem, imovelLegadoId: i.legadoId })), statusImportacao: { notIn: ["QUARENTENA", "AUSENTE_NA_FONTE"] } }, select: {
    id: true, origem: true, legadoId: true, imovelLegadoId: true, situacaoOrigem: true, inicio: true, fim: true,
    partes: { select: { origem: true, pessoaLegadoId: true, papel: true, statusImportacao: true } },
  } })).filter(c => !c.partes.some(x => ["QUARENTENA", "AUSENTE_NA_FONTE"].includes(x.statusImportacao) || x.origem !== c.origem || (x.pessoaLegadoId && bloqueioPessoaExterna.has(referencia(x.origem, x.pessoaLegadoId)))));
  const pessoas = await db.pessoa.findMany({ where: { AND: [
    p.global ? {} : { OR: [{ id: { in: [...ids(p, "PESSOA", "PERMITIR"), ...locatarios.flatMap(l => l.pessoaId ? [l.pessoaId] : [])] } }, ...contratosLegados.flatMap(c => c.partes.filter(x => x.pessoaLegadoId && x.papel === "INQUILINO").map(x => ({ origem: x.origem, legadoId: x.pessoaLegadoId! }))) ] },
    { id: { notIn: negados("PESSOA") } },
  ] }, select: { id: true, nome: true, origem: true, legadoId: true, ...(pode(p, "cadastros.ver") && pode(p, "cadastros.sensiveis") ? { cpfCnpj: true, emails: { select: { email: true }, take: 1 } } : {}) } });
  const porUnidade = new Map(unidades.map(u => [u.id, u]));
  const porLocatario = new Map(locatarios.map(l => [l.id, l]));
  const porPessoa = new Map(pessoas.map(x => [referencia(x.origem, x.legadoId), x]));
  const porImovel = new Map(imoveisLegados.map(i => [referencia(i.origem, i.legadoId), i]));
  const contratosAutorizados = new Map<string, { contrato: string; imovel: string }>([
    ...contratos.map(c => [`BRISA:${c.id}`, { contrato: `BRISA:CONTRATO:${c.id}`, imovel: `BRISA:IMOVEL:${c.unidadeId}` }] as const),
    ...contratosLegados.map(c => [`WIDESYS:${c.id}`, { contrato: `WIDESYS:CONTRATO:${c.id}`, imovel: `WIDESYS:IMOVEL:${porImovel.get(referencia(c.origem, c.imovelLegadoId!))!.id}` }] as const),
  ]);
  const nomeCliente = (nome: string | undefined) => pode(p, "cadastros.ver") ? nome ?? "Não informado" : "Cliente restrito";
  const contratosDTO: ContratoCarteira[] = contratos.map(c => ({ id: `BRISA:${c.id}`, origem: "Brisa", imovel: porUnidade.get(c.unidadeId)!.identificacao, cliente: nomeCliente(porLocatario.get(c.locatarioId ?? "")?.nome), situacao: c.status, inicio: c.inicio, fim: c.fim }));
  contratosDTO.push(...contratosLegados.map(c => {
    const i = porImovel.get(referencia(c.origem, c.imovelLegadoId!))!;
    const inquilino = c.partes.find(x => x.papel === "INQUILINO");
    return { id: `WIDESYS:${c.id}`, origem: "Widesys", imovel: i.nome ?? i.referencia ?? "Imóvel legado", cliente: nomeCliente(inquilino?.pessoaLegadoId ? porPessoa.get(referencia(inquilino.origem, inquilino.pessoaLegadoId))?.nome : undefined), situacao: c.situacaoOrigem ?? "Não informada", inicio: c.inicio, fim: c.fim };
  }));
  const titulos: TituloCarteira[] = [];
  if (pode(p, "financeiro.ver") && (contratos.length || contratosLegados.length)) {
    const nativos = await db.recebimento.findMany({ where: { contratoId: { in: contratos.map(c => c.id) }, competencia: mes, origemAgregada: false }, select: { id: true, contratoId: true } });
    const legados = (await db.tituloFinanceiroLegado.findMany({ where: { OR: contratosLegados.map(c => ({ origem: c.origem, contratoLegadoId: c.legadoId })), AND: [{ OR: [{ competencia: { startsWith: mes } }, { competencia: null, vencimento: { startsWith: mes } }] }] }, select: {
      id: true, origem: true, contratoLegadoId: true, pessoaLegadoId: true, natureza: true, planoContaRotulo: true, tipoCobrancaRotulo: true,
    } })).filter(t => !t.pessoaLegadoId || !bloqueioPessoaExterna.has(referencia(t.origem, t.pessoaLegadoId)));
    const permitidos = new Map(nativos.map(t => [`BRISA:RECEBER:${t.id}`, `BRISA:${t.contratoId}`]));
    for (const t of legados) {
      // Não revelar receitas de comissão na carteira compartilhável.
      const classificacao = `${t.planoContaRotulo ?? ""} ${t.tipoCobrancaRotulo ?? ""}`.trim();
      if (!classificacao || /comiss|administra|corretagem|honor[aá]rio/i.test(classificacao)) continue;
      const c = contratosLegados.find(c => c.origem === t.origem && c.legadoId === t.contratoLegadoId);
      if (c) permitidos.set(`WIDESYS:${t.natureza}:${t.id}`, `WIDESYS:${c.id}`);
    }
    if (permitidos.size) {
      const operacao = await lerOperacaoUnificada(db);
      const metaContratos = new Map(contratosDTO.map(c => [c.id, c]));
      const fontesAtuais = new Map(operacao.fontes.map(f => [f.chave, f]));
      const fonteAutorizada = (chave: string) => {
        const vinculo = permitidos.get(chave);
        const esperado = vinculo ? contratosAutorizados.get(vinculo) : null;
        const fonte = fontesAtuais.get(chave);
        return !!esperado && !!fonte && fonte.contratoChave === esperado.contrato && fonte.imovelChave === esperado.imovel;
      };
      for (const t of operacao.linhas) {
        const contratoId = permitidos.get(t.chave);
        // Nunca anexar fontes/candidatos de uma outra carteira a um DTO permitido.
        const vinculo = contratoId ? contratosAutorizados.get(contratoId) : null;
        if (!contratoId || !vinculo || !t.contabiliza || t.cancelado || t.competencia !== mes || !t.fontes.length || !fonteAutorizada(t.chave) || !t.fontes.every(fonteAutorizada) || t.contratoChave !== vinculo.contrato || t.imovelChave !== vinculo.imovel) continue;
        const c = metaContratos.get(contratoId)!;
        titulos.push({ id: t.chave, origem: t.origem, natureza: t.dominio, imovel: c.imovel, cliente: c.cliente, competencia: mes, vencimento: t.vencimento ?? null, devido: t.valor ?? 0, pago: t.pago ?? 0, aberto: t.aberto ?? 0 });
      }
    }
  }
  const vinculadas = new Set(locatarios.flatMap(l => l.pessoaId ? [l.pessoaId] : []));
  return {
    imoveis: pode(p, "cadastros.ver") ? [...unidades.map(u => ({ id: `BRISA:${u.id}`, origem: "Brisa", nome: u.identificacao, grupo: u.empreendimento.nome })), ...imoveisLegados.map(i => ({ id: `WIDESYS:${i.id}`, origem: "Widesys", nome: i.nome ?? i.referencia ?? "Imóvel legado", grupo: "Cadastro importado" }))] : [],
    empreendimentos: pode(p, "cadastros.ver") ? empreendimentos.map(e => ({ id: e.id, origem: "Brisa", nome: e.nome, grupo: "Empreendimento" })) : [],
    clientes: pode(p, "cadastros.ver") ? [...locatarios.map(l => ({ id: `BRISA:${l.id}`, origem: "Brisa", nome: l.nome, grupo: "Inquilino", ...(pode(p, "cadastros.sensiveis") ? { documento: l.cpfCnpj, contato: l.email ?? l.telefone } : {}) })), ...pessoas.filter(x => !vinculadas.has(x.id)).map(x => ({ id: `WIDESYS:${x.id}`, origem: "Widesys", nome: x.nome, grupo: "Pessoa ou empresa", ...(pode(p, "cadastros.sensiveis") ? { documento: x.cpfCnpj, contato: x.emails?.[0]?.email } : {}) }))] : [],
    contratos: pode(p, "contratos.ver") ? contratosDTO : [], titulos,
  };
}

/** Exportação sem fórmulas executáveis em Excel/LibreOffice. */
export function csvCarteira(titulos: TituloCarteira[]) {
  const celula = (v: unknown) => {
    const texto = String(v ?? "");
    const seguro = /^[\s\u0000-\u001f]*[=+@-]/.test(texto) || /^[\t\r\n]/.test(texto) ? "'" + texto : texto;
    return '"' + seguro.replaceAll('"', '""') + '"';
  };
  const linhas: unknown[][] = [["Origem", "Natureza", "Imóvel", "Cliente", "Competência", "Vencimento", "Devido (R$)", "Pago (R$)", "Aberto (R$)"], ...titulos.map(t => [t.origem, t.natureza, t.imovel, t.cliente, t.competencia, t.vencimento, (t.devido / 100).toFixed(2), (t.pago / 100).toFixed(2), (t.aberto / 100).toFixed(2)])];
  return "\uFEFF" + linhas.map(l => l.map(celula).join(";")).join("\r\n");
}

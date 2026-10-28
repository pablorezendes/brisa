import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinhaUnificada, ListaUnificada } from "@/lib/unificacao/tipos";

const mocks = vi.hoisted(() => ({ perfil: vi.fn(), acesso: vi.fn(), listar: vi.fn(), detalhe: vi.fn(), pagina: vi.fn(), permissao: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/autorizacao", () => ({ perfilAtual: mocks.perfil }));
vi.mock("@/lib/acesso/servidor", () => ({ acessoAtual: mocks.acesso, exigirPaginaAcesso: mocks.pagina, exigirPermissaoAcesso: mocks.permissao }));
vi.mock("@/lib/consultas/unificacao", () => ({ listarUnificados: mocks.listar, listarTitulosFinanceiros: mocks.listar, detalheUnificado: mocks.detalhe }));
vi.mock("@/app/(app)/unificacao/actions", () => ({ sincronizarUnificacao: vi.fn(), sincronizarUnificacaoNaTela: vi.fn(), resolverUnificacao: vi.fn() }));
vi.mock("@/app/(app)/unificacao/conferencia-lote-actions", () => ({ prepararConferenciaSelecionados: vi.fn(), conferirTitulosSelecionados: vi.fn() }));
vi.mock("@/components/acao-autorizada", () => ({ AcaoAutorizada: () => null, podeExibirAcao: () => false }));
vi.mock("@/components/link-governanca", () => ({ LinkGovernanca: () => null }));
vi.mock("@/components/excluir-registro-link", () => ({ ExcluirRegistroLink: () => null, ExcluirUnificadoLink: ({ registro }: { registro: Pick<LinhaUnificada, "chave"> }) => <span data-revisao-exclusao={registro.chave}>Excluir da plataforma</span> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("ACESSO_NEGADO"); } }));

import { EstadoUnificado, OperacaoUnificada, OrigensUnificadas } from "./operacao-unificada";
import { explicarConsolidacao } from "./situacao-consolidacao";
import PaginaDetalhe from "@/app/(app)/unificacao/[chave]/page";

function registro(extras: Partial<LinhaUnificada> = {}): LinhaUnificada {
  return { chave: "BRISA:RECEBER:r1", dominio: "RECEBER", origem: "BRISA", origemId: "r1", titulo: "Registro de teste", descricao: "Contrato de teste", href: null, hash: "hash", qualidade: "OK", motivos: [], campos: {}, nomeNorm: "REGISTRO", estado: "ATIVO", origens: ["BRISA"], fontes: ["BRISA:RECEBER:r1"], versao: 1, candidatos: [], avisos: [], contabiliza: true, divergencias: [], ...extras };
}
function lista(): ListaUnificada {
  return { itens: [registro()], total: 26, pagina: 1, paginas: 2, porPagina: 25, sincronizado: true,
    resumo: { ativos: 1, pendentes: 1, vinculados: 0, quarentena: 0, devido: 100, pago: 0, aberto: 100, devidoPendente: 100, pagoPendente: 0, abertoPendente: 100, entradas: 0, saidas: 0, vencidos: 0, valorVencido: 0 } };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.perfil.mockResolvedValue("ADMINISTRADOR");
  mocks.acesso.mockResolvedValue({ usuarioId: "teste", perfil: "ADMINISTRADOR", ativo: true, global: true, regras: [], permissoes: ["cadastros.sensiveis", "governanca.editar"] });
  mocks.listar.mockResolvedValue(lista());
});

describe("origem e situação são informações diferentes", () => {
  it("distingue origem Widesys conferida de conciliação pendente entre fontes", () => {
    const ativo = registro({ conferidoNaOrigem: true, conferidoPorRegra: true });
    expect(renderToStaticMarkup(<EstadoUnificado item={ativo} />)).toContain(">Conferido<");
    expect(explicarConsolidacao(ativo)).toContain("Incluído uma única vez");
    const cruzamento = registro({ conferidoNaOrigem: true, estado: "PENDENTE", contabiliza: false });
    expect(renderToStaticMarkup(<EstadoUnificado item={cruzamento} />)).toContain("Conferido no Widesys · conciliar fontes");
    expect(explicarConsolidacao(cruzamento)).toContain("Ainda fora dos totais");
  });
  it("não chama um registro Brisa de manual nem de planilha sem evidência", () => {
    const html = renderToStaticMarkup(<OrigensUnificadas origens={["BRISA"]} />);
    expect(html).toContain("Brisa · origem a confirmar");
    expect(html).not.toContain("Manual");
    expect(html).not.toContain("Excel");
  });
  it("mantém as duas origens de um grupo sem duplicar os selos", () => {
    const html = renderToStaticMarkup(<OrigensUnificadas origens={["PLANILHA", "WIDESYS", "PLANILHA"]} />);
    expect(html.match(/Planilhas Excel/g)).toHaveLength(1);
    expect(html).toContain("Widesys");
  });
  it("identifica nota cadastrada manualmente sem chamá-la de planilha ou origem desconhecida", () => {
    const html = renderToStaticMarkup(<OrigensUnificadas origens={["MANUAL"]} />);
    expect(html).toContain("Cadastro manual Brisa");
    expect(html).not.toContain("origem a confirmar");
    expect(html).not.toContain("Excel");
  });
  it("ATIVO financeiro não declara auditoria concluída e cadastro não declara efeito financeiro", () => {
    expect(renderToStaticMarkup(<EstadoUnificado item={registro()} />)).toContain("Incluído automaticamente");
    expect(renderToStaticMarkup(<EstadoUnificado item={registro({ dominio: "PESSOA" })} />)).toContain("Disponível");
    expect(explicarConsolidacao(registro())).toContain("Ainda não foi conferido manualmente");
    expect(explicarConsolidacao(registro({ cancelado: true, contabiliza: false }))).toContain("Não entra nos totais");
    expect(explicarConsolidacao(registro({ estado: "VINCULADO", contabiliza: false }))).toContain("Não soma novamente");
    expect(explicarConsolidacao(registro({ estado: "PENDENTE", contabiliza: false }))).toContain("Fora dos totais");
  });
  it("envia filtro de origem ao DAL e o preserva na paginação e atalhos", async () => {
    const html = renderToStaticMarkup(await OperacaoUnificada({ titulo: "Conferir", base: "/unificacao", central: true, parametros: { dominio: "RECEBER", origem: "PLANILHA", q: "teste", mes: "2026-06", vencidos: "1" } }));
    expect(mocks.listar).toHaveBeenCalledWith(expect.objectContaining({ origem: "PLANILHA", dominio: "RECEBER", q: "teste", mes: "2026-06", vencidos: true }));
    expect(html).toContain('name="origem"');
    expect(html).toContain("De onde veio");
    expect(html).toContain("Situação na consolidação");
    const proxima = html.match(/<a\b[^>]*href="([^"]+)"[^>]*>Próxima<\/a>/)?.[1];
    expect(proxima).toContain("origem=PLANILHA");
    expect(proxima).toContain("mes=2026-06");
    expect(proxima).toContain("pagina=2");
    expect(html).toContain("estado=PENDENTE&amp;origem=PLANILHA");
    expect(html).toContain('href="/cadastros/governanca?tipo=TITULO&amp;origemId=BRISA%3ARECEBER%3Ar1&amp;modo=excluir"');
    expect(html).not.toContain("consolidação concluída");
  });
  it("não consulta a lista quando o perfil não pode acessar dados globais", async () => {
    mocks.perfil.mockResolvedValue("CONTABILIDADE");
    await expect(OperacaoUnificada({ titulo: "Teste", base: "/unificacao" })).rejects.toThrow("ACESSO_NEGADO");
    expect(mocks.listar).not.toHaveBeenCalled();
  });
  it("habilita conferência de recebimentos na janela somente para acesso integral e preserva os detalhes", async () => {
    mocks.acesso.mockResolvedValue({ usuarioId: "teste", perfil: "FINANCEIRO", ativo: true, global: true, regras: [], permissoes: ["financeiro.ver", "unificacao.ver", "cadastros.sensiveis"] });
    const html = renderToStaticMarkup(await OperacaoUnificada({ titulo: "A receber", base: "/recebimentos", dominio: "RECEBER" }));
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>Conferir<\/button>/);
    expect(html).toContain("Ver detalhes");
    expect(html).toContain("Incluído automaticamente");
    const dados = lista(); dados.itens[0] = registro({ conferidoManualmente: true }); mocks.listar.mockResolvedValue(dados);
    const conferido = renderToStaticMarkup(await OperacaoUnificada({ titulo: "A receber", base: "/recebimentos", dominio: "RECEBER" }));
    expect(conferido).toMatch(/<button[^>]*>Conferido<\/button>/);
    expect(conferido).toContain("Conferido e incluído nos totais");
    mocks.acesso.mockResolvedValue({ usuarioId: "teste", perfil: "FINANCEIRO", ativo: true, global: true, regras: [], permissoes: ["financeiro.ver", "cadastros.sensiveis"] });
    const restrito = renderToStaticMarkup(await OperacaoUnificada({ titulo: "A receber", base: "/recebimentos", dominio: "RECEBER" }));
    expect(restrito).not.toMatch(/<button[^>]*>Conferido<\/button>/);
  });
  it("quarentena conserva a revisão da origem sem oferecer conclusão direta no popup", async () => {
    mocks.acesso.mockResolvedValue({ usuarioId: "teste", perfil: "FINANCEIRO", ativo: true, global: true, regras: [], permissoes: ["financeiro.ver", "unificacao.ver", "cadastros.sensiveis"] });
    const dados = lista(); dados.itens[0] = registro({ estado: "QUARENTENA", contabiliza: false }); mocks.listar.mockResolvedValue(dados);
    const html = renderToStaticMarkup(await OperacaoUnificada({ titulo: "A receber", base: "/recebimentos", dominio: "RECEBER" }));
    expect(html).toContain("Revisar e resolver");
    expect(html).not.toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>Conferir<\/button>/);
  });
  it.each(["PAGAR", "RECEBER"] as const)("habilita lote em %s ao financeiro autorizado sem permissão de excluir", async dominio => {
    const permissoes = ["unificacao.editar", "pagamentos.conciliar", "cadastros.sensiveis", ...(dominio === "PAGAR" ? ["despesas.ver"] : ["financeiro.ver", "unificacao.ver"])];
    mocks.acesso.mockResolvedValue({ usuarioId: "teste", perfil: "FINANCEIRO", ativo: true, global: true, regras: [], permissoes });
    const dados = lista(); dados.itens[0] = registro({ dominio, chave: `WIDESYS:${dominio}:1` }); mocks.listar.mockResolvedValue(dados);
    const base = dominio === "PAGAR" ? "/financeiro/contas-a-pagar" : "/recebimentos";
    const html = renderToStaticMarkup(await OperacaoUnificada({ titulo: "Financeiro", base, dominio }));
    expect(html).toContain("Marcar selecionados como conferidos");
    expect(html).toContain("Selecionar todos os registros desta página");
    expect(html).not.toContain("Excluir selecionados");
    mocks.acesso.mockResolvedValue({ usuarioId: "teste", perfil: "FINANCEIRO", ativo: true, global: true, regras: [], permissoes: permissoes.filter(p => p !== "pagamentos.conciliar") });
    const consulta = renderToStaticMarkup(await OperacaoUnificada({ titulo: "Financeiro", base, dominio }));
    expect(consulta).not.toContain("Marcar selecionados como conferidos");
    expect(consulta).not.toContain("Selecionar todos os registros desta página");
    mocks.acesso.mockResolvedValue({ usuarioId: "teste", perfil: "FINANCEIRO", ativo: true, global: false, regras: [], permissoes });
    await expect(OperacaoUnificada({ titulo: "Financeiro", base, dominio })).rejects.toThrow("ACESSO_NEGADO");
  });
  it("detalhe mostra evidência da fonte associada sem expor campos de comissão", async () => {
    const principal = registro({ origens: ["BRISA", "PLANILHA"], campos: { pessoa: { rotulo: "Pessoa", valor: "Pessoa permitida" }, taxa: { rotulo: "Taxa reservada", valor: "SEGREDO_TAXA" }, administracao: { rotulo: "Administração", valor: "SEGREDO_ADMINISTRACAO" } } });
    const planilha = registro({ chave: "BRISA:RECEBER:planilha", proveniencia: { arquivo: "fixture.xlsx", aba: "Plan1", linha: 12 } });
    mocks.detalhe.mockResolvedValue({ registro: principal, fontes: [principal, planilha], candidatos: [], historico: [], baixas: [] });
    const html = renderToStaticMarkup(await PaginaDetalhe({ params: Promise.resolve({ chave: encodeURIComponent(principal.chave) }), searchParams: Promise.resolve({}) }));
    expect(html).toContain("fixture.xlsx");
    expect(html).toContain("Linha: 12");
    expect(html).toContain("não há decisão manual registrada");
    expect(html).toContain("origem ainda a confirmar");
    expect(html).toContain('data-revisao-exclusao="BRISA:RECEBER:r1"');
    expect(html).not.toContain("SEGREDO_TAXA");
    expect(html).not.toContain("SEGREDO_ADMINISTRACAO");
    expect(html).not.toContain('name="justificativa"');
  });
});

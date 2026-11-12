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
    expect(html).toContain(">Brisa<");
    expect(html).not.toContain("Manual");
    expect(html).not.toContain("Excel");
  });
  it("exibe apenas Brisa e Widesys para um grupo com origem de carga antiga", () => {
    const html = renderToStaticMarkup(<OrigensUnificadas origens={["PLANILHA", "WIDESYS", "BRISA"]} />);
    expect(html.match(/>Brisa</g)).toHaveLength(1);
    expect(html).not.toMatch(/planilha|excel/i);
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
  it("descarta filtros antigos de origem e duplicidade e preserva período e paginação", async () => {
    const html = renderToStaticMarkup(await OperacaoUnificada({ titulo: "A receber", base: "/recebimentos", dominio: "RECEBER", parametros: { estado: "PENDENTE", origem: "PLANILHA", q: "teste", mes: "2026-06", vencidos: "1" } }));
    expect(mocks.listar).toHaveBeenCalledWith(expect.objectContaining({ origem: undefined, estado: undefined, dominio: "RECEBER", q: "teste", mes: "2026-06", vencidos: true }));
    expect(html).not.toContain('name="origem"');
    expect(html).not.toContain("Possíveis duplicatas");
    expect(html).not.toContain("Reanalisar correspondências");
    const proxima = html.match(/<a\b[^>]*href="([^"]+)"[^>]*>Próxima<\/a>/)?.[1];
    expect(proxima).not.toContain("origem=PLANILHA");
    expect(proxima).toContain("mes=2026-06");
    expect(proxima).toContain("pagina=2");
    expect(html).toContain("estado=QUARENTENA");
  });
  it("não consulta a lista quando o perfil não pode acessar dados globais", async () => {
    mocks.perfil.mockResolvedValue("CONTABILIDADE");
    await expect(OperacaoUnificada({ titulo: "Teste", base: "/unificacao" })).rejects.toThrow("ACESSO_NEGADO");
    expect(mocks.listar).not.toHaveBeenCalled();
  });
  it("Pessoas e empresas ignora links de origem arquivada e omite a opção no seletor", async () => {
    const dados = lista();
    dados.itens = [registro({ dominio: "PESSOA", chave: "BRISA:PESSOA:r1", origens: ["PLANILHA"] })];
    mocks.listar.mockResolvedValue(dados);
    const html = renderToStaticMarkup(await OperacaoUnificada({ titulo: "Pessoas e empresas", base: "/cadastros/pessoas", dominio: "PESSOA", parametros: { origem: "PLANILHA" } }));
    expect(mocks.listar).toHaveBeenCalledWith(expect.objectContaining({ origem: undefined, dominio: "PESSOA" }));
    expect(html).toContain('name="origem"');
    expect(html).toContain(">Brisa<");
    expect(html).not.toMatch(/planilha|excel/i);
  });
  it("exibe a confirmação do Widesys sem oferecer nova decisão no recebimento", async () => {
    mocks.acesso.mockResolvedValue({ usuarioId: "teste", perfil: "FINANCEIRO", ativo: true, global: true, regras: [], permissoes: ["financeiro.ver", "unificacao.ver", "cadastros.sensiveis"] });
    const dados = lista();
    dados.itens[0] = registro({ origem: "WIDESYS", chave: "WIDESYS:RECEBER:1", origens: ["WIDESYS"], conferidoNaOrigem: true, conferidoPorRegra: true });
    mocks.listar.mockResolvedValue(dados);
    const html = renderToStaticMarkup(await OperacaoUnificada({ titulo: "A receber", base: "/recebimentos", dominio: "RECEBER" }));
    expect(html).not.toMatch(/<button[^>]*>Conferir(?:ido)?<\/button>/);
    expect(html).toContain("Ver detalhes");
    expect(html).toContain(">Conferido<");
    expect(html).toContain("Este registro compõe os totais");
  });
  it("mantém a inconsistência do Widesys identificada e permite consultar seus detalhes", async () => {
    const dados = lista();
    dados.itens[0] = registro({ origem: "WIDESYS", chave: "WIDESYS:RECEBER:1", origens: ["WIDESYS"], estado: "QUARENTENA", contabiliza: false });
    mocks.listar.mockResolvedValue(dados);
    const html = renderToStaticMarkup(await OperacaoUnificada({ titulo: "A receber", base: "/recebimentos", dominio: "RECEBER" }));
    expect(html).toContain("Ver detalhes");
    expect(html).toContain("Dado inconsistente");
    expect(html).toContain("Este registro está fora dos totais");
    expect(html).not.toContain("Revisar e resolver");
  });
  it.each(["PAGAR", "RECEBER"] as const)("conserva exclusão administrativa sem conferência em lote em %s", async dominio => {
    const dados = lista();
    dados.itens[0] = registro({ dominio, origem: "WIDESYS", chave: `WIDESYS:${dominio}:1`, origens: ["WIDESYS"] });
    mocks.listar.mockResolvedValue(dados);
    const base = dominio === "PAGAR" ? "/financeiro/contas-a-pagar" : "/recebimentos";
    const html = renderToStaticMarkup(await OperacaoUnificada({ titulo: "Financeiro", base, dominio }));
    expect(html).not.toContain("Marcar selecionados como conferidos");
    expect(html).toContain("Selecionar todos os registros desta página");
    expect(html).toContain("Excluir selecionados");
    expect(html).not.toContain("Nova despesa");
  });
  it("detalhe financeiro omite evidência de planilha, comparação e campos de comissão", async () => {
    const principal = registro({ chave: "WIDESYS:RECEBER:1", origem: "WIDESYS", origens: ["WIDESYS"], campos: { pessoa: { rotulo: "Pessoa", valor: "Pessoa permitida" }, taxa: { rotulo: "Taxa reservada", valor: "SEGREDO_TAXA" }, administracao: { rotulo: "Administração", valor: "SEGREDO_ADMINISTRACAO" } } });
    const planilha = registro({ chave: "BRISA:RECEBER:planilha", proveniencia: { arquivo: "fixture.xlsx", aba: "Plan1", linha: 12 } });
    mocks.detalhe.mockResolvedValue({ registro: principal, fontes: [principal, planilha], candidatos: [], historico: [], baixas: [] });
    const html = renderToStaticMarkup(await PaginaDetalhe({ params: Promise.resolve({ chave: encodeURIComponent(principal.chave) }), searchParams: Promise.resolve({ buscarDestino: "fixture" }) }));
    expect(mocks.detalhe).toHaveBeenCalledWith(principal.chave, "");
    expect(html).toContain("Pessoa permitida");
    expect(html).toContain('data-revisao-exclusao="WIDESYS:RECEBER:1"');
    expect(html).not.toMatch(/fixture\.xlsx|Comparar lado a lado|SEGREDO_TAXA|SEGREDO_ADMINISTRACAO|name="justificativa"/);
  });
});

import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DominioUnificacao, LinhaUnificada, ListaUnificada } from "@/lib/unificacao/tipos";

const mocks = vi.hoisted(() => ({
  perfil: vi.fn(), acesso: vi.fn(), listar: vi.fn(), conferencia: vi.fn(), exclusao: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/autorizacao", () => ({ perfilAtual: mocks.perfil }));
vi.mock("@/lib/acesso/servidor", () => ({ acessoAtual: mocks.acesso }));
vi.mock("@/lib/consultas/unificacao", () => ({ listarUnificados: mocks.listar }));
vi.mock("@/app/(app)/unificacao/actions", () => ({ sincronizarUnificacao: vi.fn(), sincronizarUnificacaoNaTela: vi.fn() }));
vi.mock("@/components/acao-autorizada", () => ({ AcaoAutorizada: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/botao-unificacao", () => ({ BotaoUnificacao: ({ children }: { children: ReactNode }) => <button>{children}</button> }));
vi.mock("@/components/formulario-na-tela", () => ({ FormularioNaTela: ({ children }: { children: ReactNode }) => <form data-formulario-na-tela="true">{children}</form> }));
vi.mock("@/components/janela-contextual", () => ({ JanelaContextual: ({ titulo, retorno, children }: { titulo: string; retorno: string; children: ReactNode }) => <div data-janela="true" data-retorno={retorno}><h2>{titulo}</h2>{children}</div> }));
vi.mock("@/components/conferencia-registro", () => ({ ConferenciaRegistro: mocks.conferencia }));
vi.mock("@/app/(app)/cadastros/governanca/exclusao", () => ({ TelaExclusao: mocks.exclusao }));
vi.mock("@/components/excluir-registro-link", () => ({
  ExcluirUnificadoLink: ({ registro, href }: { registro: LinhaUnificada; href?: string }) => <a data-excluir={registro.chave} href={href ?? `/cadastros/governanca?origemId=${encodeURIComponent(registro.chave)}`}>Excluir da plataforma</a>,
}));
vi.mock("@/components/ui", () => ({
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Dinheiro: ({ centavos }: { centavos?: number | null }) => <span>{centavos ?? 0}</span>,
  Kpi: ({ rotulo, valor }: { rotulo: string; valor: ReactNode }) => <div>{rotulo}{valor}</div>,
  PageHeader: ({ titulo, acoes }: { titulo: string; acoes: ReactNode }) => <header><h1>{titulo}</h1>{acoes}</header>,
  Sigilo: ({ children }: { children: ReactNode }) => children,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  btnPrimario: "btn", btnSecundario: "btn", inputBase: "input",
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("ACESSO_NEGADO"); } }));

import { OperacaoUnificada } from "./operacao-unificada";
import { TabelaOperacaoUnificada, type LinhaTabelaOperacao } from "./tabela-operacao-unificada";

const filtros = {
  q: "Conta com espaço", origem: "WIDESYS", estado: "PENDENTE", mes: "2026-06",
  de: "2026-06-01", ate: "2026-06-30", pagina: "3", vencidos: "1",
};
const cenarios = [
  { base: "/financeiro/contas-a-pagar", dominio: "PAGAR" },
  { base: "/financeiro/contas-a-receber", dominio: "RECEBER" },
  { base: "/recebimentos", dominio: "RECEBER" },
] as const;

function registro(dominio: DominioUnificacao = "PAGAR"): LinhaUnificada {
  const chave = `WIDESYS:${dominio}:teste_1`;
  return {
    chave, dominio, origem: "WIDESYS", origemId: "teste_1", titulo: "Registro de teste", descricao: "Fonte preservada",
    href: "/cadastros/pessoas/fixture", hash: "fixture", qualidade: "OK", motivos: [], campos: {}, nomeNorm: "REGISTRO",
    estado: "PENDENTE", origens: ["WIDESYS"], fontes: [chave], versao: 1, candidatos: [], avisos: [], contabiliza: false,
    divergencias: [], valor: 10000, pago: 0, aberto: 10000,
  };
}

function lista(dominio: DominioUnificacao = "PAGAR"): ListaUnificada {
  return {
    itens: [registro(dominio)], total: 100, pagina: 3, paginas: 4, porPagina: 25, sincronizado: true,
    resumo: { ativos: 1, pendentes: 1, vinculados: 0, quarentena: 0, devido: 0, pago: 0, aberto: 0, devidoPendente: 10000, pagoPendente: 0, abertoPendente: 10000, entradas: 0, saidas: 0, vencidos: 0, valorVencido: 0 },
  };
}

function links(html: string, texto: string): URL[] {
  return [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
    .filter((match) => match[2] === texto)
    .map((match) => new URL(match[1].replaceAll("&amp;", "&"), "http://brisa.test"));
}

function conferirContexto(url: URL, base: string, extras: Record<string, string> = {}) {
  expect(url.pathname).toBe(base);
  expect(Object.fromEntries(url.searchParams)).toEqual({ ...filtros, ...extras });
}

function linhasEnviadasAoCliente(arvore: ReactNode): LinhaTabelaOperacao[] {
  for (const filho of Children.toArray(arvore)) {
    if (!isValidElement<{ itens?: LinhaTabelaOperacao[]; children?: ReactNode }>(filho)) continue;
    if (filho.type === TabelaOperacaoUnificada) return filho.props.itens!;
    const itens = linhasEnviadasAoCliente(filho.props.children);
    if (itens.length) return itens;
  }
  return [];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.perfil.mockResolvedValue("ADMINISTRADOR");
  mocks.acesso.mockResolvedValue({ usuarioId: "teste", perfil: "ADMINISTRADOR", ativo: true, global: true, regras: [], permissoes: ["cadastros.sensiveis", "governanca.editar"] });
  mocks.listar.mockResolvedValue(lista());
  mocks.conferencia.mockResolvedValue(<p>Conteúdo da conferência</p>);
  mocks.exclusao.mockResolvedValue(<p>Conteúdo da exclusão</p>);
});

describe("popup financeiro integrado à lista SSR", () => {
  it("envia somente o DTO exibido e preserva as 25 linhas da paginação", async () => {
    const dados = lista();
    dados.itens = Array.from({ length: 25 }, (_, indice) => ({
      ...registro(), chave: `WIDESYS:PAGAR:linha_${indice}`, titulo: `Título ${indice}`,
      hash: "SEGREDO_HASH", documento: "SEGREDO_DOCUMENTO", nomeNorm: "SEGREDO_NORMALIZADO",
      pessoaChave: "SEGREDO_VINCULO", proveniencia: { payload: "SEGREDO_PAYLOAD" },
      campos: { comissao: { rotulo: "Comissão", valor: "SEGREDO_COMISSAO" } },
      candidatos: [{ chave: "SEGREDO_CANDIDATO", titulo: "SEGREDO_NOME", descricao: "SEGREDO_CONTATO", motivos: [] }],
    }));
    mocks.listar.mockResolvedValue(dados);
    const itens = linhasEnviadasAoCliente(await OperacaoUnificada({ dominio: "PAGAR", titulo: "Pagar", base: "/financeiro/contas-a-pagar" }));
    expect(itens).toHaveLength(25);
    expect(itens[24].titulo).toBe("Título 24");
    expect(itens[0].correspondencias).toBe(1);
    expect(JSON.stringify(itens)).not.toContain("SEGREDO");
    expect(Object.keys(itens[0]).sort()).toEqual(["chave", "dominio", "titulo", "descricao", "origens", "papeis", "estado", "contabiliza", "correspondencias", "aviso", "impacto", "data", "competencia", "valor", "pago", "aberto", "natureza", "hrefDetalhe", "hrefCadastro", "exclusao"].sort());
  });

  it("não envia montantes que não são exibidos em cadastros", async () => {
    const dados = lista("PESSOA");
    dados.itens[0] = { ...dados.itens[0], valor: 456789, pago: 123456, aberto: 333333, natureza: "NAO_EXIBIDA" };
    mocks.listar.mockResolvedValue(dados);
    const itens = linhasEnviadasAoCliente(await OperacaoUnificada({ dominio: "PESSOA", titulo: "Cadastros", base: "/cadastros/base-unificada" }));
    expect(itens[0]).toMatchObject({ valor: null, pago: null, aberto: null, natureza: null });
  });

  it("não envia URL de exclusão a financeiro, mesmo com a permissão extra", async () => {
    mocks.perfil.mockResolvedValue("FINANCEIRO");
    mocks.acesso.mockResolvedValue({ usuarioId: "financeiro", perfil: "FINANCEIRO", ativo: true, global: true, regras: [], permissoes: ["cadastros.sensiveis", "governanca.editar"] });
    const arvore = await OperacaoUnificada({ dominio: "PAGAR", titulo: "Pagar", base: "/financeiro/contas-a-pagar" });
    expect(linhasEnviadasAoCliente(arvore)[0].exclusao).toBeNull();
    expect(renderToStaticMarkup(arvore)).not.toContain("Excluir da plataforma");
  });

  it("mantém devido, pago e aberto na apresentação compacta rotulada", async () => {
    const dados = lista();
    dados.itens[0] = { ...dados.itens[0], valor: 987600, pago: 345200, aberto: 642400 };
    mocks.listar.mockResolvedValue(dados);
    const html = renderToStaticMarkup(await OperacaoUnificada({ dominio: "PAGAR", titulo: "Pagar", base: "/financeiro/contas-a-pagar" }));
    expect(html).toContain('class="tabela tabela--acoes tabela-financeira"');
    const compacta = html.match(/<td class="tabela-valores-agrupados">([\s\S]*?)<\/td>/)?.[1];
    expect(compacta).toContain("<dt>Devido</dt>");
    expect(compacta).toContain("<dt>Pago</dt>");
    expect(compacta).toContain("<dt>Aberto</dt>");
    for (const valor of [987600, 345200, 642400]) {
      expect(compacta).toContain(`<span>${valor}</span>`);
      expect(html).toContain(`<td class="tabela-valor-separado text-right!"><span>${valor}</span></td>`);
    }
  });

  it("não agrupa colunas da central que mistura domínios", async () => {
    const html = renderToStaticMarkup(await OperacaoUnificada({ titulo: "Consulta", base: "/unificacao", parametros: { dominio: "PAGAR" } }));
    expect(html).not.toContain("tabela-financeira");
    expect(html).not.toContain("tabela-valores-agrupados");
  });

  it.each(cenarios)("mantém ações e contexto da lista em $base", async ({ base, dominio }) => {
    mocks.listar.mockResolvedValue(lista(dominio));
    const chave = registro(dominio).chave;
    const html = renderToStaticMarkup(await OperacaoUnificada({ dominio, titulo: "Financeiro", base, parametros: filtros }));
    for (const texto of ["Registro de teste", "Revisar e resolver"]) {
      const alvos = links(html, texto);
      expect(alvos).toHaveLength(1);
      conferirContexto(alvos[0], base, { registro: chave, painel: "detalhe" });
    }
    conferirContexto(links(html, "Excluir da plataforma")[0], base, { registro: chave, painel: "excluir" });
    conferirContexto(links(html, "Anterior")[0], base, { pagina: "2" });
    conferirContexto(links(html, "Próxima")[0], base, { pagina: "4" });
    expect(html).toContain('data-formulario-na-tela="true"');
    expect(html).not.toContain('href="/cadastros/pessoas/fixture"');
    expect(html).not.toContain("Abrir cadastro / lançamento");
    expect(html).not.toContain('href="/cadastros/governanca');
    expect(mocks.conferencia).not.toHaveBeenCalled();
    expect(mocks.exclusao).not.toHaveBeenCalled();
    expect(mocks.listar).toHaveBeenCalledWith(expect.objectContaining({ ...filtros, dominio, pagina: 3, vencidos: true }));
  });

  it.each(cenarios)("abre conferência em $base, encaminhando comparação e retorno limpo", async ({ base, dominio }) => {
    mocks.listar.mockResolvedValue(lista(dominio));
    const chave = registro(dominio).chave;
    const parametros = { ...filtros, registro: chave, painel: "detalhe", destino: `BRISA:${dominio}:principal`, buscarDestino: "principal distinto" };
    const html = renderToStaticMarkup(await OperacaoUnificada({ dominio, titulo: "Financeiro", base, parametros }));
    expect(mocks.conferencia).toHaveBeenCalledTimes(1);
    expect(mocks.exclusao).not.toHaveBeenCalled();
    const argumentos = mocks.conferencia.mock.calls[0][0];
    expect(argumentos.chave).toBe(chave);
    expect(argumentos.parametros).toEqual(parametros);
    conferirContexto(new URL(argumentos.contexto.retorno, "http://brisa.test"), base);
    conferirContexto(new URL(argumentos.contexto.hrefDetalhe, "http://brisa.test"), base, { registro: chave, painel: "detalhe" });
    conferirContexto(new URL(argumentos.contexto.hrefExcluir, "http://brisa.test"), base, { registro: chave, painel: "excluir" });
    expect(html).toContain('data-janela="true"');
    expect(html).toContain("Conferir e resolver registro");
    expect(html).toContain("Conteúdo da conferência");
  });

  it.each(cenarios)("abre somente confirmação de exclusão em $base", async ({ base, dominio }) => {
    mocks.listar.mockResolvedValue(lista(dominio));
    const chave = registro(dominio).chave;
    const html = renderToStaticMarkup(await OperacaoUnificada({ dominio, titulo: "Financeiro", base, parametros: { ...filtros, registro: chave, painel: "excluir" } }));
    expect(mocks.exclusao).toHaveBeenCalledTimes(1);
    expect(mocks.conferencia).not.toHaveBeenCalled();
    const argumentos = mocks.exclusao.mock.calls[0][0];
    expect(argumentos).toEqual({ tipo: "TITULO", origemId: chave, contexto: { retorno: expect.any(String) } });
    conferirContexto(new URL(argumentos.contexto.retorno, "http://brisa.test"), base);
    expect(html).toContain("Excluir ou restaurar registro");
    expect(html).toContain("Conteúdo da exclusão");
  });

  it.each([
    { registro: "WIDESYS:RECEBER:outro_dominio", painel: "detalhe" },
    { registro: "BRISA:RECEBER:outro_dominio", painel: "excluir" },
    { registro: "WIDESYS:PESSOA:pessoa", painel: "detalhe" },
    { registro: "PLANILHA:PAGAR:origem_nao_canonica", painel: "detalhe" },
    { registro: "WIDESYS:PAGAR:../alvo", painel: "excluir" },
    { registro: "WIDESYS:PAGAR:", painel: "detalhe" },
    { registro: "WIDESYS:PAGAR:teste_1", painel: "inexistente" },
    { registro: "WIDESYS:PAGAR:teste_1" },
    { painel: "excluir" },
  ])("não abre popup para seleção inválida $registro/$painel", async (selecao) => {
    const html = renderToStaticMarkup(await OperacaoUnificada({ dominio: "PAGAR", titulo: "Financeiro", base: "/financeiro/contas-a-pagar", parametros: { ...filtros, ...selecao } }));
    expect(mocks.conferencia).not.toHaveBeenCalled();
    expect(mocks.exclusao).not.toHaveBeenCalled();
    expect(html).not.toContain('data-janela="true"');
  });

  it("mantém os detalhes e cadastros externos nos demais domínios", async () => {
    mocks.listar.mockResolvedValue(lista("MOVIMENTO"));
    const chave = registro("MOVIMENTO").chave;
    const html = renderToStaticMarkup(await OperacaoUnificada({ dominio: "MOVIMENTO", titulo: "Caixa", base: "/caixa", parametros: { registro: chave, painel: "detalhe" } }));
    const detalhe = links(html, "Revisar e resolver")[0];
    expect(detalhe.pathname).toBe(`/unificacao/${encodeURIComponent(chave)}`);
    expect(links(html, "Abrir cadastro / lançamento")[0].pathname).toBe("/cadastros/pessoas/fixture");
    expect(links(html, "Excluir da plataforma")[0].pathname).toBe("/cadastros/governanca");
    expect(html).not.toContain('data-formulario-na-tela="true"');
    expect(html).not.toContain('data-janela="true"');
    expect(mocks.conferencia).not.toHaveBeenCalled();
    expect(mocks.exclusao).not.toHaveBeenCalled();
  });

  it("não força popup na central independente nem na visão de locação", async () => {
    for (const opcoes of [
      { base: "/unificacao", parametros: { dominio: "PAGAR", registro: "WIDESYS:PAGAR:teste_1", painel: "detalhe" } },
      { base: "/recebimentos", parametros: { visao: "locacao", dominio: "RECEBER", registro: "WIDESYS:RECEBER:teste_1", painel: "excluir" } },
    ]) {
      const html = renderToStaticMarkup(await OperacaoUnificada({ titulo: "Consulta", ...opcoes }));
      expect(html).not.toContain('data-janela="true"');
      expect(html).toContain("Abrir cadastro / lançamento");
    }
    expect(mocks.conferencia).not.toHaveBeenCalled();
    expect(mocks.exclusao).not.toHaveBeenCalled();
  });

  it("nega a lista e os componentes do popup antes de consultar dados sem acesso", async () => {
    mocks.perfil.mockResolvedValue("CONTABILIDADE");
    await expect(OperacaoUnificada({ dominio: "PAGAR", titulo: "Financeiro", base: "/financeiro/contas-a-pagar", parametros: { registro: "WIDESYS:PAGAR:teste_1", painel: "detalhe" } })).rejects.toThrow("ACESSO_NEGADO");
    expect(mocks.listar).not.toHaveBeenCalled();
    expect(mocks.conferencia).not.toHaveBeenCalled();
    expect(mocks.exclusao).not.toHaveBeenCalled();
  });
});

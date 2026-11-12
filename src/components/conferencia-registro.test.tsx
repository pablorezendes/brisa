import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoliticaAcesso } from "@/lib/acesso/politica";
import type { LinhaUnificada } from "@/lib/unificacao/tipos";

const mocks = vi.hoisted(() => ({ perfil: vi.fn(), acesso: vi.fn(), pagina: vi.fn(), permissao: vi.fn(), detalhe: vi.fn(), resolver: vi.fn(), resolverNaTela: vi.fn(), baixaManual: vi.fn(), baixaWidesys: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/autorizacao", () => ({ perfilAtual: mocks.perfil }));
vi.mock("@/lib/acesso/servidor", () => ({ acessoAtual: mocks.acesso, exigirPaginaAcesso: mocks.pagina, exigirPermissaoAcesso: mocks.permissao }));
vi.mock("@/lib/consultas/unificacao", () => ({ detalheUnificado: mocks.detalhe }));
vi.mock("@/app/(app)/unificacao/actions", () => ({ resolverUnificacao: mocks.resolver, resolverUnificacaoNaTela: mocks.resolverNaTela }));
vi.mock("@/app/(app)/recebimentos/novo/actions", () => ({ registrarBaixaRecebimentoManual: mocks.baixaManual, registrarBaixaRecebimentoWidesys: mocks.baixaWidesys }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/form", () => ({ default: ({ children, action, scroll }: { children: ReactNode; action: string; scroll?: boolean }) => <form action={action} data-scroll={String(scroll)}>{children}</form> }));
vi.mock("@/components/formulario-na-tela", () => ({ FormularioNaTela: ({ children, action, className }: { children: ReactNode; action: unknown; className?: string }) => <form className={className} data-inline-action={action === mocks.resolverNaTela ? "resolver" : "outra"}>{children}</form> }));
vi.mock("@/components/excluir-registro-link", () => ({ ExcluirUnificadoLink: () => <a href="/cadastros/governanca?modo=excluir">Excluir da plataforma</a> }));

import { ConferenciaRegistro } from "./conferencia-registro";
import { CamposRegistroConferencia } from "./campos-conferencia";
import { FormularioLancamentoManual } from "./formulario-lancamento-manual";

function camposEnviados(no: ReactNode): unknown {
  if (!isValidElement<{ children?: ReactNode; campos?: unknown }>(no)) return undefined;
  if (no.type === CamposRegistroConferencia) return no.props.campos;
  for (const filho of Children.toArray(no.props.children)) {
    const campos = camposEnviados(filho);
    if (campos) return campos;
  }
}

function acaoDoFormulario(no: ReactNode): ComponentProps<typeof FormularioLancamentoManual>["acao"] | undefined {
  if (!isValidElement<{ children?: ReactNode; acao?: ComponentProps<typeof FormularioLancamentoManual>["acao"] }>(no)) return;
  if (no.type === FormularioLancamentoManual) return no.props.acao;
  for (const filho of Children.toArray(no.props.children)) {
    const acao = acaoDoFormulario(filho);
    if (acao) return acao;
  }
}

function registro(extras: Partial<LinhaUnificada> = {}): LinhaUnificada {
  return { chave: "WIDESYS:PAGAR:t1", dominio: "PAGAR", origem: "WIDESYS", origemId: "t1", titulo: "Fornecedor de teste", descricao: "Despesa de teste", href: "/origem-separada", hash: "hash-1", qualidade: "OK", motivos: [], campos: { pessoa: { rotulo: "Pessoa", valor: "Pessoa permitida" } }, nomeNorm: "FORNECEDOR", estado: "PENDENTE", origens: ["WIDESYS"], fontes: ["WIDESYS:PAGAR:t1"], versao: 2, candidatos: [], avisos: [], contabiliza: false, divergencias: [], ...extras };
}
const politica = (): PoliticaAcesso => ({ usuarioId: "admin-teste", perfil: "ADMINISTRADOR", ativo: true, global: true, regras: [], permissoes: ["cadastros.sensiveis", "unificacao.editar", "pagamentos.conciliar", "governanca.editar"] });
const contexto = {
  retorno: "/financeiro/contas-a-pagar?origem=WIDESYS&mes=2026-06&pagina=3&q=teste&estado=PENDENTE&vencidos=1",
  hrefDetalhe: "/financeiro/contas-a-pagar?origem=WIDESYS&mes=2026-06&pagina=3&q=teste&estado=PENDENTE&vencidos=1&registro=WIDESYS%3APAGAR%3At1&destino=antigo&buscarDestino=antiga&erro=antigo",
  hrefExcluir: "/financeiro/contas-a-pagar?origem=WIDESYS&mes=2026-06&pagina=3&registro=WIDESYS%3APAGAR%3At1&acaoRegistro=excluir",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.perfil.mockResolvedValue("ADMINISTRADOR");
  mocks.acesso.mockResolvedValue(politica());
  const principal = registro();
  const candidato = registro({ chave: "BRISA:PAGAR:t2", origem: "BRISA", origemId: "t2", estado: "ATIVO", titulo: "Principal de teste", origens: ["BRISA"], hash: "hash-2" });
  mocks.detalhe.mockResolvedValue({ registro: principal, candidatos: [candidato], fontes: [principal], historico: [], baixas: [] });
});

describe("conferência dentro da lista financeira", () => {
  it("envia a baixa importada para a ação Widesys com o ID e a lista de origem", async () => {
    mocks.acesso.mockResolvedValue({ ...politica(), permissoes: [...politica().permissoes, "recebimentos.editar", "caixa.editar"] });
    const titulo = registro({ chave: "WIDESYS:RECEBER:r1", dominio: "RECEBER", origemId: "r1", estado: "ATIVO", contabiliza: true, aberto: 3000 });
    mocks.detalhe.mockResolvedValue({ registro: titulo, candidatos: [], fontes: [titulo], historico: [], baixas: [] });
    const retorno = "/recebimentos?mes=2026-11&pagina=2";
    const acao = acaoDoFormulario(await ConferenciaRegistro({ chave: titulo.chave, contexto: { retorno, hrefDetalhe: retorno, priorizarBaixa: true } }));
    const dados = new FormData();
    dados.set("valor", "15,00");
    await acao!({}, dados);
    expect(mocks.baixaWidesys).toHaveBeenCalledWith(titulo.origemId, expect.any(String), retorno, {}, dados);
    expect(mocks.baixaManual).not.toHaveBeenCalled();
  });

  it("projeta somente campos visíveis para a apresentação cliente", async () => {
    const pessoa = { rotulo: "Pessoa", valor: "Pessoa permitida", interno: "SEGREDO_INTERNO" };
    const principal = registro({ campos: { pessoa, taxa: { rotulo: "Taxa", valor: "SEGREDO_TAXA" } } });
    mocks.detalhe.mockResolvedValue({ registro: principal, candidatos: [], fontes: [principal], historico: [], baixas: [] });
    const campos = camposEnviados(await ConferenciaRegistro({ chave: principal.chave, contexto }));
    expect(campos).toEqual([{ chave: "pessoa", campo: { rotulo: "Pessoa", valor: "Pessoa permitida" } }]);
    expect(JSON.stringify(campos)).not.toContain("SEGREDO");
  });

  it("mantém os filtros na ação de exclusão e ignora a busca de comparações", async () => {
    const html = renderToStaticMarkup(await ConferenciaRegistro({ chave: "WIDESYS:PAGAR:t1", parametros: { buscarDestino: "fornecedor" }, contexto }));
    expect(mocks.detalhe).toHaveBeenCalledWith("WIDESYS:PAGAR:t1", "");
    expect(html).toContain("mes=2026-06&amp;pagina=3");
    expect(html).toContain("acaoRegistro=excluir");
    expect(html).not.toMatch(/Comparar lado a lado|buscarDestino|data-inline-action|retornoContexto|origem-separada/);
    expect(html).not.toContain('href="/unificacao');
    expect(mocks.resolver).not.toHaveBeenCalled();
    expect(mocks.resolverNaTela).not.toHaveBeenCalled();
  });

  it("mostra as baixas do Widesys e oculta valores e metadados de outras fontes", async () => {
    const reservado = { taxa: { rotulo: "Taxa", valor: "SEGREDO_TAXA" }, administracao: { rotulo: "Administração", valor: "SEGREDO_ADMIN" }, composicao: { rotulo: "Composição", valor: "SEGREDO_COMPOSICAO" } };
    const principal = registro({ campos: { ...registro().campos, ...reservado } });
    const candidato = registro({ chave: "BRISA:PAGAR:t2", titulo: "Principal de teste", estado: "ATIVO", campos: { ...registro().campos, ...reservado } });
    const planilha = registro({ chave: "BRISA:PAGAR:planilha", origem: "BRISA", proveniencia: { arquivo: "fixture.xlsx", aba: "Caixa distinto", linha: 12 }, campos: reservado });
    const baixa = registro({ chave: "WIDESYS:BAIXA_PAGAR:b1", dominio: "BAIXA_PAGAR", data: "2026-06-10", valor: 10000, campos: { documento: { rotulo: "Documento", valor: "RECIBO-TESTE" }, ...reservado } });
    const baixaArquivada = registro({ chave: "BRISA:BAIXA_PAGAR:b2", origem: "BRISA", dominio: "BAIXA_PAGAR", descricao: "BAIXA-ARQUIVADA" });
    mocks.detalhe.mockResolvedValue({ registro: principal, candidatos: [candidato], fontes: [principal, planilha], historico: [], baixas: [baixa, baixaArquivada] });
    const html = renderToStaticMarkup(await ConferenciaRegistro({ chave: principal.chave, parametros: { destino: candidato.chave }, contexto }));
    expect(html).toContain("sm:grid-cols-2");
    expect(html).not.toContain("min-w-[230px]");
    expect(html).toContain("Baixas registradas no Widesys");
    expect(html).toContain("RECIBO-TESTE");
    expect(html).not.toMatch(/comparacao|destinoChave|fixture\.xlsx|Caixa distinto|BAIXA-ARQUIVADA/);
    expect(html).not.toContain("WIDESYS%3ABAIXA_PAGAR%3Ab1");
    expect(html).not.toContain("SEGREDO_");
  });

  it("não oferece vínculo ou distinção para dado inconsistente", async () => {
    const principal = registro({ qualidade: "QUARENTENA", estado: "QUARENTENA" });
    mocks.detalhe.mockResolvedValue({ registro: principal, candidatos: [], fontes: [principal], historico: [], baixas: [] });
    const html = renderToStaticMarkup(await ConferenciaRegistro({ chave: principal.chave, contexto }));
    expect(html).toContain("Confira este lançamento no Widesys");
    expect(html).not.toContain('name="justificativa"');
    expect(html).toContain("Excluir da plataforma");
  });

  it("financeiro sem conciliação consulta mas não recebe ações reservadas de decisão e exclusão", async () => {
    mocks.perfil.mockResolvedValue("FINANCEIRO");
    mocks.acesso.mockResolvedValue({ ...politica(), perfil: "FINANCEIRO", permissoes: ["cadastros.sensiveis", "governanca.editar", "unificacao.editar"] });
    const html = renderToStaticMarkup(await ConferenciaRegistro({ chave: "WIDESYS:PAGAR:t1", contexto }));
    expect(html).toContain("Fornecedor de teste");
    expect(html).not.toContain('name="justificativa"');
    expect(html).not.toContain("Excluir da plataforma");
    expect(mocks.pagina).toHaveBeenCalledWith("/unificacao/[chave]");
    expect(mocks.permissao).toHaveBeenCalledWith("cadastros.sensiveis", { global: true });
  });

  it.each(["CONTABILIDADE", "SOCIO"])("nega dados ao perfil %s antes de consultar", async perfil => {
    mocks.perfil.mockResolvedValue(perfil);
    await expect(ConferenciaRegistro({ chave: "WIDESYS:PAGAR:t1", contexto })).rejects.toThrow("NOT_FOUND");
    expect(mocks.detalhe).not.toHaveBeenCalled();
  });

  it("não aceita usar o modal financeiro para abrir outros domínios", async () => {
    mocks.detalhe.mockResolvedValue({ registro: registro({ dominio: "PARAMETRO" }), candidatos: [], fontes: [], historico: [], baixas: [] });
    await expect(ConferenciaRegistro({ chave: "WIDESYS:PARAMETRO:p1", contexto })).rejects.toThrow("NOT_FOUND");
  });

  it("mantém o detalhe avulso vinculado à lista do próprio domínio", async () => {
    const html = renderToStaticMarkup(await ConferenciaRegistro({ chave: "WIDESYS:PAGAR:t1" }));
    expect(html).toContain('href="/financeiro/contas-a-pagar"');
    expect(html).toContain("Voltar à lista");
    expect(html).not.toMatch(/origem-separada|retornoContexto|data-inline-action/);
  });

  it("bloqueia detalhes financeiros arquivados que não vieram do Widesys", async () => {
    const arquivado = registro({ chave: "BRISA:PAGAR:t1", origem: "BRISA" });
    mocks.detalhe.mockResolvedValue({ registro: arquivado, candidatos: [], fontes: [], historico: [], baixas: [] });
    await expect(ConferenciaRegistro({ chave: arquivado.chave })).rejects.toThrow("NOT_FOUND");
  });

  it("preserva os dados cadastrais no detalhe e esconde valores de contratos antigos", async () => {
    const contrato = registro({ chave: "BRISA:CONTRATO:t1", origem: "BRISA", dominio: "CONTRATO", campos: {
      pessoa: { rotulo: "Pessoa", valor: "Pessoa permitida" },
      aluguel: { rotulo: "Aluguel antigo", valor: 11223344, tipo: "dinheiro" },
    } });
    mocks.detalhe.mockResolvedValue({ registro: contrato, candidatos: [], fontes: [contrato], historico: [], baixas: [] });
    const html = renderToStaticMarkup(await ConferenciaRegistro({ chave: contrato.chave }));
    expect(html).toContain("Pessoa permitida");
    expect(html).not.toContain("Aluguel antigo");
  });
});

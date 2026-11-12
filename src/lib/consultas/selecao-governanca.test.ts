import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FonteUnificacao } from "../unificacao/tipos";

const mocks = vi.hoisted(() => ({ autorizar: vi.fn(), dados: vi.fn(), fontes: vi.fn(), decisoes: vi.fn(), governados: vi.fn(), transaction: vi.fn(), emTransacao: false }));
vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("../acesso/servidor", () => ({ exigirPermissaoAcesso: mocks.autorizar }));
vi.mock("../unificacao/fontes", () => ({ carregarDadosFontesUnificacao: mocks.dados, derivarFontesUnificacao: mocks.fontes }));
vi.mock("../db", () => ({ prisma: { $transaction: mocks.transaction } }));

import { buscarFinanceirosGovernanca, financeiroSelecionadoGovernanca, filtrosSelecaoGovernanca } from "./selecao-governanca";

function fonte(id: string, patch: Partial<FonteUnificacao> = {}): FonteUnificacao {
  const origem = patch.origem ?? "WIDESYS";
  const dominio = patch.dominio ?? "RECEBER";
  return { chave: `${origem}:${dominio}:${id}`, origemId: id, origem, dominio, titulo: `Lançamento ${id}`, descricao: "Conta de energia",
    href: null, hash: `hash-${id}`, qualidade: "OK", motivos: [], campos: {}, nomeNorm: `LANCAMENTO ${id}`, data: "2026-01-10", competencia: "2026-01", natureza: "SAIDA", valor: 1000, ...patch };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.autorizar.mockResolvedValue({ perfil: "ADMINISTRADOR", usuarioId: "admin" });
  mocks.dados.mockResolvedValue({ fotografia: "somente dados relacionais" });
  mocks.fontes.mockResolvedValue([]);
  mocks.decisoes.mockResolvedValue([]);
  mocks.governados.mockResolvedValue([]);
  mocks.emTransacao = false;
  mocks.transaction.mockImplementation(async fn => {
    mocks.emTransacao = true;
    try { return await fn({ unificacaoRegistro: { findMany: mocks.decisoes }, recursoGovernado: { findMany: mocks.governados } }); }
    finally { mocks.emTransacao = false; }
  });
});

describe("seleção de títulos Widesys na governança", () => {
  it("restringe registros sigilosos também no acesso por ID", async () => {
    mocks.autorizar.mockResolvedValue({ perfil: "FINANCEIRO", usuarioId: "fin" });
    mocks.fontes.mockResolvedValue([fonte("privado", { titulo: "Fornecedor genérico", restrito: true }), fonte("publico")]);
    expect((await buscarFinanceirosGovernanca()).itens.map(i => i.id)).toEqual(["WIDESYS:RECEBER:publico"]);
    await expect(financeiroSelecionadoGovernanca("WIDESYS:RECEBER:privado")).rejects.toThrow("NOT_FOUND");
    mocks.autorizar.mockResolvedValue({ perfil: "ADMINISTRADOR", usuarioId: "admin" });
    expect((await financeiroSelecionadoGovernanca("WIDESYS:RECEBER:privado")).id).toBe("WIDESYS:RECEBER:privado");
  });
  it("libera a transação antes de projetar e dispensa proveniência de planilhas", async () => {
    mocks.dados.mockImplementation(async (_tx, _dominio, incluirProveniencia) => {
      expect(mocks.emTransacao).toBe(true);
      expect(incluirProveniencia).toBe(false);
      return { fotografia: "capturada na transação" };
    });
    mocks.fontes.mockImplementation(async (dados, incluirProveniencia) => {
      expect(mocks.emTransacao).toBe(false);
      expect(dados).toEqual({ fotografia: "capturada na transação" });
      expect(incluirProveniencia).toBe(false);
      return [fonte("titulo")];
    });
    expect((await buscarFinanceirosGovernanca()).total).toBe(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("limita texto e aceita somente competência válida", () => {
    expect(filtrosSelecaoGovernanca("  teste  ", "2026-13")).toEqual({ q: "teste", mes: "" });
    expect(filtrosSelecaoGovernanca("x".repeat(200), "2026-12")).toEqual({ q: "x".repeat(120), mes: "2026-12" });
  });

  it.each(["governanca.editar", "financeiro.ver", "cadastros.sensiveis"])("recusa falta de %s antes da leitura", async permissao => {
    mocks.autorizar.mockImplementation(async codigo => { if (codigo === permissao) throw new Error("NEGADO"); });
    await expect(buscarFinanceirosGovernanca()).rejects.toThrow("NEGADO");
    await expect(financeiroSelecionadoGovernanca("WIDESYS:RECEBER:id")).rejects.toThrow("NEGADO");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("filtra antes de limitar, pesquisa sem acento e mantém DTO mínimo", async () => {
    mocks.fontes.mockResolvedValue([
      ...Array.from({ length: 150 }, (_, n) => fonte(`outro-${n}`)),
      fonte("alvo", { titulo: "Condomínio reconhecido", data: "2026-09-12", competencia: "2026-09", campos: { documento: { rotulo: "CPF", valor: "documento-reservado" } } }),
    ]);
    expect((await buscarFinanceirosGovernanca()).itens).toHaveLength(30);
    const resultado = await buscarFinanceirosGovernanca({ q: "condominio", mes: "2026-09" });
    expect(resultado.total).toBe(1);
    expect(resultado.itens[0]).toEqual({ id: "WIDESYS:RECEBER:alvo", nome: "Condomínio reconhecido", data: "2026-09-12", competencia: "2026-09", origem: "Widesys", situacao: "ATIVO", href: null });
    expect(JSON.stringify(resultado)).not.toContain("documento-reservado");
  });

  it("exclui movimentos e títulos de planilha mesmo quando eles existem na fotografia", async () => {
    mocks.fontes.mockResolvedValue([fonte("local", { origem: "BRISA" }), fonte("caixa", { dominio: "MOVIMENTO" }), fonte("externo")]);
    expect((await buscarFinanceirosGovernanca()).itens.map(i => i.id)).toEqual(["WIDESYS:RECEBER:externo"]);
    await expect(financeiroSelecionadoGovernanca("BRISA:RECEBER:local")).rejects.toThrow("NOT_FOUND");
  });

  it("preserva o acesso ao excluído por link para restaurar", async () => {
    const excluido = fonte("excluido");
    mocks.fontes.mockResolvedValue([excluido]);
    mocks.governados.mockResolvedValue([{ tipo: "TITULO", origemId: excluido.chave, status: "EXCLUIDO" }]);
    expect((await buscarFinanceirosGovernanca()).total).toBe(0);
    expect((await buscarFinanceirosGovernanca({ excluidos: true })).itens[0].situacao).toBe("EXCLUIDO");
    expect((await financeiroSelecionadoGovernanca(excluido.chave)).situacao).toBe("EXCLUIDO");
  });

  it("preserva o sigilo de comissões sem esconder honorários contábeis", async () => {
    mocks.fontes.mockResolvedValue([
      fonte("comissao", { titulo: "Comissão de administração" }),
      fonte("honorario", { campos: { plano: { rotulo: "Plano", valor: "Honorários de administração" } } }),
      fonte("contabilidade", { campos: { plano: { rotulo: "Plano", valor: "Honorários contábeis" } } }),
    ]);
    expect((await buscarFinanceirosGovernanca()).itens.map(r => r.id)).toEqual(["WIDESYS:RECEBER:contabilidade"]);
    await expect(financeiroSelecionadoGovernanca("WIDESYS:RECEBER:comissao")).rejects.toThrow("NOT_FOUND");
    await expect(financeiroSelecionadoGovernanca("WIDESYS:RECEBER:honorario")).rejects.toThrow("NOT_FOUND");
  });
});

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
  const origem = patch.origem ?? "BRISA";
  const dominio = patch.dominio ?? "MOVIMENTO";
  return { chave: `${origem}:${dominio}:${id}`, origemId: id, origem, dominio, titulo: `Lançamento ${id}`, descricao: "Conta de energia",
    href: `/caixa/${id}/editar`, hash: `hash-${id}`, qualidade: "OK", motivos: [], campos: {}, nomeNorm: `LANCAMENTO ${id}`, data: "2026-01-10", competencia: "2026-01", natureza: "SAIDA", valor: 1000, ...patch };
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

describe("seleção simples e autorizada na governança", () => {
  it("libera a transação antes de derivar hashes e proveniência das planilhas", async () => {
    mocks.dados.mockImplementation(async () => {
      expect(mocks.emTransacao).toBe(true);
      return { fotografia: "capturada na transação" };
    });
    mocks.fontes.mockImplementation(async dados => {
      expect(mocks.emTransacao).toBe(false);
      expect(dados).toEqual({ fotografia: "capturada na transação" });
      return [fonte("local")];
    });
    expect((await buscarFinanceirosGovernanca("CAIXA")).total).toBe(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.fontes).toHaveBeenCalledTimes(1);
  });

  it("limita texto e aceita somente competência válida", () => {
    expect(filtrosSelecaoGovernanca("  teste  ", "2026-13")).toEqual({ q: "teste", mes: "" });
    expect(filtrosSelecaoGovernanca("x".repeat(200), "2026-12")).toEqual({ q: "x".repeat(120), mes: "2026-12" });
  });

  it.each(["governanca.editar", "financeiro.ver", "cadastros.sensiveis", "caixa.ver"])("recusa falta de %s antes da leitura", async permissao => {
    mocks.autorizar.mockImplementation(async codigo => { if (codigo === permissao) throw new Error("NEGADO"); });
    await expect(buscarFinanceirosGovernanca("CAIXA")).rejects.toThrow("NEGADO");
    await expect(financeiroSelecionadoGovernanca("CAIXA", "id")).rejects.toThrow("NEGADO");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("filtra antes de limitar, pesquisa sem acento e mantém DTO mínimo", async () => {
    mocks.fontes.mockResolvedValue([
      ...Array.from({ length: 150 }, (_, n) => fonte(`outro-${n}`)),
      fonte("alvo", { titulo: "Condomínio reconhecido", data: "2026-09-12", competencia: "2026-09", proveniencia: { arquivo: "Contas.xlsx", aba: "SET", snapshot: "segredo" }, campos: { documento: { rotulo: "CPF", valor: "documento-reservado" } } }),
    ]);
    const resultado = await buscarFinanceirosGovernanca("CAIXA", { q: "condominio", mes: "2026-09" });
    expect(resultado.total).toBe(1);
    expect(resultado.itens[0]).toEqual({ id: "alvo", nome: "Condomínio reconhecido", data: "2026-09-12", competencia: "2026-09", origem: "Excel · Contas.xlsx · SET", situacao: "ATIVO", href: "/caixa/alvo/editar" });
    expect(JSON.stringify(resultado)).not.toContain("segredo");
    expect(JSON.stringify(resultado)).not.toContain("documento-reservado");
  });

  it("não inclui movimentos Widesys no seletor de caixa nativo nem presume entrada manual", async () => {
    mocks.fontes.mockResolvedValue([fonte("local"), fonte("externo", { origem: "WIDESYS" })]);
    const resultado = await buscarFinanceirosGovernanca("CAIXA");
    expect(resultado.itens).toHaveLength(1);
    expect(resultado.itens[0].origem).toBe("Brisa · origem a confirmar");
  });

  it("limita a 30 escolhas e permite encontrar qualquer título mantido pelo filtro", async () => {
    const fontes = Array.from({ length: 160 }, (_, n) => fonte(`titulo-${n}`, { dominio: "RECEBER", titulo: `Locação referência ${n}`, competencia: "2026-01" }));
    mocks.fontes.mockResolvedValue(fontes);
    expect((await buscarFinanceirosGovernanca("TITULO")).itens).toHaveLength(30);
    const resultado = await buscarFinanceirosGovernanca("TITULO", { mantido: true, q: "referencia 159", excluirId: fontes[0].chave, dominio: "RECEBER" });
    expect(resultado.itens.map(r => r.id)).toEqual([fontes[159].chave]);
    expect(resultado.total).toBe(1);
  });

  it("restringe o mantido ao domínio e exclui a própria origem e quarentena", async () => {
    mocks.fontes.mockResolvedValue([
      fonte("origem", { dominio: "RECEBER" }), fonte("destino", { dominio: "RECEBER" }),
      fonte("pagar", { dominio: "PAGAR" }), fonte("inconsistente", { dominio: "RECEBER", qualidade: "QUARENTENA" }),
    ]);
    const resultado = await buscarFinanceirosGovernanca("TITULO", { mantido: true, excluirId: "BRISA:RECEBER:origem", dominio: "RECEBER" });
    expect(resultado.itens.map(r => r.id)).toEqual(["BRISA:RECEBER:destino"]);
  });

  it("preserva a seleção por link para restaurar, sem apresentar excluído como destino", async () => {
    mocks.fontes.mockResolvedValue([fonte("excluido")]);
    mocks.governados.mockResolvedValue([{ tipo: "CAIXA", origemId: "excluido", status: "EXCLUIDO" }]);
    expect((await buscarFinanceirosGovernanca("CAIXA")).total).toBe(0);
    expect((await buscarFinanceirosGovernanca("CAIXA", { excluidos: true })).itens[0].situacao).toBe("EXCLUIDO");
    expect((await financeiroSelecionadoGovernanca("CAIXA", "excluido")).situacao).toBe("EXCLUIDO");
  });

  it("comissões não entram em lista, contagem nem acesso direto de qualquer perfil", async () => {
    mocks.fontes.mockResolvedValue([
      fonte("comissao", { titulo: "Comissão de administração" }),
      fonte("honorario", { campos: { plano: { rotulo: "Plano", valor: "Honorários" } } }),
      fonte("normal"),
    ]);
    expect((await buscarFinanceirosGovernanca("CAIXA")).itens.map(r => r.id)).toEqual(["normal"]);
    await expect(financeiroSelecionadoGovernanca("CAIXA", "comissao")).rejects.toThrow("NOT_FOUND");
    await expect(financeiroSelecionadoGovernanca("CAIXA", "honorario")).rejects.toThrow("NOT_FOUND");
  });
});

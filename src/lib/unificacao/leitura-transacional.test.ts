import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { carregarDadosFontesUnificacao, derivarFontesUnificacao } from "./fontes";
import { lerOperacaoUnificada } from "./servico";

vi.mock("./fontes", () => ({
  carregarDadosFontesUnificacao: vi.fn(), carregarFontesUnificacao: vi.fn(),
  derivarFontesUnificacao: vi.fn(),
}));

beforeEach(() => vi.resetAllMocks());

describe("limite da transação de leitura unificada", () => {
  it("captura fontes e decisões na mesma transação e libera antes de derivar", async () => {
    const ordem: string[] = [];
    const foto = {} as Awaited<ReturnType<typeof carregarDadosFontesUnificacao>>;
    const tx = { unificacaoRegistro: { findMany: vi.fn(async () => {
      ordem.push("decisoes"); return [];
    }) } };
    const transacao = vi.fn(async (ler: (banco: typeof tx) => Promise<unknown>) => {
      ordem.push("inicio");
      const resultado = await ler(tx);
      ordem.push("fim");
      return resultado;
    });
    vi.mocked(carregarDadosFontesUnificacao).mockImplementation(async banco => {
      expect(banco).toBe(tx);
      expect(ordem).not.toContain("fim");
      ordem.push("dados");
      return foto;
    });
    vi.mocked(derivarFontesUnificacao).mockImplementation(async dados => {
      expect(dados).toBe(foto);
      expect(ordem).toContain("fim");
      ordem.push("derivacao");
      return [];
    });
    const db = { $transaction: transacao } as unknown as PrismaClient;
    await expect(lerOperacaoUnificada(db)).resolves.toEqual({ fontes: [], decisoes: [], linhas: [] });
    expect(ordem).toEqual(["inicio", "dados", "decisoes", "fim", "derivacao"]);
    expect(transacao).toHaveBeenCalledWith(expect.any(Function), { maxWait: 2000, timeout: 60000 });
  });

  it("propaga falha da fotografia sem produzir uma projeção incompleta", async () => {
    const falha = new Error("Falha artificial na leitura");
    vi.mocked(carregarDadosFontesUnificacao).mockRejectedValue(falha);
    const tx = { unificacaoRegistro: { findMany: vi.fn(async () => []) } };
    const db = { $transaction: (ler: (banco: typeof tx) => Promise<unknown>) => ler(tx) } as unknown as PrismaClient;
    await expect(lerOperacaoUnificada(db)).rejects.toBe(falha);
    expect(derivarFontesUnificacao).not.toHaveBeenCalled();
  });
});

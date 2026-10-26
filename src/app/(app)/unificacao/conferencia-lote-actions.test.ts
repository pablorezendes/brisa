import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ acesso: vi.fn(), financeiro: vi.fn(), preparar: vi.fn(), concluir: vi.fn(), revalidar: vi.fn(), db: {} }));
vi.mock("@/lib/acesso/servidor", () => ({ exigirPermissaoAcesso: mocks.acesso }));
vi.mock("@/lib/autorizacao", () => ({ exigirPermissaoFinanceira: mocks.financeiro }));
vi.mock("@/lib/db", () => ({ prisma: mocks.db }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidar }));
vi.mock("@/lib/unificacao/conferencia-lote", () => ({ prepararConferenciaLote: mocks.preparar, concluirConferenciaLote: mocks.concluir }));

import { prepararConferenciaSelecionados, conferirTitulosSelecionados } from "./conferencia-lote-actions";
import { ErroUnificacao } from "@/lib/unificacao/servico";
import type { EntradaConferenciaLote } from "@/lib/unificacao/tipos-conferencia-lote";

const selecao = { dominio: "PAGAR" as const, chaves: ["WIDESYS:PAGAR:a", "BRISA:PAGAR:b"] };
const entrada: EntradaConferenciaLote = { ...selecao, assinatura: "a".repeat(64), confirmado: true };
const concluido = { conferidos: 2, jaConferidos: 0, bloqueados: 0, mensagem: "2 lançamentos conferidos." };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.acesso.mockResolvedValue({ usuarioId: "admin", perfil: "ADMINISTRADOR" });
  mocks.financeiro.mockResolvedValue({ sub: "admin" });
  mocks.preparar.mockResolvedValue({ ...selecao, assinatura: entrada.assinatura, itens: [] });
  mocks.concluir.mockResolvedValue(concluido);
});

describe("ações de conferência financeira em lote", () => {
  it("autoriza antes da prévia e não invalida listas em uma consulta", async () => {
    expect(await prepararConferenciaSelecionados(selecao)).toMatchObject({ estado: "PRONTO" });
    expect(mocks.acesso).toHaveBeenCalledExactlyOnceWith("unificacao.editar", { global: true });
    expect(mocks.financeiro).toHaveBeenCalledExactlyOnceWith("CONCILIAR_PAGAMENTOS");
    expect(mocks.preparar).toHaveBeenCalledExactlyOnceWith(mocks.db, selecao, { id: "admin" });
    expect(mocks.financeiro.mock.invocationCallOrder[0]).toBeLessThan(mocks.preparar.mock.invocationCallOrder[0]);
    expect(mocks.revalidar).not.toHaveBeenCalled();
  });
  it("confirma apenas a seleção explícita e atualiza os totais após o commit", async () => {
    expect(await conferirTitulosSelecionados(entrada)).toEqual({ estado: "CONCLUIDO", resultado: concluido });
    expect(mocks.acesso).toHaveBeenCalledExactlyOnceWith("unificacao.editar", { global: true });
    expect(mocks.financeiro).toHaveBeenCalledExactlyOnceWith("CONCILIAR_PAGAMENTOS");
    expect(mocks.concluir).toHaveBeenCalledExactlyOnceWith(mocks.db, entrada, { id: "admin" });
    expect(mocks.revalidar).toHaveBeenCalledExactlyOnceWith("/", "layout");
    expect(mocks.concluir.mock.invocationCallOrder[0]).toBeLessThan(mocks.revalidar.mock.invocationCallOrder[0]);
  });
  it("seleção já conferida sincroniza a tela após eventual resposta perdida", async () => {
    mocks.concluir.mockResolvedValue({ ...concluido, conferidos: 0, jaConferidos: 2 });
    expect(await conferirTitulosSelecionados(entrada)).toMatchObject({ estado: "CONCLUIDO", resultado: { conferidos: 0, jaConferidos: 2 } });
    expect(mocks.revalidar).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });
  it.each(["acesso", "financeiro"] as const)("guarda %s impede leitura e gravação antes do serviço", async guarda => {
    mocks[guarda].mockRejectedValue(new Error("SEM_PERMISSAO"));
    await expect(prepararConferenciaSelecionados(selecao)).rejects.toThrow("SEM_PERMISSAO");
    await expect(conferirTitulosSelecionados(entrada)).rejects.toThrow("SEM_PERMISSAO");
    expect(mocks.preparar).not.toHaveBeenCalled();
    expect(mocks.concluir).not.toHaveBeenCalled();
    expect(mocks.revalidar).not.toHaveBeenCalled();
  });
  it("prévia desatualizada não anuncia sucesso nem recalcula a lista", async () => {
    mocks.concluir.mockRejectedValue(new ErroUnificacao("PREVIA_DESATUALIZADA", "Confira novamente a seleção."));
    expect(await conferirTitulosSelecionados(entrada)).toEqual({ estado: "ERRO", mensagem: "Confira novamente a seleção." });
    expect(mocks.revalidar).not.toHaveBeenCalled();
  });
  it("não expõe detalhes de exceções internas na prévia ou na confirmação", async () => {
    mocks.preparar.mockRejectedValue(new Error("SQL_CONTEUDO_PRIVADO"));
    mocks.concluir.mockRejectedValue(new Error("SQL_CONTEUDO_PRIVADO"));
    for (const resultado of [await prepararConferenciaSelecionados(selecao), await conferirTitulosSelecionados(entrada)]) {
      expect(resultado).toMatchObject({ estado: "ERRO", mensagem: expect.stringContaining("não serão somados novamente") });
      expect(JSON.stringify(resultado)).not.toContain("SQL_CONTEUDO_PRIVADO");
    }
    expect(mocks.revalidar).not.toHaveBeenCalled();
  });
});

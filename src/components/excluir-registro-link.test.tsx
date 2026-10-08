import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoliticaAcesso } from "@/lib/acesso/politica";

const mocks = vi.hoisted(() => ({ acesso: vi.fn() }));
vi.mock("@/lib/acesso/servidor", () => ({ acessoAtual: mocks.acesso }));
import { ExcluirRegistroLink, ExcluirUnificadoLink } from "./excluir-registro-link";

const administrador = (): PoliticaAcesso => ({ usuarioId: "teste", perfil: "ADMINISTRADOR", ativo: true, global: true, permissoes: ["governanca.editar"], regras: [] });
beforeEach(() => { vi.clearAllMocks(); mocks.acesso.mockResolvedValue(administrador()); });

describe("ação de exclusão visível somente a administrador global", () => {
  it("abre revisão com ID codificado e não executa mutação", async () => {
    const html = renderToStaticMarkup(await ExcluirRegistroLink({ tipo: "TITULO", origemId: "WIDESYS:PAGAR:t1&outro=1" }));
    expect(html).toContain("Excluir da plataforma");
    expect(html).toContain("tipo=TITULO&amp;origemId=WIDESYS%3APAGAR%3At1%26outro%3D1&amp;modo=excluir");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
  });

  it.each([
    { perfil: "FINANCEIRO" }, { perfil: "CONTABILIDADE" }, { ativo: false },
    { global: false }, { permissoes: [] }, { regras: [{ tipo: "UNIDADE", recursoId: "u1", efeito: "BLOQUEAR" }] },
  ])("oculta quando a política é incompatível: %j", async (negacao) => {
    mocks.acesso.mockResolvedValue({ ...administrador(), ...negacao });
    expect(await ExcluirRegistroLink({ tipo: "PESSOA", origemId: "p1" })).toBeNull();
  });

  it("encaminha a baixa comprovada ao título, com rótulo explícito", async () => {
    const html = renderToStaticMarkup(await ExcluirUnificadoLink({ registro: { dominio: "BAIXA_RECEBER", origem: "WIDESYS", origemId: "b1", chave: "WIDESYS:BAIXA_RECEBER:b1", tituloChave: "WIDESYS:RECEBER:t1" } }));
    expect(html).toContain("Excluir título vinculado");
    expect(html).toContain("origemId=WIDESYS%3ARECEBER%3At1");
    expect(html).not.toContain("origemId=b1");
  });

  it("não oferece uma exclusão ambígua para baixa sem título identificado", async () => {
    expect(await ExcluirUnificadoLink({ registro: { dominio: "BAIXA_RECEBER", origem: "WIDESYS", origemId: "b1", chave: "WIDESYS:BAIXA_RECEBER:b1" } })).toBeNull();
  });
});

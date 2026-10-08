import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TipoGovernanca } from "./tipos";

const mocks = vi.hoisted(() => ({
  acesso: vi.fn(), transacao: vi.fn(), usuario: vi.fn(), locatario: vi.fn(),
  estadoLer: vi.fn(), estadoGravar: vi.fn(), contar: vi.fn(), listar: vi.fn(),
  eventosListar: vi.fn(), eventoGravar: vi.fn(), revalidar: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/acesso/servidor", () => ({ exigirPermissaoAcesso: mocks.acesso }));
vi.mock("@/lib/db", () => ({ prisma: {
  $transaction: mocks.transacao,
  usuario: { findUnique: mocks.usuario }, locatario: { findUnique: mocks.locatario },
  contrato: { count: vi.fn().mockResolvedValue(3) }, boleto: { count: vi.fn().mockResolvedValue(1) },
  recursoGovernado: { findUnique: mocks.estadoLer, upsert: mocks.estadoGravar, count: mocks.contar, findMany: mocks.listar },
  eventoGovernanca: { findMany: mocks.eventosListar, create: mocks.eventoGravar },
} }));
vi.mock("@/lib/unificacao/fontes", () => ({ carregarFontesUnificacao: vi.fn(() => { throw new Error("Fluxo não deve executar reconciliação."); }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidar }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));

import { prisma } from "@/lib/db";
import { previaGovernanca } from "./servico";
import { executarGovernanca } from "@/app/(app)/cadastros/governanca/actions";
import { TelaExclusao, TelaLixeira } from "@/app/(app)/cadastros/governanca/exclusao";

let estado: Record<string, unknown> | null;
const usuario = (perfil = "ADMINISTRADOR") => ({ id: "admin-teste", perfil, ativo: true, acessoGlobal: true, permissoesExtras: '["governanca.editar"]', permissoesNegadas: "[]", papelAcesso: null, regrasAcesso: [] });
beforeEach(() => {
  vi.clearAllMocks();
  estado = null;
  mocks.acesso.mockResolvedValue({ usuarioId: "admin-teste", perfil: "ADMINISTRADOR" });
  mocks.usuario.mockResolvedValue(usuario());
  mocks.locatario.mockResolvedValue({ id: "l1", nome: "Inquilino de teste" });
  mocks.transacao.mockImplementation((fn: (db: typeof prisma) => unknown) => fn(prisma));
  mocks.estadoLer.mockImplementation(async () => estado);
  mocks.estadoGravar.mockImplementation(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
    estado = { ...(estado ?? { id: "g1" }), ...(estado ? update : create), versao: Number(estado?.versao ?? 0) + 1 };
    return estado;
  });
  mocks.contar.mockResolvedValue(0); mocks.listar.mockResolvedValue([]);
  mocks.eventosListar.mockResolvedValue([]); mocks.eventoGravar.mockResolvedValue({ id: "e1" });
});

async function formulario(extras: Record<string, string> = {}) {
  const previa = await previaGovernanca(prisma, "LOCATARIO", "l1");
  const form = new FormData();
  for (const [nome, valor] of Object.entries({ tipo: "LOCATARIO", origemId: "l1", modo: "excluir", acao: "excluir-plataforma", confirmar: "sim", cienciaExclusao: "sim", motivo: "Duplicata conferida pelo administrador", assinaturaPrevia: previa.assinatura, ...extras })) form.set(nome, valor);
  return form;
}
async function enviar(form: FormData) {
  try { await executarGovernanca(form); throw new Error("Redirect esperado"); }
  catch (erro) {
    if (!(erro instanceof Error) || !erro.message.startsWith("REDIRECT:")) throw erro;
    return new URL(erro.message.slice("REDIRECT:".length), "http://brisa.local");
  }
}

describe("confirmação de exclusão sem banco real", () => {
  it.each(["excluir", "lixeira"])("nega render %s ao financeiro mesmo com permissão extra", async modo => {
    mocks.acesso.mockResolvedValue({ usuarioId: "f1", perfil: "FINANCEIRO" });
    await expect(modo === "lixeira" ? TelaLixeira({}) : TelaExclusao({ tipo: "LOCATARIO", origemId: "l1" })).rejects.toThrow("NOT_FOUND");
    expect(mocks.transacao).not.toHaveBeenCalled();
    expect(mocks.listar).not.toHaveBeenCalled();
  });

  it("render só apresenta prévia, lixeira, motivo e ciência, sem alterar dados", async () => {
    const html = renderToStaticMarkup(await TelaExclusao({ tipo: "LOCATARIO", origemId: "l1" }));
    expect(html).toContain("/cadastros/governanca?modo=lixeira");
    expect(html).toContain('name="motivo"'); expect(html).toContain('minLength="5"');
    expect(html).toContain('name="cienciaExclusao"'); expect(html).toContain('name="assinaturaPrevia"');
    expect(html).toContain('value="excluir-plataforma"');
    expect(html).toContain("não apaga registros vinculados");
    expect(mocks.estadoGravar).not.toHaveBeenCalled(); expect(mocks.eventoGravar).not.toHaveBeenCalled();
  });

  it("escapa nome e mensagens controlados por URL em vez de interpretar HTML", async () => {
    mocks.locatario.mockResolvedValue({ id: "l1", nome: '<script>alert("nome")</script>' });
    const html = renderToStaticMarkup(await TelaExclusao({ tipo: "LOCATARIO", origemId: "l1", erro: '<img src=x onerror="alert(1)">', ok: '<script>alert("ok")</script>' }));
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain('<script>alert("nome")');
    expect(html).not.toContain("<img src=x"); expect(mocks.estadoGravar).not.toHaveBeenCalled();
  });

  it.each([["tipo-invalido", "l1"], ["LOCATARIO", "x".repeat(251)], ["LOCATARIO", ""]])("identidade inválida devolve404: %s", async (tipo, origemId) => {
    await expect(TelaExclusao({ tipo: tipo as TipoGovernanca, origemId })).rejects.toThrow("NOT_FOUND");
    expect(mocks.estadoGravar).not.toHaveBeenCalled();
  });

  it.each([
    ["confirmar", ""], ["cienciaExclusao", ""], ["assinaturaPrevia", ""],
    ["assinaturaPrevia", "f".repeat(64)], ["motivo", ""], ["motivo", "xx"], ["motivo", "x".repeat(501)],
  ])("não exclui com %s inválido", async (campo, valor) => {
    const destino = await enviar(await formulario({ [campo]: valor }));
    expect(destino.searchParams.has("erro")).toBe(true);
    expect(destino.searchParams.get("modo")).toBe("excluir");
    expect(mocks.estadoGravar).not.toHaveBeenCalled(); expect(mocks.eventoGravar).not.toHaveBeenCalled();
  });

  it("revalida administrador no serviço, mesmo com sessão/indicador forjados", async () => {
    mocks.usuario.mockResolvedValue(usuario("FINANCEIRO"));
    const destino = await enviar(await formulario());
    expect(destino.searchParams.get("erro")).toContain("Somente um administrador");
    expect(mocks.estadoGravar).not.toHaveBeenCalled();
  });

  it("exclui com vínculos somente depois de confirmar e registra auditoria", async () => {
    const destino = await enviar(await formulario());
    expect(destino.searchParams.has("ok")).toBe(true);
    expect(estado).toMatchObject({ tipo: "LOCATARIO", origemId: "l1", status: "EXCLUIDO" });
    expect(mocks.eventoGravar).toHaveBeenCalledTimes(1);
    expect(mocks.revalidar).toHaveBeenCalledWith("/", "layout");
  });

  it("restaura o overlay anterior sem desfazer mesclagem ou alterar entidades", async () => {
    estado = { id: "g1", tipo: "LOCATARIO", origemId: "l1", status: "MESCLADO", destinoId: "l2", estadoAnterior: '{"movimentos":[]}', motivo: "Mesclagem anterior", versao: 2 };
    await enviar(await formulario());
    const html = renderToStaticMarkup(await TelaExclusao({ tipo: "LOCATARIO", origemId: "l1" }));
    expect(html).toContain("Restaurar registro"); expect(html).toContain('value="restaurar"');
    expect(html).toContain("sem emitir cobranças ou disparar mensagens");
    await enviar(await formulario({ acao: "restaurar" }));
    expect(estado).toMatchObject({ status: "MESCLADO", destinoId: "l2", estadoAnterior: '{"movimentos":[]}' });
    expect(mocks.eventoGravar).toHaveBeenCalledTimes(2);
  });

  it("ciência também é obrigatória na restauração administrativa", async () => {
    await enviar(await formulario()); mocks.estadoGravar.mockClear(); mocks.eventoGravar.mockClear();
    const destino = await enviar(await formulario({ acao: "restaurar", cienciaExclusao: "" }));
    expect(destino.searchParams.has("erro")).toBe(true); expect(estado).toMatchObject({ status: "EXCLUIDO" });
    expect(mocks.estadoGravar).not.toHaveBeenCalled();
  });

  it("lixeira codifica a identidade e tolera nome histórico inválido sem ações no render", async () => {
    mocks.contar.mockResolvedValue(31);
    mocks.listar.mockResolvedValue([{ id: "g1", tipo: "LOCATARIO", origemId: "id&modo=outro", estadoAnterior: "json inválido", motivo: "Teste de preservação", atualizadoEm: new Date("2026-10-07T12:00:00Z") }]);
    const html = renderToStaticMarkup(await TelaLixeira({ pagina: "<script>" }));
    expect(html).toContain("página 1"); expect(html).toContain("origemId=id%26modo%3Doutro");
    expect(html).toContain("Conferir e restaurar"); expect(html).toContain("pagina=2");
    expect(mocks.estadoGravar).not.toHaveBeenCalled(); expect(mocks.eventoGravar).not.toHaveBeenCalled();
  });
});

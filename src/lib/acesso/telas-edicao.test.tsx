import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ acesso: vi.fn(), empreendimentos: vi.fn(), editarEmpreendimento: vi.fn(), unidades: vi.fn(), editarUnidade: vi.fn(), contarUnidades: vi.fn() }));
vi.mock("./servidor", () => ({ acessoAtual: mocks.acesso, exigirPaginaAcesso: vi.fn() }));
vi.mock("../db", () => ({ prisma: {
  empreendimento: { findMany: mocks.empreendimentos, findUnique: mocks.editarEmpreendimento },
  unidade: { findMany: mocks.unidades, findUnique: mocks.editarUnidade, count: mocks.contarUnidades },
} }));
vi.mock("../governanca/filtros", () => ({ filtroGovernanca: vi.fn().mockResolvedValue({}) }));
// O link RSC tem testes próprios; este teste verifica a política real das páginas/formulários.
vi.mock("@/components/link-governanca", () => ({ LinkGovernanca: () => null }));
vi.mock("../consultas/locacao", () => ({ TIPOS_UNIDADE: ["comercial", "residencial", "temporada"] }));
vi.mock("@/app/(app)/cadastros/actions", () => ({
  atualizarEmpreendimento: vi.fn(), criarEmpreendimento: vi.fn(), definirStatusEmpreendimento: vi.fn(),
  atualizarUnidade: vi.fn(), criarUnidade: vi.fn(), definirStatusUnidade: vi.fn(),
}));
import PaginaEmpreendimentos from "@/app/(app)/cadastros/empreendimentos/page";
import PaginaUnidades from "@/app/(app)/cadastros/unidades/page";
import { montarPolitica } from "./politica";

function conceder(permissoes: string[] = []) {
  mocks.acesso.mockResolvedValue(montarPolitica({ id: "consulta", perfil: "FINANCEIRO", ativo: true, acessoGlobal: true,
    permissoesExtras: JSON.stringify(permissoes), permissoesNegadas: "[]", regrasAcesso: [],
  }));
}
const empreendimento = { id: "emp", nome: "Edifício autorizado", ativo: true, unidades: [] };
const unidade = { id: "un", identificacao: "Sala autorizada", empreendimentoId: "emp", empreendimento, ativo: true, tipo: "comercial", contratos: [], _count: { contratos: 0 } };

describe("cadastros em modo de consulta", () => {
  beforeEach(() => {
    vi.clearAllMocks(); conceder();
    mocks.empreendimentos.mockResolvedValue([empreendimento]);
    mocks.editarEmpreendimento.mockResolvedValue(empreendimento);
    mocks.unidades.mockResolvedValue([unidade]);
    mocks.editarUnidade.mockResolvedValue(unidade);
    mocks.contarUnidades.mockResolvedValue(1);
  });

  it("empreendimentos não busca edição via URL nem exibe cadastro/status/editar", async () => {
    const html = renderToStaticMarkup(await PaginaEmpreendimentos({ searchParams: Promise.resolve({ editar: "emp" }) }));
    expect(html).toContain("Edifício autorizado");
    expect(html).toContain("Filtrar");
    expect(html).not.toContain("Novo empreendimento");
    expect(html).not.toContain("Editar empreendimento");
    expect(html).not.toContain(">Editar<");
    expect(html).not.toContain("Desativar");
    expect(mocks.editarEmpreendimento).not.toHaveBeenCalled();
  });

  it("imóveis não busca edição via URL nem exibe cadastro/status/contrato novo", async () => {
    const html = renderToStaticMarkup(await PaginaUnidades({ searchParams: Promise.resolve({ editar: "un" }) }));
    expect(html).toContain("Sala autorizada");
    expect(html).toContain("Filtrar");
    expect(html).not.toContain("Novo imóvel");
    expect(html).not.toContain("Editar imóvel");
    expect(html).not.toContain(">Editar<");
    expect(html).not.toContain("Novo contrato");
    expect(html).not.toContain("Desativar");
    expect(mocks.editarUnidade).not.toHaveBeenCalled();
  });

  it("edição explicitamente concedida mantém o formulário de imóveis", async () => {
    conceder(["cadastros.editar"]);
    const html = renderToStaticMarkup(await PaginaUnidades({ searchParams: Promise.resolve({ editar: "un" }) }));
    expect(mocks.editarUnidade).toHaveBeenCalled();
    expect(html).toContain("Editar imóvel");
    expect(html).toContain("Salvar alterações");
    expect(html).not.toContain("Novo contrato");
  });
});

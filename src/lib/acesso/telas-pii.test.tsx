import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acesso: vi.fn(), contar: vi.fn(), listar: vi.fn(), editar: vi.fn(), contrato: vi.fn(), recebimentos: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./servidor", () => ({
  acessoAtual: mocks.acesso, exigirPaginaAcesso: vi.fn(), exigirPermissaoAcesso: vi.fn(),
}));
vi.mock("../governanca/filtros", () => ({ filtroGovernanca: vi.fn().mockResolvedValue({}) }));
vi.mock("../db", () => ({ prisma: { locatario: {
  count: mocks.contar, findMany: mocks.listar, findUnique: mocks.editar,
} } }));
vi.mock("@/app/(app)/cadastros/actions", () => ({
  atualizarLocatario: vi.fn(), criarLocatario: vi.fn(),
}));
vi.mock("@/app/(app)/contratos/actions", () => ({ encerrarContrato: vi.fn() }));
// LinkGovernanca é um Server Component assíncrono com política própria.
// Este teste renderiza o DTO/HTML da página, sem transformar SSR síncrono em RSC.
vi.mock("@/components/link-governanca", () => ({ LinkGovernanca: () => null }));
vi.mock("../consultas/locacao", () => ({
  contratoDetalhe: mocks.contrato, recebimentosDoContrato: mocks.recebimentos,
  formatarDataBR: (s: string) => s || "—",
}));

import PaginaLocatarios from "@/app/(app)/cadastros/locatarios/page";
import PaginaDetalheContrato from "@/app/(app)/contratos/[id]/page";
import { montarPolitica } from "./politica";

const DOCUMENTO = "12345678901";
const CONTATO = "contato-sigiloso@example.test";
const ENDERECO = "Logradouro cadastral reservado";
const locatario = {
  id: "l-1", nome: "Nome autorizado", cpfCnpj: DOCUMENTO, contato: CONTATO,
  email: CONTATO, endereco: ENDERECO, cep: "12345678", numeroEndereco: "123",
  bairro: "Bairro", cidade: "Cidade", uf: "GO", contratos: [], _count: { contratos: 0 },
};
function conceder(permissoes: string[] = []) {
  mocks.acesso.mockResolvedValue(montarPolitica({
    id: "u-1", perfil: "FINANCEIRO", ativo: true, acessoGlobal: true,
    permissoesExtras: JSON.stringify(permissoes), permissoesNegadas: "[]", regrasAcesso: [],
  }));
}

describe("HTML de cadastros nativos respeita PII e capacidade de edição", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conceder();
    mocks.contar.mockResolvedValue(1);
    mocks.listar.mockResolvedValue([locatario]);
    mocks.editar.mockResolvedValue(locatario);
    mocks.recebimentos.mockResolvedValue([]);
    mocks.contrato.mockResolvedValue({
      id: "c-1", valorBase: 10000, iptu: 0, condominio: 0, status: "ativo",
      locatario, unidade: { identificacao: "Unidade autorizada", empreendimento: { nome: "Empreendimento" } },
      observacao: ENDERECO,
    });
  });

  it("consulta não recebe documento, contato nem formulário com ?editar=ID", async () => {
    const html = renderToStaticMarkup(await PaginaLocatarios({ searchParams: Promise.resolve({ editar: "l-1" }) }));
    expect(html).toContain("Nome autorizado");
    expect(html).toContain("Acesso restrito");
    expect(html).not.toContain(DOCUMENTO);
    expect(html).not.toContain("123.456.789-01");
    expect(html).not.toContain(CONTATO);
    expect(html).not.toContain(ENDERECO);
    expect(html).not.toContain('name="cpfCnpj"');
    expect(html).not.toContain("Vincular em contrato");
    expect(html).not.toContain(">Editar<");
    expect(mocks.editar).not.toHaveBeenCalled();
  });

  it("permissão de editar sem dados sensíveis não abre formulário cadastral", async () => {
    conceder(["cadastros.editar"]);
    const html = renderToStaticMarkup(await PaginaLocatarios({ searchParams: Promise.resolve({ editar: "l-1" }) }));
    expect(html).not.toContain(CONTATO);
    expect(html).not.toContain('name="cpfCnpj"');
    expect(mocks.editar).not.toHaveBeenCalled();
  });

  it("PII sem edição permite ler mas não altera o cadastro", async () => {
    conceder(["cadastros.sensiveis"]);
    const html = renderToStaticMarkup(await PaginaLocatarios({ searchParams: Promise.resolve({ editar: "l-1" }) }));
    expect(html).toContain(CONTATO);
    expect(html).toContain("123.456.789-01");
    expect(html).not.toContain('name="cpfCnpj"');
    expect(mocks.editar).not.toHaveBeenCalled();
  });

  it("bloqueia pesquisa indireta por documento e contato sem PII", async () => {
    await PaginaLocatarios({ searchParams: Promise.resolve({ q: DOCUMENTO }) });
    expect(mocks.contar.mock.calls[0][0].where.OR).toEqual([{ nomeNorm: { contains: DOCUMENTO } }]);
  });

  it("detalhe de contrato não vaza PII, observação nem ação de alteração", async () => {
    const html = renderToStaticMarkup(await PaginaDetalheContrato({
      params: Promise.resolve({ id: "c-1" }), searchParams: Promise.resolve({ encerrar: "1" }),
    }));
    expect(html).toContain("Nome autorizado");
    expect(html).not.toContain(DOCUMENTO);
    expect(html).not.toContain(CONTATO);
    expect(html).not.toContain(ENDERECO);
    expect(html).not.toContain("Confirmar encerramento");
    expect(html).not.toContain("/c-1/editar");
  });
});

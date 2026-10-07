import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ acesso: vi.fn() }));
vi.mock("./servidor", () => ({ acessoAtual: mocks.acesso }));
import { AcaoAutorizada, podeExibirAcao } from "@/components/acao-autorizada";
import { montarPolitica, type DadosPolitica } from "./politica";

const politica = (ajustes: Partial<DadosPolitica> = {}) => montarPolitica({
  id: "usuario", perfil: "FINANCEIRO", ativo: true, acessoGlobal: true,
  permissoesExtras: "[]", permissoesNegadas: "[]", regrasAcesso: [], ...ajustes,
});

describe("ações operacionais só são renderizadas quando autorizadas", () => {
  beforeEach(() => vi.clearAllMocks());

  it("financeiro de consulta não recebe formulário nem identificadores de edição no HTML", async () => {
    mocks.acesso.mockResolvedValue(politica());
    const elemento = await AcaoAutorizada({ permissao: "caixa.editar", children:
      <form><input name="id" value="registro-interno" readOnly /><button>Editar caixa</button></form>,
    });
    expect(elemento).toBeNull();
    expect(renderToStaticMarkup(elemento)).toBe("");
  });

  it("a concessão explícita libera os controles", async () => {
    mocks.acesso.mockResolvedValue(politica({ permissoesExtras: '["caixa.editar"]' }));
    const elemento = await AcaoAutorizada({ permissao: "caixa.editar", children: <button>Novo lançamento</button> });
    expect(renderToStaticMarkup(elemento)).toContain("Novo lançamento");
  });

  it("revogação explícita tem prioridade sobre concessão", () => {
    const acesso = politica({ permissoesExtras: '["caixa.editar"]', permissoesNegadas: '["caixa.editar"]' });
    expect(podeExibirAcao(acesso, { permissao: "caixa.editar" })).toBe(false);
  });

  it("ações que exigem duas capacidades não usam OR", () => {
    const requisitos = { permissao: ["recebimentos.editar", "pagamentos.conciliar"] as const };
    expect(podeExibirAcao(politica({ permissoesExtras: '["recebimentos.editar"]' }), requisitos)).toBe(false);
    expect(podeExibirAcao(politica({ permissoesExtras: '["recebimentos.editar","pagamentos.conciliar"]' }), requisitos)).toBe(true);
  });

  it.each([
    { acessoGlobal: false },
    { regrasAcesso: [{ tipo: "UNIDADE", recursoId: "restrita", efeito: "BLOQUEAR" }] },
    { ativo: false },
    { papelAcesso: { ativo: false, permissoes: '["caixa.editar"]' } },
  ])("abrangência limitada ou acesso inativo não exibe ações globais: %j", (ajustes) => {
    expect(podeExibirAcao(politica({ permissoesExtras: '["caixa.editar"]', ...ajustes }), { permissao: "caixa.editar" })).toBe(false);
  });

  it("preserva o gate bancário de perfil mesmo com permissão adicional", () => {
    const acesso = politica({ perfil: "OPERADOR", permissoesExtras: '["pagamentos.conciliar"]' });
    expect(podeExibirAcao(acesso, { permissao: "pagamentos.conciliar", perfis: ["ADMINISTRADOR", "FINANCEIRO"] })).toBe(false);
  });

  it("exportação depende da capacidade própria, não apenas de consultar relatório", async () => {
    mocks.acesso.mockResolvedValue(politica());
    expect(await AcaoAutorizada({ permissao: "relatorios.exportar", children: <a href="/relatorios/exportar">Exportar</a> })).toBeNull();
  });
});

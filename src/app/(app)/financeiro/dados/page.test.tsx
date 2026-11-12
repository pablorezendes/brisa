import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { montarPolitica, type DadosPolitica } from "@/lib/acesso/politica";

const mocks = vi.hoisted(() => ({ acesso: vi.fn(), pagina: vi.fn(), listar: vi.fn(), captura: vi.fn() }));
vi.mock("@/lib/acesso/servidor", () => ({ acessoAtual: mocks.acesso, exigirPaginaAcesso: mocks.pagina }));
vi.mock("@/lib/consultas/unificacao", () => ({ listarUnificados: mocks.listar }));
vi.mock("@/lib/consultas/operacao-widesys", () => ({ resumoAtalhoMigracaoWidesys: mocks.captura }));

import PaginaConferirDados from "./page";

const politica = (ajustes: Partial<DadosPolitica> = {}) => montarPolitica({
  id: "teste", perfil: "ADMINISTRADOR", ativo: true, acessoGlobal: true,
  permissoesExtras: "[]", permissoesNegadas: "[]", regrasAcesso: [], ...ajustes,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.acesso.mockResolvedValue(politica());
  mocks.listar.mockImplementation(async ({ dominio }: { dominio: string }) => ({
    resumo: { ativos: 21, quarentena: dominio === "MOVIMENTO" ? 0 : 2 },
  }));
  mocks.captura.mockResolvedValue({ capturadoEm: new Date("2026-10-07T15:00:00Z") });
});

describe("dados do Widesys", () => {
  it("mostra a captura e os atalhos para inconsistências da origem única", async () => {
    const html = renderToStaticMarkup(await PaginaConferirDados());
    expect(mocks.pagina).toHaveBeenCalledWith("/financeiro/dados");
    expect(mocks.listar).toHaveBeenCalledTimes(3);
    expect(html).toContain("07/10/2026, 12:00");
    expect(html).toContain("importados em lote");
    expect(html).toContain('href="/financeiro/migracao-widesys"');
    expect(html).toContain('href="/recebimentos?estado=QUARENTENA"');
    expect(html).toContain('href="/financeiro/contas-a-pagar?estado=QUARENTENA"');
    expect(html).not.toContain('href="/caixa?estado=QUARENTENA"');
    expect(html).not.toMatch(/Excel|estado=PENDENTE|estado=REVISAR|\/unificacao/);
  });

  it("respeita as permissões antes de consultar cada lista e renderizar links", async () => {
    mocks.acesso.mockResolvedValue(politica({ perfil: "FINANCEIRO", permissoesNegadas: '["financeiro.ver","caixa.ver","importacoes.ver"]' }));
    const html = renderToStaticMarkup(await PaginaConferirDados());
    expect(mocks.listar).not.toHaveBeenCalled();
    expect(html).not.toContain('href="');
  });

  it("indica ausência de captura e nega acesso antes de consultar", async () => {
    mocks.captura.mockResolvedValue(null);
    expect(renderToStaticMarkup(await PaginaConferirDados())).toContain("Nenhuma captura registrada");
    vi.clearAllMocks();
    mocks.pagina.mockRejectedValue(new Error("ACESSO_NEGADO"));
    await expect(PaginaConferirDados()).rejects.toThrow("ACESSO_NEGADO");
    expect(mocks.captura).not.toHaveBeenCalled();
    expect(mocks.listar).not.toHaveBeenCalled();
  });
});

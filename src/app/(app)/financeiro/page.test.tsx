import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { montarPolitica, type DadosPolitica } from "@/lib/acesso/politica";
import type { ListaUnificada } from "@/lib/unificacao/tipos";

const mocks = vi.hoisted(() => ({ acesso: vi.fn(), pagina: vi.fn(), listar: vi.fn(), mes: vi.fn() }));
vi.mock("@/lib/acesso/servidor", () => ({ acessoAtual: mocks.acesso, exigirPaginaAcesso: mocks.pagina }));
vi.mock("@/lib/consultas/unificacao", () => ({ listarUnificados: mocks.listar }));
vi.mock("@/lib/consultas/executivo", () => ({ mesPadrao: mocks.mes }));

import PaginaFinanceiro from "./page";

const politica = (ajustes: Partial<DadosPolitica> = {}) => montarPolitica({
  id: "usuario", perfil: "FINANCEIRO", ativo: true, acessoGlobal: true,
  permissoesExtras: "[]", permissoesNegadas: "[]", regrasAcesso: [], ...ajustes,
});

const resumo: ListaUnificada["resumo"] = {
  ativos: 2, pendentes: 3, vinculados: 1, quarentena: 0,
  devido: 50000, pago: 12500, aberto: 37500,
  devidoPendente: 999999, pagoPendente: 0, abertoPendente: 999999,
  entradas: 80000, saidas: 10000, vencidos: 0, valorVencido: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.acesso.mockResolvedValue(politica({ perfil: "ADMINISTRADOR" }));
  mocks.mes.mockResolvedValue("2026-09");
  mocks.listar.mockImplementation(async ({ dominio }: { dominio: string }) => ({
    resumo: { ...resumo, aberto: dominio === "PAGAR" ? 22000 : resumo.aberto },
  }));
});

describe("resumo financeiro", () => {
  it("mantém a competência e os valores aceitos sem somar pendências ou duplicar a base de locação", async () => {
    const html = renderToStaticMarkup(await PaginaFinanceiro({ searchParams: Promise.resolve({ mes: "2026-10" }) }));
    expect(mocks.pagina).toHaveBeenCalledWith("/financeiro");
    expect(mocks.listar).toHaveBeenCalledTimes(3);
    for (const dominio of ["RECEBER", "PAGAR", "MOVIMENTO"]) {
      expect(mocks.listar).toHaveBeenCalledWith({ dominio, mes: "2026-10", porPagina: 1 });
    }
    expect(mocks.mes).not.toHaveBeenCalled();
    expect(html.match(/class="kpi-valor /g)).toHaveLength(3);
    expect(html).toContain("375,00");
    expect(html).toContain("220,00");
    expect(html).toContain("700,00");
    expect(html).not.toContain("9.999,99");
    expect(html).toContain("valor-sigilo-real");
    expect(html).toContain("Pendências ficam fora dos totais");
    expect(html).toContain("inclusão não significa conferência concluída");
    expect(html).toContain('href="/financeiro/dados"');
    expect(html).toContain("Conferir dados");
    expect(html).toContain("Abra o registro");
    expect(html).toContain("Confirme a decisão");
    expect(html).toContain('href="/recebimentos?mes=2026-10"');
    expect(html).toContain('href="/financeiro/contas-a-pagar?mes=2026-10"');
    expect(html).toContain('href="/caixa?mes=2026-10"');
    expect(html).toContain('href="/paineis/cobranca?mes=2026-10"');
    expect(html).toContain('href="/financeiro?mes=2026-09"');
    expect(html).toContain('href="/financeiro?mes=2026-11"');
    expect(html).toContain("base própria");
    expect(html).not.toContain("Taxa de recebimento");
    expect(html).not.toContain("Comissões");
    expect(html).toMatch(/<details class="[^"]+">/);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it("não consulta a consolidação nem oferece conferência sem acesso a dados sensíveis", async () => {
    mocks.acesso.mockResolvedValue(politica());
    const html = renderToStaticMarkup(await PaginaFinanceiro({ searchParams: Promise.resolve({ mes: "2026-10" }) }));
    expect(mocks.listar).not.toHaveBeenCalled();
    expect(html).not.toContain("kpi-valor");
    expect(html).not.toContain('href="/financeiro/dados"');
    expect(html).not.toContain('href="/financeiro/contas-a-pagar');
    expect(html).not.toContain('href="/financeiro/migracao-widesys');
    expect(html).toContain('href="/recebimentos?mes=2026-10"');
  });

  it("respeita perfis exclusivos mesmo quando a permissão de rota foi concedida", async () => {
    mocks.acesso.mockResolvedValue(politica({ permissoesExtras: '["cadastros.sensiveis","unificacao.ver","importacoes.ver","fiscal.ver","comunicacoes.ver"]' }));
    const html = renderToStaticMarkup(await PaginaFinanceiro({ searchParams: Promise.resolve({ mes: "2026-10" }) }));
    expect(html).toContain('href="/financeiro/dados"');
    expect(html).toContain('href="/financeiro/migracao-widesys"');
    expect(html).not.toContain('href="/financeiro/importacoes"');
    expect(html).not.toContain('href="/financeiro/notas-fiscais"');
    expect(html).not.toContain('href="/financeiro/automacoes"');
  });

  it("não oferece links de caixa quando a capacidade foi revogada", async () => {
    mocks.acesso.mockResolvedValue(politica({ permissoesExtras: '["cadastros.sensiveis"]', permissoesNegadas: '["caixa.ver"]' }));
    const html = renderToStaticMarkup(await PaginaFinanceiro({ searchParams: Promise.resolve({ mes: "2026-10" }) }));
    expect(html).not.toContain('href="/caixa');
    expect(html).toContain("Saldo de entradas e saídas");
  });

  it("usa a competência padrão quando o mês é inválido", async () => {
    await PaginaFinanceiro({ searchParams: Promise.resolve({ mes: "2026-13" }) });
    expect(mocks.mes).toHaveBeenCalledOnce();
    expect(mocks.listar).toHaveBeenCalledWith({ dominio: "RECEBER", mes: "2026-09", porPagina: 1 });
  });
});

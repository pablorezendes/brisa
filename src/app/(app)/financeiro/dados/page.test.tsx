import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { montarPolitica, podeAbrirRota, type DadosPolitica } from "@/lib/acesso/politica";

const mocks = vi.hoisted(() => ({ acesso: vi.fn(), pagina: vi.fn(), organizacao: vi.fn() }));
vi.mock("@/lib/acesso/servidor", () => ({ acessoAtual: mocks.acesso, exigirPaginaAcesso: mocks.pagina }));
vi.mock("@/lib/consultas/unificacao", () => ({ organizacaoDosDados: mocks.organizacao }));

import PaginaConferirDados from "./page";

const politica = (ajustes: Partial<DadosPolitica> = {}) => montarPolitica({
  id: "teste", perfil: "ADMINISTRADOR", ativo: true, acessoGlobal: true,
  permissoesExtras: "[]", permissoesNegadas: "[]", regrasAcesso: [], ...ajustes,
});
const dados = () => ({
  dominios: [
    { dominio: "RECEBER", incluidos: 21, pendentes: 5, inconsistentes: 2, vinculados: 3, semEfeito: 1, ausentes: 4, total: 36 },
    { dominio: "PAGAR", incluidos: 8, pendentes: 3, inconsistentes: 1, vinculados: 2, semEfeito: 0, ausentes: 1, total: 15 },
    { dominio: "MOVIMENTO", incluidos: 13, pendentes: 2, inconsistentes: 0, vinculados: 1, semEfeito: 1, ausentes: 0, total: 17 },
  ],
  origens: [{ origem: "PLANILHA", quantidade: 30 }, { origem: "WIDESYS", quantidade: 20 }, { origem: "BRISA", quantidade: 18 }],
  pendentes: 10, inconsistentes: 3, excluidos: 4,
  ultimaAnalise: new Date("2026-10-09T15:00:00Z"), ultimoExcel: new Date("2026-10-08T15:00:00Z"),
  ultimoWidesys: { capturadoEm: new Date("2026-10-07T15:00:00Z"), concluidoEm: null, status: "QUARENTENA" },
  planilhas: { importados: 90, existentes: 12, pendentes: 17 },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.acesso.mockResolvedValue(politica());
  mocks.organizacao.mockResolvedValue(dados());
});

describe("central de conferência financeira", () => {
  it("prioriza as três listas, usa suas contagens reais e mantém filtros distintos", async () => {
    const html = renderToStaticMarkup(await PaginaConferirDados());
    const titulos = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map(item => item[1]);
    expect(titulos.slice(0, 3)).toEqual(["Contas a receber", "Contas a pagar", "Entradas e saídas"]);
    const contagens = [...html.matchAll(/<p class="numero-card[^>]*>(\d+)<\/p>/g)].map(item => Number(item[1]));
    expect(contagens).toEqual([7, 4, 2]);
    for (const rota of ["/recebimentos", "/financeiro/contas-a-pagar", "/caixa"]) {
      expect(html).toContain(`href="${rota}?estado=PENDENTE"`);
      expect(html).toContain(`href="${rota}?estado=REVISAR"`);
    }
    expect(html).toContain('href="/recebimentos?estado=QUARENTENA"');
    expect(html).toContain('href="/financeiro/contas-a-pagar?estado=QUARENTENA"');
    expect(html).not.toContain('href="/caixa?estado=QUARENTENA"');
    expect(html).toContain("O subtotal de duplicatas possíveis ou decisões a revisar reúne duas listas separadas");
    expect(html).not.toContain('href="/unificacao');
    expect(html).not.toContain('href="/financeiro/comissoes');
    expect(mocks.organizacao).toHaveBeenCalledTimes(1);
    expect(mocks.pagina).toHaveBeenCalledWith("/financeiro/dados");
  });

  it("orienta a revisão na janela e mantém explicações e histórico recolhidos", async () => {
    const html = renderToStaticMarkup(await PaginaConferirDados());
    expect(html).toContain("1. Escolha a lista");
    expect(html).toContain("2. Abra o registro");
    expect(html).toContain("3. Compare e confirme");
    expect(html).toContain("Em contas a pagar e receber, clique em “Revisar” para abrir os detalhes sobre a lista");
    expect(html).toContain("Nenhuma correspondência é aprovada automaticamente");
    expect([...html.matchAll(/<details(?:\s[^>]*)?>/g)]).toHaveLength(4);
    expect(html).not.toMatch(/<details[^>]*\bopen/);
    expect(html).toContain("não é uma fila líquida de pendências atuais");
    expect(html).toContain("Não some essas contagens");
    expect(html).toContain("sem sincronização em tempo real");
    expect(html).toContain("filtro “De onde veio”");
    expect(html).toContain("“Reanalisar correspondências” revisa o que já está no Brisa");
    expect(html).toContain("Não some as duas bases");
    expect(html).toContain("08/10/2026, 12:00");
    expect(html).toContain("07/10/2026, 12:00");
    expect(html).toContain("lote com inconsistências");
    expect(html).toContain('href="/financeiro"');
    expect(html).toContain("Resumo financeiro");
    expect(html).toContain('href="/cadastros/governanca?modo=lixeira"');
  });

  it("aplica a política de acesso a todos os links, inclusive resumo e ferramentas", async () => {
    const acesso = politica({ perfil: "FINANCEIRO", permissoesNegadas: '["financeiro.ver","caixa.ver","importacoes.ver","governanca.editar"]' });
    mocks.acesso.mockResolvedValue(acesso);
    const html = renderToStaticMarkup(await PaginaConferirDados());
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(item => item[1]);
    expect(hrefs.every(href => podeAbrirRota(acesso, href.split("?")[0]))).toBe(true);
    expect(hrefs).toEqual([]);
    expect(html).toContain("Seu acesso não permite abrir esta lista");
  });

  it("preserva as restrições de administrador para histórico Excel e lixeira", async () => {
    mocks.acesso.mockResolvedValue(politica({ perfil: "FINANCEIRO", permissoesExtras: '["importacoes.ver","governanca.editar"]' }));
    const html = renderToStaticMarkup(await PaginaConferirDados());
    expect(html).toContain('href="/recebimentos?estado=PENDENTE"');
    expect(html).toContain('href="/cadastros/governanca"');
    expect(html).not.toContain('href="/financeiro/importacoes?status=PENDENTE"');
    expect(html).not.toContain('href="/cadastros/governanca?modo=lixeira"');
  });

  it("uma fila vazia não declara auditoria concluída nem confunde histórico Excel com pendência atual", async () => {
    const vazio = dados();
    vazio.dominios = vazio.dominios.map(d => ({ ...d, pendentes: 0, inconsistentes: 0 }));
    vazio.pendentes = 0;
    vazio.inconsistentes = 0;
    mocks.organizacao.mockResolvedValue(vazio);
    const html = renderToStaticMarkup(await PaginaConferirDados());
    expect(html).toContain("Sem pendências detectadas nesta análise");
    expect(html).toContain("17 ocorrências pendentes");
    expect(html).not.toContain("estado=PENDENTE");
    expect(html).not.toContain("estado=REVISAR");
    expect(html).not.toContain("estado=QUARENTENA");
    expect(html).toContain('href="/recebimentos"');
    expect(html).toContain('href="/financeiro/contas-a-pagar"');
    expect(html).toContain('href="/caixa"');
    expect(html).toContain("não significa conferência manual concluída");
  });

  it("abre inconsistências quando não há duplicatas ou decisões a revisar", async () => {
    const inconsistentes = dados();
    inconsistentes.dominios = inconsistentes.dominios.map(d => ({ ...d, pendentes: 0 }));
    inconsistentes.pendentes = 0;
    mocks.organizacao.mockResolvedValue(inconsistentes);
    const html = renderToStaticMarkup(await PaginaConferirDados());
    expect(html).not.toContain("estado=PENDENTE");
    expect(html).not.toContain("estado=REVISAR");
    expect(html).toContain('href="/recebimentos?estado=QUARENTENA"');
    expect(html).toContain('href="/financeiro/contas-a-pagar?estado=QUARENTENA"');
  });

  it("nega acesso antes de consultar os dados", async () => {
    mocks.pagina.mockRejectedValue(new Error("ACESSO_NEGADO"));
    await expect(PaginaConferirDados()).rejects.toThrow("ACESSO_NEGADO");
    expect(mocks.organizacao).not.toHaveBeenCalled();
  });
});

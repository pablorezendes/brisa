import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FonteUnificacao, LinhaUnificada } from "../unificacao/tipos";

const mocks = vi.hoisted(() => ({ exigir: vi.fn(), perfil: vi.fn(), operacao: vi.fn(), historico: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("../acesso/servidor", () => ({ exigirPermissaoAcesso: mocks.exigir }));
vi.mock("../autorizacao", () => ({ perfilAtual: mocks.perfil, perfilPodeVerComissoes: (perfil: string) => perfil === "ADMINISTRADOR" }));
vi.mock("./operacao-na-requisicao", () => ({ operacaoNaRequisicao: mocks.operacao }));
vi.mock("../db", () => ({ prisma: { unificacaoDecisao: { findMany: mocks.historico } } }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEGADO"); } }));
import { detalheUnificado, listarTitulosFinanceiros, listarUnificados, resumoUnificacao } from "./unificacao";

function linha(chave: string, extra: Partial<LinhaUnificada> = {}): LinhaUnificada {
  return {
    chave, dominio: "PAGAR", origem: "BRISA", origemId: chave.split(":").at(-1)!, titulo: "Serviço comum", descricao: "Nota de serviço",
    href: null, hash: chave, qualidade: "OK", motivos: [], campos: {}, nomeNorm: "SERVICO", estado: "ATIVO", origens: ["BRISA"], fontes: [chave], versao: 1,
    candidatos: [], avisos: [], contabiliza: true, divergencias: [], competencia: "2026-10", vencimento: "2026-10-20", valor: 10000, pago: 10000, aberto: 0,
    ...extra,
  };
}
const privada = linha("BRISA:PAGAR:privada", { restrito: true, titulo: "COMISSAO_SECRETA", descricao: "DESCRICAO_SECRETA", valor: 9999999, pago: 9999999, campos: { reservado: { rotulo: "Segredo", valor: "CAMPO_SECRETO" } } });
const publica = linha("BRISA:PAGAR:publica", { candidatos: [{ chave: privada.chave, titulo: privada.titulo, descricao: privada.descricao, motivos: ["Mesmo fornecedor"] }, { chave: "BRISA:PAGAR:outra", titulo: "Outra nota", descricao: "Aberta para conferir", motivos: ["Mesmo valor"] }] });
const outra = linha("BRISA:PAGAR:outra", { titulo: "Outra nota" });
function fotografia(linhas: LinhaUnificada[], fontes: FonteUnificacao[] = linhas) {
  return { linhas, fontes: fontes.map(f => ({
    chave: f.chave, dominio: f.dominio, origem: f.origem, origemId: f.origemId, titulo: f.titulo, descricao: f.descricao,
    href: f.href, hash: f.hash, qualidade: f.qualidade, motivos: f.motivos, campos: f.campos, nomeNorm: f.nomeNorm,
    restrito: f.restrito, valor: f.valor, pago: f.pago, aberto: f.aberto, tituloChave: f.tituloChave,
  })), decisoes: [] };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.exigir.mockResolvedValue({}); mocks.perfil.mockResolvedValue("FINANCEIRO"); mocks.historico.mockResolvedValue([]);
  mocks.operacao.mockResolvedValue(fotografia([publica, privada, outra]));
});

describe("sigilo de documentos com comissão na DAL unificada", () => {
  it("retira notas restritas antes de totalizar, paginar e retornar candidatos", async () => {
    const resultado = await listarTitulosFinanceiros({ dominio: "PAGAR", porPagina: 1 });
    expect(resultado.total).toBe(2); expect(resultado.paginas).toBe(2);
    expect(resultado.resumo).toMatchObject({ devido: 20000, pago: 20000, aberto: 0 });
    expect(JSON.stringify(resultado)).not.toMatch(/SECRETA|SECRETO|privada|9999999/);
    expect(mocks.exigir).toHaveBeenCalledWith("cadastros.sensiveis", { global: true });
    expect(mocks.operacao).toHaveBeenCalledWith("PAGAR");
  });
  it("não permite localizar título oculto por filtro ou URL direta, nem consulta seu histórico", async () => {
    expect((await listarUnificados({ q: "COMISSAO_SECRETA" })).total).toBe(0);
    expect(await detalheUnificado(privada.chave)).toBeNull();
    expect(mocks.historico).not.toHaveBeenCalled();
  });
  it("omite candidatos restritos tanto na seleção inicial quanto na busca explícita", async () => {
    const detalhe = await detalheUnificado(publica.chave);
    expect(detalhe?.registro.candidatos.map(c => c.chave)).toEqual([outra.chave]);
    expect(detalhe?.candidatos.map(c => c.chave)).toEqual([outra.chave]);
    expect(detalhe?.fontes.map(f => f.chave)).toEqual([publica.chave]);
    expect(JSON.stringify(detalhe)).not.toMatch(/SECRETA|SECRETO|9999999/);
    expect((await detalheUnificado(publica.chave, "COMISSAO_SECRETA"))?.candidatos).toEqual([]);
  });
  it("esconde todo o título consolidado que referencia uma fonte restrita", async () => {
    const consolidada = linha("BRISA:PAGAR:consolidada", { fontes: ["WIDESYS:PAGAR:origem-restrita"], valor: 9876543 });
    mocks.operacao.mockResolvedValue(fotografia([publica, consolidada], [publica, { ...privada, chave: "WIDESYS:PAGAR:origem-restrita" }]));
    expect((await listarUnificados({ dominio: "PAGAR" })).itens.map(l => l.chave)).toEqual([publica.chave]);
    expect(await detalheUnificado(consolidada.chave)).toBeNull();
  });
  it("propaga o sigilo pelos vínculos independentemente da ordem das linhas", async () => {
    const intermediaria = linha("BRISA:PAGAR:intermediaria", { fontes: [privada.chave] });
    const destino = linha("BRISA:PAGAR:destino", { fontes: [intermediaria.chave] });
    const aberta = linha("BRISA:PAGAR:aberta", { candidatos: [{ chave: destino.chave, titulo: "Dado sensível ligado", descricao: "Associado", motivos: [] }] });
    mocks.operacao.mockResolvedValue(fotografia([destino, intermediaria, aberta, privada]));
    const resultado = await listarUnificados({ dominio: "PAGAR" });
    expect(resultado.itens.map(l => l.chave)).toEqual([aberta.chave]);
    expect(resultado.itens[0].candidatos).toEqual([]);
  });
  it("retira os movimentos e baixas marcados restritos dos totais e detalhes", async () => {
    const caixa = linha("BRISA:MOVIMENTO:restrito", { dominio: "MOVIMENTO", restrito: true, natureza: "SAIDA" });
    const baixa = linha("WIDESYS:BAIXA_PAGAR:restrita", { dominio: "BAIXA_PAGAR", restrito: true, tituloChave: privada.chave });
    mocks.operacao.mockResolvedValue(fotografia([publica, privada, caixa, baixa]));
    expect((await listarUnificados({ dominio: "MOVIMENTO" })).total).toBe(0);
    expect((await listarUnificados({ dominio: "BAIXA_PAGAR" })).total).toBe(0);
    expect((await resumoUnificacao()).pagar.devido).toBe(10000);
    expect(await detalheUnificado(caixa.chave)).toBeNull();
  });
  it("preserva acesso administrativo e não altera a fotografia reutilizada na requisição", async () => {
    const dados = fotografia([publica, privada, outra]);
    const original = JSON.stringify(dados);
    mocks.operacao.mockResolvedValue(dados);
    await listarTitulosFinanceiros({ dominio: "PAGAR" });
    expect(JSON.stringify(dados)).toBe(original);
    mocks.perfil.mockResolvedValue("ADMINISTRADOR");
    const listaAdmin = await listarTitulosFinanceiros({ dominio: "PAGAR" });
    expect(listaAdmin.total).toBe(3); expect(listaAdmin.resumo.devido).toBe(10019999);
    const detalhe = await detalheUnificado(privada.chave);
    expect(detalhe?.registro.titulo).toBe("COMISSAO_SECRETA");
    expect(detalhe?.fontes[0].campos.reservado.valor).toBe("CAMPO_SECRETO");
    expect((await detalheUnificado(publica.chave))?.candidatos.map(c => c.chave)).toContain(privada.chave);
  });
});

import { describe, expect, it } from "vitest";
import { carteiraIrrestrita, montarPolitica, navegacaoAcesso, permitidoRecurso, pode, podeAbrirRota, podeNavegar, type DadosPolitica } from "./politica";
const usuario = (u: Partial<DadosPolitica> = {}): DadosPolitica => ({ id: "u", perfil: "FINANCEIRO", ativo: true, acessoGlobal: false, permissoesExtras: "[]", permissoesNegadas: "[]", regrasAcesso: [], ...u });
describe("permissões e navegação", () => {
  it("fornecedores exige acesso sensível e carteira global também na navegação", () => {
    const rota = "/cadastros/fornecedores";
    const permitido = montarPolitica(usuario({ acessoGlobal: true, permissoesExtras: '["cadastros.sensiveis"]' }));
    expect(podeAbrirRota(permitido, rota)).toBe(true);
    expect(podeNavegar(navegacaoAcesso(permitido), rota)).toBe(true);
    for (const dados of [{ acessoGlobal: true }, { acessoGlobal: false, permissoesExtras: '["cadastros.sensiveis"]' }]) {
      const negado = montarPolitica(usuario(dados));
      expect(podeAbrirRota(negado, rota)).toBe(false);
      expect(podeNavegar(navegacaoAcesso(negado), rota)).toBe(false);
    }
  });
  it("organização global exige permissão de unificação, PII e carteira irrestrita", () => {
    const base = { acessoGlobal: true, permissoesExtras: '["unificacao.ver","cadastros.sensiveis"]' };
    expect(podeAbrirRota(montarPolitica(usuario(base)), "/financeiro/dados")).toBe(true);
    expect(podeAbrirRota(montarPolitica(usuario({ ...base, acessoGlobal: false })), "/financeiro/dados")).toBe(false);
    expect(podeAbrirRota(montarPolitica(usuario({ ...base, permissoesNegadas: '["cadastros.sensiveis"]' })), "/financeiro/dados")).toBe(false);
    expect(podeAbrirRota(montarPolitica(usuario({ ...base, perfil: "CONTABILIDADE" })), "/financeiro/dados")).toBe(false);
  });
  it("administrador sempre vê comissões e tem acesso integral", () => {
    const p = montarPolitica(usuario({ perfil: "ADMINISTRADOR", permissoesNegadas: '["comissoes.ver"]' }));
    expect(pode(p, "comissoes.ver")).toBe(true);
    expect(podeAbrirRota(p, "/financeiro/comissoes")).toBe(true);
  });
  it.each(["SOCIO", "CONTABILIDADE", "CONSULTA", "FINANCEIRO", "OPERADOR"])("%s nunca ganha comissões ou gestão por exceções", perfil => {
    const p = montarPolitica(usuario({ perfil, permissoesExtras: '["comissoes.ver","acessos.gerenciar","integracoes.gerenciar"]' }));
    expect(pode(p, "comissoes.ver")).toBe(false); expect(pode(p, "acessos.gerenciar")).toBe(false);
    expect(pode(p, "integracoes.gerenciar")).toBe(false);
  });
  it.each(["/integracoes", "/integracoes/sicoob"])("%s restringe configuração de conexões ao administrador no servidor e na navegação", rota => {
    const admin = montarPolitica(usuario({ perfil: "ADMINISTRADOR" }));
    expect(podeAbrirRota(admin, rota)).toBe(true);
    expect(podeNavegar(navegacaoAcesso(admin), rota)).toBe(true);
    for (const perfil of ["FINANCEIRO", "OPERADOR", "SOCIO", "CONTABILIDADE", "CONSULTA"]) {
      const p = montarPolitica(usuario({ perfil, acessoGlobal: true, permissoesExtras: '["integracoes.gerenciar"]', papelAcesso: { ativo: true, permissoes: '["integracoes.gerenciar"]' } }));
      expect(podeAbrirRota(p, rota)).toBe(false);
      expect(podeNavegar(navegacaoAcesso(p), rota)).toBe(false);
    }
  });
  it.each(["SOCIO", "CONTABILIDADE", "CONSULTA"])("%s fica na consulta mesmo global e com função editora", perfil => {
    const p = montarPolitica(usuario({ perfil, acessoGlobal: true, papelAcesso: { ativo: true, permissoes: '["carteira.ver","financeiro.ver","cadastros.editar","caixa.editar"]' } }));
    expect(pode(p, "caixa.editar")).toBe(false); expect(podeAbrirRota(p, "/financeiro")).toBe(false);
    expect(podeAbrirRota(p, "/carteira")).toBe(true); expect(podeAbrirRota(p, "/ajuda")).toBe(true);
  });
  it("função desativada, desconhecida ou usuário inativo falha fechado", () => {
    expect(montarPolitica(usuario({ papelAcesso: { ativo: false, permissoes: '["financeiro.ver"]' }, permissoesExtras: '["financeiro.ver"]' })).permissoes).toEqual([]);
    expect(montarPolitica(usuario({ perfil: "DESCONHECIDO" })).permissoes).toEqual([]);
    expect(montarPolitica(usuario({ ativo: false, perfil: "ADMINISTRADOR" })).permissoes).toEqual([]);
  });
  it("negações superam função e exceção", () => {
    const p = montarPolitica(usuario({ permissoesExtras: '["caixa.editar"]', permissoesNegadas: '["caixa.editar","financeiro.ver"]' }));
    expect(pode(p, "caixa.editar")).toBe(false); expect(pode(p, "financeiro.ver")).toBe(false);
  });
  it("perfil desconhecido não escala acesso por função ou exceção", () => {
    const p = montarPolitica(usuario({ perfil: "FINANCEIR0", acessoGlobal: true, permissoesExtras: '["caixa.editar"]', papelAcesso: { ativo: true, permissoes: '["cadastros.editar"]' } }));
    expect(p.ativo).toBe(false); expect(p.permissoes).toEqual([]);
  });
  it.each([
    { regrasAcesso: [{ tipo: "TIPO_ERRADO", efeito: "BLOQUEAR", recursoId: "A" }] },
    { regrasAcesso: [{ tipo: "UNIDADE", efeito: "BLOQUER", recursoId: "A" }] },
    { permissoesNegadas: "JSON inválido" },
    { regrasAcesso: [{ tipo: "UNIDADE", efeito: "PERMITIR", recursoId: "" }] },
  ])("configuração corrompida não libera global por acidente %#", dados => {
    expect(montarPolitica(usuario({ acessoGlobal: true, ...dados })).ativo).toBe(false);
  });
  it("somente grant específico não habilita leitura global", () => {
    const p = montarPolitica(usuario({ regrasAcesso: [{ tipo: "UNIDADE", recursoId: "A", efeito: "PERMITIR" }] }));
    expect(permitidoRecurso(p, "UNIDADE", "A")).toBe(true); expect(permitidoRecurso(p, "UNIDADE", "B")).toBe(false);
    expect(podeAbrirRota(p, "/financeiro")).toBe(false);
  });
  it("bloqueio explícito vence herança e global", () => {
    const p = montarPolitica(usuario({ acessoGlobal: true, regrasAcesso: [{ tipo: "UNIDADE", recursoId: "A", efeito: "BLOQUEAR" }] }));
    expect(permitidoRecurso(p, "UNIDADE", "A", true)).toBe(false); expect(carteiraIrrestrita(p)).toBe(false);
  });
  it("navegação não serializa regras nem IDs de carteiras", () => {
    const p = montarPolitica(usuario({ regrasAcesso: [{ tipo: "UNIDADE", recursoId: "segredo-id", efeito: "PERMITIR" }] }));
    const nav = navegacaoAcesso(p);
    expect(JSON.stringify(nav)).not.toContain("segredo-id"); expect(podeNavegar(nav, "/carteira")).toBe(true);
    expect(podeNavegar(nav, "/financeiro")).toBe(false); expect(podeAbrirRota(p, "/inventada")).toBe(false);
  });
});

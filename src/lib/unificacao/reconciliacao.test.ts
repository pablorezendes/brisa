import { describe, expect, it } from "vitest";

import { avaliarFonte, candidatosPara, projetarUnificados } from "./reconciliacao";
import type { DecisaoUnificacao, FonteUnificacao } from "./tipos";

function fonte(chave: string, alteracoes: Partial<FonteUnificacao> = {}): FonteUnificacao {
  return {
    chave, dominio: "RECEBER", origem: chave.startsWith("BRISA:") ? "BRISA" : "WIDESYS",
    origemId: chave.split(":").at(-1)!, titulo: "Registro artificial", descricao: "Teste",
    href: null, hash: `hash-${chave}`, qualidade: "OK", motivos: [], campos: {},
    nomeNorm: "REGISTRO ARTIFICIAL", ...alteracoes,
  };
}

function decisao(f: FonteUnificacao, alteracoes: Partial<DecisaoUnificacao> = {}): DecisaoUnificacao {
  return {
    chave: f.chave, dominio: f.dominio, origem: f.origem, origemId: f.origemId,
    status: "ATIVO", destinoChave: null, hashFonte: f.hash, hashDestino: null,
    candidatos: "[]", motivos: "[]", proveniencia: "{}", decisao: "AUTO", versao: 1,
    ...alteracoes,
  };
}

function vinculo(f: FonteUnificacao, alvo: FonteUnificacao): DecisaoUnificacao {
  return decisao(f, { status: "VINCULADO", destinoChave: alvo.chave, hashDestino: alvo.hash, decisao: "MANUAL" });
}

const mapa = (fontes: FonteUnificacao[]) => new Map(fontes.map(f => [f.chave, f]));

describe("reconciliação entre fontes sem duplicar a operação", () => {
  it("nativo novo fica pendente quando um título Widesys correspondente já está ativo", () => {
    const valores = { competencia: "2026-06", valor: 50000, pago: 0, aberto: 50000 };
    const legado = fonte("WIDESYS:RECEBER:anterior", valores);
    const novo = fonte("BRISA:RECEBER:novo", valores);
    const linhas = projetarUnificados([legado, novo], [decisao(legado, { decisao: "AUTOMATICA" })]);
    expect(linhas.find(l => l.chave === novo.chave)).toMatchObject({ estado: "PENDENTE", contabiliza: false });
    expect(linhas.filter(l => l.contabiliza)).toHaveLength(1);
  });

  it("recalcula candidato de nativo automático alterado antes de continuar contabilizando", () => {
    const anterior = fonte("BRISA:RECEBER:atual", { competencia: "2026-05", valor: 40000, pago: 0, aberto: 40000 });
    const legado = fonte("WIDESYS:RECEBER:existente", { competencia: "2026-06", valor: 50000, pago: 0, aberto: 50000 });
    const alterado = { ...anterior, hash: "hash-alterado", competencia: "2026-06", valor: 50000, aberto: 50000 };
    const linhas = projetarUnificados([alterado, legado], [decisao(anterior, { decisao: "AUTOMATICA" }), decisao(legado, { decisao: "AUTOMATICA" })]);
    expect(linhas.find(l => l.chave === alterado.chave)).toMatchObject({ estado: "PENDENTE", contabiliza: false });
    expect(linhas.filter(l => l.contabiliza)).toHaveLength(1);
  });

  it("um nome igual sugere comparação, mas nunca une pessoas automaticamente", () => {
    const atual = fonte("BRISA:PESSOA:1", { dominio: "PESSOA", nomeNorm: "NOME ARTIFICIAL" });
    const legado = fonte("WIDESYS:PESSOA:2", { dominio: "PESSOA", nomeNorm: "NOME ARTIFICIAL" });
    const fontes = [atual, legado];
    const candidatos = candidatosPara(legado, fontes, new Map());
    expect(candidatos).toEqual([{ chave: atual.chave, motivos: ["NOME_IGUAL"] }]);
    expect(avaliarFonte(legado, candidatos, mapa(fontes))).toMatchObject({ status: "PENDENTE", destinoChave: null });
  });

  it("movimentos com data, natureza e valor iguais permanecem como sugestão", () => {
    const valores = { dominio: "MOVIMENTO" as const, data: "2026-09-20", natureza: "SAIDA", valor: 50000 };
    const atual = fonte("BRISA:MOVIMENTO:1", valores);
    const legado = fonte("WIDESYS:MOVIMENTO:2", { ...valores, nomeNorm: "OUTRO HISTORICO" });
    const fontes = [atual, legado];
    const candidatos = candidatosPara(legado, fontes, new Map());
    expect(candidatos[0].motivos).toContain("DATA_VALOR_NATUREZA");
    expect(avaliarFonte(legado, candidatos, mapa(fontes))).toMatchObject({ status: "PENDENTE", destinoChave: null });
  });

  it("mudança na fonte invalida uma decisão manual e retira a fonte da contabilização", () => {
    const original = fonte("WIDESYS:RECEBER:1", { valor: 50000 });
    const anterior = decisao(original, { decisao: "MANUAL" });
    const alterada = { ...original, hash: "hash-novo", valor: 60000 };
    expect(avaliarFonte(alterada, [], mapa([alterada]), anterior)).toMatchObject({ status: "REVISAR" });
    expect(projetarUnificados([alterada], [anterior])[0]).toMatchObject({ estado: "REVISAR", contabiliza: false });
  });

  it("alvo ausente, alterado, em quarentena ou de domínio diferente invalida o vínculo", () => {
    const origem = fonte("WIDESYS:RECEBER:1");
    const alvo = fonte("BRISA:RECEBER:1");
    const cenarios: Array<FonteUnificacao | null> = [
      null, { ...alvo, hash: "alterado" }, { ...alvo, qualidade: "QUARENTENA" }, { ...alvo, dominio: "PESSOA" },
    ];
    for (const candidato of cenarios) {
      const fontes = candidato ? [origem, candidato] : [origem];
      const decisoes = [vinculo(origem, alvo), ...(candidato ? [decisao(candidato)] : [])];
      const projetada = projetarUnificados(fontes, decisoes).find(f => f.chave === origem.chave)!;
      expect(projetada.estado, candidato?.dominio ?? "alvo ausente").toBe("REVISAR");
      expect(projetada.contabiliza).toBe(false);
    }
  });

  it("um ciclo de vínculos não cria linha financeira ativa nem soma valores", () => {
    const a = fonte("WIDESYS:RECEBER:1", { valor: 50000 });
    const b = fonte("BRISA:RECEBER:1", { valor: 50000 });
    const linhas = projetarUnificados([a, b], [vinculo(a, b), vinculo(b, a)]);
    expect(linhas.every(l => l.estado === "REVISAR" && !l.contabiliza)).toBe(true);
    expect(linhas.every(l => l.fontes.length === 1)).toBe(true);
  });

  it("um vínculo confirmado mantém os valores da base e contabiliza o pagamento uma única vez", () => {
    const base = fonte("BRISA:RECEBER:1", { valor: 120000, pago: 40000, aberto: 80000, proveniencia: { arquivo: "planilha.xlsx" } });
    const legado = fonte("WIDESYS:RECEBER:2", { valor: 125000, pago: 45000, aberto: 80000 });
    const linhas = projetarUnificados([base, legado], [decisao(base), vinculo(legado, base)]);
    const ativas = linhas.filter(l => l.contabiliza);
    expect(ativas).toHaveLength(1);
    expect(ativas[0]).toMatchObject({ valor: 120000, pago: 40000, aberto: 80000, origens: ["PLANILHA", "WIDESYS"], fontes: [base.chave, legado.chave] });
    expect(linhas.find(l => l.chave === legado.chave)).toMatchObject({ estado: "VINCULADO", contabiliza: false });
  });

  it("complementa lacunas e papéis, mas preserva campos divergentes da base", () => {
    const base = fonte("BRISA:PESSOA:1", { dominio: "PESSOA", papeis: ["INQUILINO"], campos: { cidade: { rotulo: "Cidade", valor: "Cidade A" } } });
    const legado = fonte("WIDESYS:PESSOA:2", { dominio: "PESSOA", papeis: ["FIADOR"], campos: { cidade: { rotulo: "Cidade", valor: "Cidade B" }, telefone: { rotulo: "Telefone", valor: "CONTATO ARTIFICIAL" } } });
    const principal = projetarUnificados([base, legado], [decisao(base), vinculo(legado, base)])[0];
    expect(principal.papeis).toEqual(["INQUILINO", "FIADOR"]);
    expect(principal.campos.cidade.valor).toBe("Cidade A");
    expect(principal.campos.telefone.valor).toBe("CONTATO ARTIFICIAL");
    expect(principal.divergencias).toEqual(["Cidade"]);
  });

  it("não inventa comissão e baixas informativas não repetem o valor recebido do título", () => {
    const titulo = fonte("WIDESYS:RECEBER:1", { valor: 100000, pago: 70000, aberto: 30000 });
    const baixa = fonte("WIDESYS:BAIXA_RECEBER:2", { dominio: "BAIXA_RECEBER", valor: 70000, tituloChave: titulo.chave, informativo: true });
    const linhas = projetarUnificados([titulo, baixa], [decisao(titulo), decisao(baixa)]);
    expect(linhas.filter(l => l.contabiliza).reduce((s, l) => s + (l.pago ?? 0), 0)).toBe(70000);
    expect(linhas[1].contabiliza).toBe(false);
    expect(linhas[0].campos).not.toHaveProperty("comissao");
    expect(linhas[0]).not.toHaveProperty("comissao");
  });

  it("quarentena, ausência e cancelamento prevalecem sobre uma decisão ativa antiga", () => {
    const original = fonte("WIDESYS:RECEBER:1", { valor: 100000 });
    for (const f of [{ ...original, qualidade: "QUARENTENA" as const }, { ...original, qualidade: "AUSENTE" as const }, { ...original, cancelado: true }]) {
      expect(projetarUnificados([f], [decisao(original)])[0].contabiliza).toBe(false);
    }
  });

  it("recebíveis legados no período da planilha aguardam identidade, inclusive sobre base agregada de temporada", () => {
    const base = fonte("BRISA:RECEBER:1", { titulo: "Temporada agregada", nomeNorm: "TODOS", competencia: "2026-06", valor: 250000, proveniencia: { arquivo: "planilha.xlsx", agregado: true } });
    const legado = fonte("WIDESYS:RECEBER:2", { competencia: "2026-06", valor: 35000, nomeNorm: "COBRANCA INDIVIDUAL" });
    const fontes = [base, legado];
    const candidatos = candidatosPara(legado, fontes, new Map());
    expect(candidatos).toEqual([]);
    expect(avaliarFonte(legado, candidatos, mapa(fontes))).toMatchObject({ status: "PENDENTE", motivos: ["PERIODO_JA_EXISTE_NA_PLANILHA"] });
    const linhas = projetarUnificados(fontes, [decisao(base), decisao(legado, { status: "PENDENTE" })]);
    expect(linhas.filter(l => l.contabiliza)).toHaveLength(1);
    expect(linhas[0].valor).toBe(250000);
  });

  it("repetição integral interna marca o segundo registro para revisão sem apagar o primeiro", () => {
    const a = fonte("BRISA:RECEBER:1", { competencia: "2026-06", valor: 50000, pago: 0, data: "2026-06-05" });
    const b = fonte("BRISA:RECEBER:2", { competencia: "2026-06", valor: 50000, pago: 0, data: "2026-06-05" });
    const fontes = [a, b];
    expect(avaliarFonte(a, candidatosPara(a, fontes, new Map()), mapa(fontes)).status).toBe("ATIVO");
    expect(avaliarFonte(b, candidatosPara(b, fontes, new Map()), mapa(fontes))).toMatchObject({ status: "PENDENTE", motivos: ["POSSIVEL_DUPLICIDADE_INTERNA"] });
  });
});

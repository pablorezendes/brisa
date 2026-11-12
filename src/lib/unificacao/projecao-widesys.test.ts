import { describe, expect, it } from "vitest";
import { projetarFinanceiroWidesys } from "./projecao-widesys";
import type { DecisaoUnificacao, FonteUnificacao } from "./tipos";

function fonte(origem: FonteUnificacao["origem"], id: string, dados: Partial<FonteUnificacao> = {}): FonteUnificacao {
  return {
    chave: `${origem}:RECEBER:${id}`, origem, origemId: id, dominio: "RECEBER",
    titulo: "Locação", nomeNorm: "LOCACAO", descricao: "", href: null, hash: "atual",
    qualidade: "OK", motivos: [], campos: {}, valor: 10000, pago: 5000, aberto: 5000, ...dados,
  };
}

describe("Financeiro com origem Widesys", () => {
  it("inclui IDs diferentes e usa os dados atuais mesmo com um vínculo anterior para uma planilha", () => {
    const planilha = fonte("BRISA", "planilha", { proveniencia: { arquivo: "receitas.xlsx" }, restrito: true });
    const semOrigemComprovada = fonte("BRISA", "sem-proveniencia");
    const widesys = fonte("WIDESYS", "ws", { vencimento: "2026-10-05" });
    const outro = fonte("WIDESYS", "outro", { vencimento: "2026-10-06" });
    const antigo: DecisaoUnificacao = {
      chave: widesys.chave, dominio: widesys.dominio, origem: widesys.origem, origemId: widesys.origemId,
      destinoChave: planilha.chave, hashFonte: "antigo", hashDestino: planilha.hash,
      status: "VINCULADO", decisao: "MANUAL", versao: 1, candidatos: "[]", motivos: "[]", proveniencia: "{}",
    };
    const projecao = projetarFinanceiroWidesys([planilha, semOrigemComprovada, widesys, outro], [antigo]);
    expect(projecao.linhas.map(l => l.chave)).toEqual([widesys.chave, outro.chave]);
    expect(projecao.linhas[0]).toMatchObject({
      contabiliza: true, estado: "ATIVO", conferidoNaOrigem: true, restrito: true, candidatos: [],
      fontes: [widesys.chave], valor: widesys.valor, pago: widesys.pago, vencimento: widesys.vencimento,
    });
    expect(projecao.linhas[1]).toMatchObject({ contabiliza: true, estado: "ATIVO", conferidoPorRegra: true });
    expect(antigo).toMatchObject({ status: "VINCULADO", hashFonte: "antigo" });
  });

  it("preserva qualidade da importação, cancelamentos e registros informativos", () => {
    const linhas = projetarFinanceiroWidesys([
      fonte("WIDESYS", "invalidado", { qualidade: "QUARENTENA" }),
      fonte("WIDESYS", "ausente", { qualidade: "AUSENTE" }),
      fonte("WIDESYS", "cancelado", { cancelado: true }),
      fonte("WIDESYS", "informativo", { informativo: true }),
    ], []).linhas;
    expect(linhas.map(l => l.estado)).toEqual(["QUARENTENA", "AUSENTE", "ATIVO", "ATIVO"]);
    expect(linhas.every(l => !l.contabiliza && !l.conferidoPorRegra)).toBe(true);
  });

  it("inclui lançamentos manuais novos sem reativar registros históricos do Brisa", () => {
    const manual = fonte("BRISA", "novo", { lancamentoManual: true });
    const antigo = fonte("BRISA", "antigo", { proveniencia: { tipo: "CADASTRO_MANUAL" } });
    const widesys = fonte("WIDESYS", "externo");
    const { linhas } = projetarFinanceiroWidesys([manual, antigo, widesys], []);
    expect(linhas.map(l => l.chave)).toEqual([manual.chave, widesys.chave]);
    expect(linhas[0]).toMatchObject({ contabiliza: true, estado: "ATIVO", origens: ["MANUAL"], conferidoNaOrigem: false });
  });
});

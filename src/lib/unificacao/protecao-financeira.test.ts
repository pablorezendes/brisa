import { describe, expect, it } from "vitest";
import { impedimentoGeracaoUnificada, impedimentoRecebimentoUnificado, montarProtecaoFinanceira } from "./protecao-financeira";
import type { DecisaoUnificacao, FonteUnificacao } from "./tipos";

function fonte(chave: string, dados: Partial<FonteUnificacao> = {}): FonteUnificacao {
  const [origem, dominio, origemId] = chave.split(":");
  return {
    chave, dominio: dominio as FonteUnificacao["dominio"], origem: origem as "BRISA" | "WIDESYS", origemId,
    titulo: "Teste artificial", descricao: "Teste", href: null, nomeNorm: "TESTE ARTIFICIAL",
    hash: `hash-${chave}`, qualidade: "OK", motivos: [], campos: {}, ...dados,
  };
}
function decisao(f: FonteUnificacao, dados: Partial<DecisaoUnificacao> = {}): DecisaoUnificacao {
  return {
    chave: f.chave, dominio: f.dominio, origem: f.origem, origemId: f.origemId,
    hashFonte: f.hash, hashDestino: null, destinoChave: null,
    status: "ATIVO", decisao: "AUTOMATICA", candidatos: "[]", motivos: "[]", proveniencia: "{}", versao: 1, ...dados,
  };
}
const recebimento = fonte("BRISA:RECEBER:r");
const contrato = fonte("BRISA:CONTRATO:c");
const contratoLegado = fonte("WIDESYS:CONTRATO:cl");
const vinculoContrato = decisao(contratoLegado, { status: "VINCULADO", decisao: "MANUAL", destinoChave: contrato.chave, hashDestino: contrato.hash });

describe("proteções operacionais da unificação", () => {
  it("permite uma operação nativa nova sem exigir análise prévia inexistente", () => {
    const contexto = montarProtecaoFinanceira([recebimento, contrato], []);
    expect(impedimentoRecebimentoUnificado(contexto, "r", "EMITIR")).toBeNull();
    expect(impedimentoGeracaoUnificada(contexto, "c", "2026-06")).toBeNull();
  });

  it("um título novo semelhante ao legado não escapa da proteção por ainda não ter análise persistida", () => {
    const atual = fonte("BRISA:RECEBER:novo", { competencia: "2026-06", valor: 100000 });
    const legado = fonte("WIDESYS:RECEBER:legado", { competencia: "2026-06", valor: 100000 });
    const contexto = montarProtecaoFinanceira([atual, legado], []);
    expect(impedimentoRecebimentoUnificado(contexto, "novo", "EMITIR")).toBeTruthy();
  });

  it("uma repetição nativa recém-criada fica protegida antes da primeira análise", () => {
    const valores = { competencia: "2026-06", valor: 100000, pago: 0, data: "2026-06-05" };
    const original = fonte("BRISA:RECEBER:a", valores);
    const repetido = fonte("BRISA:RECEBER:b", valores);
    const contexto = montarProtecaoFinanceira([original, repetido], []);
    expect(impedimentoRecebimentoUnificado(contexto, "b", "EMITIR")).toBeTruthy();
  });

  it.each(["PENDENTE", "REVISAR", "QUARENTENA", "AUSENTE"])("impede emitir com decisão %s", status => {
    const contexto = montarProtecaoFinanceira([recebimento], [decisao(recebimento, { status })]);
    expect(impedimentoRecebimentoUnificado(contexto, "r", "EMITIR")).toBeTruthy();
  });

  it("sugestão financeira exige conferência e decisão explícita de distinto libera a emissão", () => {
    const legado = fonte("WIDESYS:RECEBER:rl");
    const candidatos = JSON.stringify([{ chave: legado.chave, motivos: ["MES_E_VALOR"] }]);
    const automatica = montarProtecaoFinanceira([recebimento, legado], [decisao(recebimento, { candidatos })]);
    const manual = montarProtecaoFinanceira([recebimento, legado], [decisao(recebimento, { candidatos, decisao: "MANUAL" })]);
    expect(impedimentoRecebimentoUnificado(automatica, "r", "EMITIR")).toBeTruthy();
    expect(impedimentoRecebimentoUnificado(manual, "r", "EMITIR")).toBeNull();
  });

  it.each(["EMITIR", "LIMPAR", "EXCLUIR"] as const)("protege o principal de título vinculado ao legado na operação %s", operacao => {
    const legado = fonte("WIDESYS:RECEBER:rl", { pago: 100000, aberto: 0 });
    const vinculo = decisao(legado, { status: "VINCULADO", decisao: "MANUAL", destinoChave: recebimento.chave, hashDestino: recebimento.hash });
    const contexto = montarProtecaoFinanceira([recebimento, legado], [decisao(recebimento), vinculo]);
    expect(impedimentoRecebimentoUnificado(contexto, "r", operacao)).toBeTruthy();
  });

  it("preserva auditoria de vínculos reabertos sem bloquear emissão após confirmação de distintos", () => {
    const contexto = montarProtecaoFinanceira([recebimento], [decisao(recebimento, { decisao: "MANUAL" })], [{ registroChave: "WIDESYS:RECEBER:rl", destinoChave: recebimento.chave }]);
    expect(impedimentoRecebimentoUnificado(contexto, "r", "LIMPAR")).toBeTruthy();
    expect(impedimentoRecebimentoUnificado(contexto, "r", "EXCLUIR")).toBeTruthy();
    expect(impedimentoRecebimentoUnificado(contexto, "r", "EMITIR")).toBeNull();
  });

  it("mudança após decisão manual impede emissão mesmo antes de reanalisar", () => {
    const contexto = montarProtecaoFinanceira([{ ...recebimento, hash: "alterado" }], [decisao(recebimento, { decisao: "MANUAL" })]);
    expect(impedimentoRecebimentoUnificado(contexto, "r", "EMITIR")).toBeTruthy();
  });

  it("contrato comprovado com título legado da mesma competência não gera nova cobrança, mesmo já pago", () => {
    const titulo = fonte("WIDESYS:RECEBER:t", { contratoChave: contratoLegado.chave, competencia: "2026-06", pago: 100000, aberto: 0 });
    const contexto = montarProtecaoFinanceira([contrato, contratoLegado, titulo], [decisao(contrato), vinculoContrato]);
    expect(impedimentoGeracaoUnificada(contexto, "c", "2026-06")).toBeTruthy();
    expect(impedimentoGeracaoUnificada(contexto, "c", "2026-07")).toBeNull();
  });

  it("não infere vínculo por nome, valor ou período quando o contrato não foi confirmado", () => {
    const titulo = fonte("WIDESYS:RECEBER:t", { contratoChave: contratoLegado.chave, competencia: "2026-06", valor: 100000 });
    const contexto = montarProtecaoFinanceira([contrato, contratoLegado, titulo], [decisao(contrato), decisao(contratoLegado, { status: "PENDENTE" })]);
    expect(impedimentoGeracaoUnificada(contexto, "c", "2026-06")).toBeNull();
  });

  it("só ignora um título cancelado quando a qualidade da fonte permite essa conclusão", () => {
    const cancelado = fonte("WIDESYS:RECEBER:t", { contratoChave: contratoLegado.chave, competencia: "2026-06", cancelado: true });
    const criar = (titulo: FonteUnificacao) => montarProtecaoFinanceira([contrato, contratoLegado, titulo], [decisao(contrato), vinculoContrato]);
    expect(impedimentoGeracaoUnificada(criar(cancelado), "c", "2026-06")).toBeNull();
    expect(impedimentoGeracaoUnificada(criar({ ...cancelado, qualidade: "QUARENTENA" }), "c", "2026-06")).toBeTruthy();
  });

  it("mudança no contrato vinculado exige reconferência antes da geração", () => {
    const contexto = montarProtecaoFinanceira([contrato, { ...contratoLegado, hash: "novo" }], [decisao(contrato), vinculoContrato]);
    expect(impedimentoGeracaoUnificada(contexto, "c", "2026-06")).toBeTruthy();
  });

  it("contrato Brisa vinculado a outro Brisa só gera pelo principal", () => {
    const principal = fonte("BRISA:CONTRATO:principal");
    const contexto = montarProtecaoFinanceira([contrato, principal], [decisao(principal), decisao(contrato, { status: "VINCULADO", destinoChave: principal.chave, hashDestino: principal.hash })]);
    expect(impedimentoGeracaoUnificada(contexto, "c", "2026-06")).toBeTruthy();
    expect(impedimentoGeracaoUnificada(contexto, "principal", "2026-06")).toBeNull();
  });
});

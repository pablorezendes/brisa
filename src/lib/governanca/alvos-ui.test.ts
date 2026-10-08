import { describe, expect, it } from "vitest";
import type { FonteUnificacao } from "@/lib/unificacao/tipos";
import { alvoExclusaoUnificado } from "./alvos-ui";

describe("destino da revisão de exclusão", () => {
  it.each([
    ["PESSOA", "BRISA", "LOCATARIO"], ["PESSOA", "WIDESYS", "PESSOA"],
    ["IMOVEL", "BRISA", "UNIDADE"], ["IMOVEL", "WIDESYS", "IMOVEL_LEGADO"],
    ["CONTRATO", "BRISA", "CONTRATO"], ["CONTRATO", "WIDESYS", "CONTRATO_LEGADO"],
    ["MOVIMENTO", "BRISA", "CAIXA"], ["MOVIMENTO", "WIDESYS", "MOVIMENTO_LEGADO"],
    ["PARAMETRO", "WIDESYS", "PARAMETRO"],
  ] as const)("mapeia %s de %s ao recurso de origem %s", (dominio, origem, tipo) => {
    expect(alvoExclusaoUnificado({ dominio, origem, origemId: "id-fonte", chave: `${origem}:${dominio}:id-fonte` })).toEqual({ tipo, origemId: "id-fonte" });
  });

  it.each(["RECEBER", "PAGAR"] as const)("usa a chave completa para %s", dominio => {
    expect(alvoExclusaoUnificado({ dominio, origem: "WIDESYS", origemId: "123", chave: `WIDESYS:${dominio}:123` })).toEqual({ tipo: "TITULO", origemId: `WIDESYS:${dominio}:123` });
  });

  it.each(["BAIXA_RECEBER", "BAIXA_PAGAR"] as const)("não transforma exclusão de %s em estorno", dominio => {
    const registro = { dominio, origem: "WIDESYS", origemId: "b1", chave: `WIDESYS:${dominio}:b1` } as const satisfies Partial<FonteUnificacao>;
    expect(alvoExclusaoUnificado(registro)).toBeNull();
    expect(alvoExclusaoUnificado({ ...registro, tituloChave: "WIDESYS:PAGAR:t1" })).toEqual({ tipo: "TITULO", origemId: "WIDESYS:PAGAR:t1", rotulo: "Excluir título vinculado" });
  });
});

import { describe, expect, it } from "vitest";
import { filtrarFontesGovernadas } from "./filtros";
import type { FonteUnificacao } from "../unificacao/tipos";

const fonte = (dominio: FonteUnificacao["dominio"], origem: FonteUnificacao["origem"], origemId: string, tituloChave?: string) => ({ dominio, origem, origemId, chave: `${origem}:${dominio}:${origemId}`, tituloChave }) as FonteUnificacao;
describe("exclusão explícita na projeção unificada", () => {
  it.each([
    ["PESSOA", "BRISA", "LOCATARIO"], ["PESSOA", "WIDESYS", "PESSOA"],
    ["IMOVEL", "BRISA", "UNIDADE"], ["IMOVEL", "WIDESYS", "IMOVEL_LEGADO"],
    ["CONTRATO", "BRISA", "CONTRATO"], ["CONTRATO", "WIDESYS", "CONTRATO_LEGADO"],
    ["MOVIMENTO", "BRISA", "CAIXA"], ["MOVIMENTO", "WIDESYS", "MOVIMENTO_LEGADO"],
    ["PARAMETRO", "WIDESYS", "PARAMETRO"],
  ] as const)("retira %s/%s sem reescrever origem", (dominio, origem, tipo) => {
    const f = fonte(dominio, origem, "id1"); const antes = structuredClone(f);
    expect(filtrarFontesGovernadas([f], [{ tipo, origemId: "id1", status: "EXCLUIDO" }])).toEqual([]);
    expect(f).toEqual(antes);
    expect(filtrarFontesGovernadas([f], [{ tipo, origemId: "id1", status: "ATIVO" }])).toEqual([f]);
  });
  it("retira título e detalhes de baixa, mas não outro título semelhante", () => {
    const titulo = fonte("PAGAR", "WIDESYS", "t1");
    const baixa = fonte("BAIXA_PAGAR", "WIDESYS", "b1", titulo.chave);
    const outro = fonte("PAGAR", "WIDESYS", "t2");
    expect(filtrarFontesGovernadas([titulo, baixa, outro], [{ tipo: "TITULO", origemId: titulo.chave, status: "EXCLUIDO" }])).toEqual([outro]);
  });
  it("excluir contrato não exclui cobranças em cascata", () => {
    const contrato = fonte("CONTRATO", "BRISA", "c1");
    const titulo = { ...fonte("RECEBER", "BRISA", "r1"), contratoChave: contrato.chave };
    expect(filtrarFontesGovernadas([contrato, titulo], [{ tipo: "CONTRATO", origemId: "c1", status: "EXCLUIDO" }])).toEqual([titulo]);
  });
});

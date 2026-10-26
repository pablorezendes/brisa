import { describe, expect, it } from "vitest";
import { categoriaHonorariosCorrigivel, contemComissaoRestrita, descricaoHonorariosProfissionais, historicoSemComissao } from "./sigilo";

describe("sigilo de honorários e comissões", () => {
  it.each(["Honorários", "Honorários contábeis", "HONORÁRIOS ADVOCATÍCIOS", "Honorarios de advocacia", "Administração BRISA", "Despesas administrativas"])("não presume comissão em %s", rotulo => {
    expect(contemComissaoRestrita(rotulo)).toBe(false);
  });
  it.each(["Comissão", "Comissões de locação", "Corretagem", "Taxa de administração", "taxa ADM", "Honorários de administração", "HONORARIOS ADMINISTRATIVOS", "Honorários de intermediação", "Honorários de gestão imobiliária"])("preserva sigilo de %s", rotulo => {
    expect(contemComissaoRestrita(rotulo)).toBe(true);
  });
  it("não transforma descrição contábil em autorização e não aceita comissão misturada", () => {
    expect(descricaoHonorariosProfissionais("Honorários contábeis mensais")).toBe(true);
    expect(descricaoHonorariosProfissionais("Honorários advocatícios")).toBe(true);
    expect(descricaoHonorariosProfissionais("Honorários")).toBe(false);
    expect(descricaoHonorariosProfissionais("Honorários contábeis e comissão")).toBe(false);
    expect(categoriaHonorariosCorrigivel({ codigo: "CAT_X", rotulo: "Honorários", restrita: true })).toBe(true);
    expect(categoriaHonorariosCorrigivel({ codigo: "ADMINISTRACAO_COMISSAO", rotulo: "Honorários", restrita: true })).toBe(false);
    expect(categoriaHonorariosCorrigivel({ codigo: "CAT_X", rotulo: "Honorários de administração", restrita: true })).toBe(false);
  });
  it("nega exceção quando o histórico registra comissão ou está ilegível", () => {
    expect(historicoSemComissao([null, JSON.stringify({ descricao: "Honorários contábeis", restrita: true })])).toBe(true);
    expect(historicoSemComissao([JSON.stringify({ rateios: [{ descricao: "Comissão antiga" }] })])).toBe(false);
    expect(historicoSemComissao(["registro inválido"])).toBe(false);
  });
});

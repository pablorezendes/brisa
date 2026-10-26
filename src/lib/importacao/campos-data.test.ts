import { expect, it } from "vitest";
import { buscarCampoData, ALIASES_DATA_PAGAMENTO, falsoErroTipoPagamento } from "./campos-data";
it("não confunde forma, tipo ou valor com data", () => {
  expect(buscarCampoData({ tipo_de_pagamento: ["Cartão de Crédito"], valor_pagamento: "100,00" }, ALIASES_DATA_PAGAMENTO)).toBeNull();
  expect(falsoErroTipoPagamento({ tipo_de_pagamento: "PIX" })).toBe(true);
});
it("preserva data real e também valores explícitos inválidos para validação", () => {
  for (const data of ["10-06-2027", "31-02-2027", "inválida"]) {
    expect(buscarCampoData({ data_pagamento: data, tipo_de_pagamento: "PIX" }, ALIASES_DATA_PAGAMENTO)).toBe(data);
    expect(falsoErroTipoPagamento({ data_pagamento: data, tipo_de_pagamento: "PIX" })).toBe(false);
  }
  expect(buscarCampoData({ jform_data_pagamento: "01-02-2027" }, ALIASES_DATA_PAGAMENTO)).toBe("01-02-2027");
});

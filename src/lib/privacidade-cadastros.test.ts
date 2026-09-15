import { describe, expect, it } from "vitest";

import {
  mascararEmailCadastro,
  mascararTelefoneCadastro,
  perfilPodeVerPiiCadastros,
} from "./privacidade-cadastros";

describe("privacidade dos cadastros legados", () => {
  it("libera PII somente para administração e financeiro", () => {
    expect(perfilPodeVerPiiCadastros("ADMINISTRADOR")).toBe(true);
    expect(perfilPodeVerPiiCadastros("financeiro")).toBe(true);
    expect(perfilPodeVerPiiCadastros("OPERADOR")).toBe(false);
    expect(perfilPodeVerPiiCadastros("CONSULTA")).toBe(false);
    expect(perfilPodeVerPiiCadastros("perfil-desconhecido")).toBe(false);
  });

  it("não devolve o e-mail ou o telefone integral ao mascarar", () => {
    const email = "pessoa.sensivel@empresa.com.br";
    const telefone = "(62) 99999-1234";
    const emailMascarado = mascararEmailCadastro(email);
    const telefoneMascarado = mascararTelefoneCadastro(telefone);

    expect(emailMascarado).toBe("p***@e***.br");
    expect(emailMascarado).not.toContain("pessoa.sensivel");
    expect(telefoneMascarado).toBe("***-***-1234");
    expect(telefoneMascarado).not.toContain("99999");
  });
});

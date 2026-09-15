import { describe, expect, it } from "vitest";
import {
  extractAnchors,
  extractForms,
  extractRecord,
  findLoginForm,
  isJoomlaLoginPage,
  normalizeText,
  parseTotal,
  sanitizeHtml,
} from "./widesys-parser";

describe("parser do legado Widesys", () => {
  it("localiza o formulário Joomla e nunca devolve senha ou token CSRF", () => {
    const html = `
      <form action="/administrator/index.php" method="post">
        <input name="username" value="operador-teste">
        <input type="password" name="passwd" value="segredo">
        <input type="hidden" name="0123456789abcdef0123456789abcdef" value="1">
        <input type="hidden" name="task" value="login">
      </form>`;

    const login = findLoginForm(html);
    expect(login?.action).toBe("/administrator/index.php");
    expect(login?.inputs.find((input) => input.name === "passwd")?.value).toBe("[REDACTED]");
    expect(login?.inputs.find((input) => input.name.startsWith("0123"))?.value).toBe("[REDACTED]");
    expect(JSON.stringify(extractForms(html))).not.toContain("segredo");
    expect(isJoomlaLoginPage(html)).toBe(false);
  });

  it("distingue o login real de modais de configuração com senha", () => {
    const configurationModal = `
      <form method="get"><input name="datasourceConfig[password]" type="password"></form>`;
    const login = `
      <form method="post" action="/administrator/index.php">
        <input name="username"><input name="passwd" type="password">
        <input name="option" value="com_login"><input name="task" value="login">
      </form>`;

    expect(isJoomlaLoginPage(configurationModal)).toBe(false);
    expect(isJoomlaLoginPage(login)).toBe(true);
  });

  it("extrai links, normaliza rótulos e descobre o total", () => {
    const html = `
      <a href="index.php?option=com_widesys&amp;view=pessoas">Proprietários &amp; Beneficiários</a>
      <div class="pagination">Total: 226 registros</div>`;

    expect(extractAnchors(html)).toEqual([
      expect.objectContaining({
        href: "index.php?option=com_widesys&view=pessoas",
        text: "Proprietários & Beneficiários",
      }),
    ]);
    expect(normalizeText("Proprietários & Beneficiários")).toBe("proprietarios & beneficiarios");
    expect(parseTotal(html)).toBe(226);
  });

  it("preserva campos repetíveis, selects e tabelas no registro bruto", () => {
    const html = `
      <title>Cadastro 42</title>
      <label for="nome">Nome</label><input id="nome" name="pessoa[nome]" value="Maria">
      <input name="telefone[]" value="62999990000">
      <input name="telefone[]" value="6233334444">
      <select name="tipo"><option value="PF">PF</option><option selected value="PJ">Pessoa jurídica</option></select>
      <table><thead><tr><th>Banco</th><th>Conta</th></tr></thead>
      <tbody><tr><td>Sicoob</td><td>1180-0</td></tr></tbody></table>`;

    const record = extractRecord(html);
    expect(record.title).toBe("Cadastro 42");
    expect(record.fields.filter((field) => field.name === "telefone[]")).toHaveLength(2);
    expect(record.fields.find((field) => field.name === "tipo")?.value).toEqual(["PJ"]);
    expect(record.tables).toEqual([
      { headers: ["Banco", "Conta"], rows: [["Sicoob", "1180-0"]] },
    ]);
  });

  it("remove segredos do HTML persistido", () => {
    const html = `
      <input type="password" name="senha" value="nao-gravar">
      <input type="hidden" name="abcdefabcdefabcdefabcdefabcdefab" value="1">
      <a href="?option=com_widesys&amp;abcdefabcdefabcdefabcdefabcdefab=1">Editar</a>`;
    const sanitized = sanitizeHtml(html);

    expect(sanitized).not.toContain("nao-gravar");
    expect(sanitized).not.toContain("abcdefabcdefabcdefabcdefabcdefab=1");
    expect(sanitized).toContain("[REDACTED]");
  });
});

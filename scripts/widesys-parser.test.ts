import { describe, expect, it } from "vitest";
import {
  extractAnchors,
  extractForms,
  extractOnclickUrls,
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

  it("extrai navegação literal de onclick sem executar JavaScript", () => {
    const html = `
      <a href="javascript:void(0)"
         onclick="window.location.href = 'index.php?option=com_widesys&amp;task=locacao.edit&amp;id=63'">Contrato</a>
      <button onclick="carregar('/rota/dinamica')">Ignorar</button>`;

    expect(extractOnclickUrls(html)).toEqual([
      "index.php?option=com_widesys&task=locacao.edit&id=63",
    ]);
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

  it("preserva checkbox desmarcado como falso e separa rótulo do campo do valor exibido", () => {
    const html = `
      <input type="checkbox" name="ativo" value="1">
      <input type="checkbox" name="notificar" value="1" checked>
      <input type="radio" name="perfil" value="incorreto">
      <input type="radio" name="perfil" value="correto" checked>
      <label for="situacao">Situação</label>
      <select id="situacao" name="jform[situacao]">
        <option value="1">Pendente</option><option value="2" selected>Pago</option>
      </select>`;

    const record = extractRecord(html);
    expect(record.fields.find((field) => field.name === "ativo")).toMatchObject({
      checked: false,
      displayValue: "Não",
      value: "0",
    });
    expect(record.fields.find((field) => field.name === "notificar")).toMatchObject({
      checked: true,
      value: "1",
    });
    expect(record.fields.filter((field) => field.name === "perfil")).toEqual([
      expect.objectContaining({ checked: true, value: "correto" }),
    ]);
    expect(record.fields.find((field) => field.name === "jform[situacao]")).toMatchObject({
      displayValue: "Pago",
      label: "Situação",
      selectedLabels: ["Pago"],
      value: ["2"],
    });
  });

  it("remove segredos do HTML persistido", () => {
    const html = `
      <input type="password" name="senha" value="nao-gravar">
      <input name="client_secret" value=segredo-sem-aspas>
      <textarea name="senha_certificado">segredo-textarea</textarea>
      <select name="api_token"><option selected value="segredo-option">segredo-select</option></select>
      <input type="hidden" name="abcdefabcdefabcdefabcdefabcdefab" value="1">
      <form action="?option=com_widesys&amp;token=segredo-action">
        <a href=?option=com_widesys&amp;senha=segredo-url>Editar</a>
        <a href='?access_token=ACCESSLEAK&amp;refresh_token=REFRESHLEAK'>OAuth</a>
        <span data-querystring="view=ajax&amp;csrf=segredo-query"></span>
        <div data-options="{&quot;client_secret&quot;:&quot;SUPERSECRET&quot;,&quot;page&quot;:1}"></div>
        <button onclick="location.href='?token=segredo-evento'">Abrir</button>
      </form>
      <div>token=segredo-texto access_token=ACCESS_TEXT refresh_token=REFRESH_TEXT</div>
      <table><tr><td>Senha certificado</td><td>SEGREDO_TABELA</td></tr></table>`;
    const sanitized = sanitizeHtml(html);

    for (const secret of [
      "nao-gravar",
      "segredo-sem-aspas",
      "segredo-textarea",
      "segredo-option",
      "segredo-select",
      "segredo-action",
      "segredo-url",
      "segredo-query",
      "segredo-evento",
      "segredo-texto",
      "SUPERSECRET",
      "ACCESSLEAK",
      "REFRESHLEAK",
      "ACCESS_TEXT",
      "REFRESH_TEXT",
      "SEGREDO_TABELA",
      "abcdefabcdefabcdefabcdefabcdefab=1",
    ]) {
      expect(sanitized).not.toContain(secret);
    }
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("data-options");
    expect(sanitized).toContain("[REDACTED]");
  });
});

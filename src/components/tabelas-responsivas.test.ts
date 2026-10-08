import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const raiz = join(process.cwd(), "src");

function arquivosTsx(pasta: string): string[] {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(pasta, entrada.name);
    return entrada.isDirectory() ? arquivosTsx(caminho) : /(?<!\.test)\.tsx$/.test(entrada.name) ? [caminho] : [];
  });
}

function atributo(elemento: ts.JsxOpeningElement, nome: string): string | undefined {
  const item = elemento.attributes.properties.find((valor) => ts.isJsxAttribute(valor) && valor.name.getText() === nome);
  if (!item || !ts.isJsxAttribute(item)) return undefined;
  if (!item.initializer) return "true";
  if (ts.isStringLiteral(item.initializer)) return item.initializer.text;
  if (ts.isJsxExpression(item.initializer)) {
    const expressao = item.initializer.expression;
    return expressao && ts.isTemplateExpression(expressao) ? expressao.head.text : expressao?.getText();
  }
  return undefined;
}

function tabelas() {
  const resultado: { local: string; tabela: ts.JsxElement }[] = [];
  for (const caminho of arquivosTsx(raiz)) {
    const fonte = ts.createSourceFile(caminho, readFileSync(caminho, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visitar = (no: ts.Node) => {
      if (ts.isJsxElement(no) && no.openingElement.tagName.getText() === "table" && atributo(no.openingElement, "className")?.split(/\s/).includes("tabela")) {
        resultado.push({ local: `${relative(raiz, caminho)}:${fonte.getLineAndCharacterOfPosition(no.getStart()).line + 1}`, tabela: no });
      }
      ts.forEachChild(no, visitar);
    };
    visitar(fonte);
  }
  return resultado;
}

describe("tabelas operacionais responsivas", () => {
  it("mantém todas as tabelas em uma região de rolagem própria acessível pelo teclado", () => {
    const itens = tabelas();
    expect(itens.length).toBeGreaterThan(50);
    for (const { local, tabela } of itens) {
      const pai = tabela.parent;
      expect(ts.isJsxElement(pai), local).toBe(true);
      if (!ts.isJsxElement(pai)) continue;
      const abertura = pai.openingElement;
      expect(atributo(abertura, "className"), local).toContain("overflow-x-auto");
      expect(atributo(abertura, "role"), local).toBe("region");
      expect(atributo(abertura, "aria-label"), local).toBeTruthy();
      expect(atributo(abertura, "tabIndex"), local).toBe("0");
    }
  });

  it("não impõe larguras mínimas fixas ao conjunto de colunas", () => {
    for (const { local, tabela } of tabelas()) {
      expect(atributo(tabela.openingElement, "className"), local).not.toMatch(/min-w-\[/);
    }
  });

  it("ajusta a densidade à região disponível e preserva os montantes em uma linha", () => {
    const css = readFileSync(join(raiz, "app/globals.css"), "utf8");
    expect(css).toContain("container: brisa-tabela / inline-size");
    expect(css).toContain("@container brisa-tabela (max-width: 64rem)");
    expect(css).toContain("@container brisa-tabela (max-width: 42rem)");
    expect(css).toMatch(/\.tabela \.numero-dado\s*\{[^}]*white-space: nowrap/);
    expect(css).toMatch(/\.tabela th\s*\{[^}]*white-space: normal/);
    expect(css).toMatch(/\.tabela td\s*\{[^}]*white-space: normal/);
  });

  it("troca colunas financeiras por valores rotulados em notebooks sem comprimir a identificação", () => {
    const css = readFileSync(join(raiz, "app/globals.css"), "utf8");
    expect(css).toContain("@container brisa-tabela (max-width: 60rem)");
    expect(css).toMatch(/\.tabela-financeira \.tabela-valor-separado\s*\{\s*display: none/);
    expect(css).toMatch(/\.tabela-financeira \.tabela-valores-agrupados\s*\{\s*display: table-cell/);
    expect(css).toMatch(/\.tabela-financeira[^\{]*:nth-child\(1\)\s*\{\s*min-width: 180px/);
  });
});

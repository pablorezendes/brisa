import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Inventário das telas operacionais anteriores ao RBAC: todas usam visão global.
// Carteira e gestão de acessos têm testes próprios de DAL/escopo e não substituem estas guardas.
const PAGINAS = [
  "ajuda/page.tsx",
  "cadastros/base-unificada/page.tsx",
  "cadastros/contratos-unificados/page.tsx",
  "cadastros/empreendimentos/page.tsx",
  "cadastros/imoveis-legado/page.tsx",
  "cadastros/imoveis-legado/[id]/page.tsx",
  "cadastros/locatarios/page.tsx",
  "cadastros/page.tsx",
  "cadastros/pessoas/page.tsx",
  "cadastros/pessoas/[id]/page.tsx",
  "cadastros/unidades/page.tsx",
  "caixa/ano/page.tsx",
  "caixa/novo/page.tsx",
  "caixa/page.tsx",
  "caixa/[id]/editar/page.tsx",
  "contratos/novo/page.tsx",
  "contratos/page.tsx",
  "contratos/[id]/editar/page.tsx",
  "contratos/[id]/page.tsx",
  "executivo/page.tsx",
  "financeiro/automacoes/page.tsx",
  "financeiro/boletos/page.tsx",
  "financeiro/comissoes/page.tsx",
  "financeiro/conciliacao/page.tsx",
  "financeiro/contas-a-pagar/page.tsx",
  "financeiro/contas-a-receber/page.tsx",
  "financeiro/contas-bancarias/page.tsx",
  "financeiro/importacoes/page.tsx",
  "financeiro/dados/page.tsx",
  "financeiro/importacoes/[id]/page.tsx",
  "financeiro/migracao-widesys/page.tsx",
  "financeiro/movimentacoes/page.tsx",
  "financeiro/notas-fiscais/configuracao/page.tsx",
  "financeiro/notas-fiscais/novo/page.tsx",
  "financeiro/notas-fiscais/page.tsx",
  "financeiro/notas-fiscais/[id]/page.tsx",
  "financeiro/page.tsx",
  "page.tsx",
  "paineis/caixa/page.tsx",
  "paineis/cobranca/page.tsx",
  "paineis/empreendimentos/page.tsx",
  "paineis/empreendimentos/[id]/page.tsx",
  "paineis/temporada/page.tsx",
  "recebimentos/page.tsx",
  "relatorios/comissao/page.tsx",
  "relatorios/inadimplencia/page.tsx",
  "relatorios/page.tsx",
  "relatorios/resultado/page.tsx",
  "temporada/historico/page.tsx",
  "temporada/page.tsx",
  "unificacao/page.tsx",
  "unificacao/[chave]/page.tsx"
];
const ACTIONS = [
  "cadastros/actions.ts",
  "caixa/actions.ts",
  "contratos/actions.ts",
  "financeiro/automacoes/actions.ts",
  "financeiro/boletos/actions.ts",
  "financeiro/conciliacao/actions.ts",
  "financeiro/contas-bancarias/actions.ts",
  "financeiro/notas-fiscais/actions.ts",
  "recebimentos/actions.ts",
  "temporada/actions.ts",
  "unificacao/actions.ts"
];

function ler(arquivo: string) {
  const nome = resolve(process.cwd(), "src/app/(app)", arquivo);
  return ts.createSourceFile(nome, readFileSync(nome, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function exportada(n: ts.Node): n is ts.FunctionDeclaration {
  return ts.isFunctionDeclaration(n) && Boolean(n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
}
function primeiraChamada(funcao: ts.FunctionDeclaration) {
  const primeiro = funcao.body?.statements[0];
  const expressao = primeiro && ts.isExpressionStatement(primeiro)
    ? primeiro.expression
    : primeiro && ts.isVariableStatement(primeiro) ? primeiro.declarationList.declarations[0]?.initializer : undefined;
  if (!expressao || !ts.isAwaitExpression(expressao) || !ts.isCallExpression(expressao.expression)) return null;
  return expressao.expression;
}
function validarImportacao(ast: ts.SourceFile, guarda: string) {
  return ast.statements.some(n => ts.isImportDeclaration(n)
    && ts.isStringLiteral(n.moduleSpecifier)
    && n.moduleSpecifier.text === "@/lib/acesso/servidor"
    && n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)
    && n.importClause.namedBindings.elements.some(e => e.name.text === guarda));
}
function permissaoEsperada(arquivo: string, nome: string): string {
  if (arquivo === "caixa/actions.ts" && nome === "excluirLancamento") return "governanca.editar";
  const modulo = arquivo.split("/")[0];
  const modulos: Record<string, string> = {
    cadastros: "cadastros.editar", contratos: "contratos.editar", caixa: "caixa.editar",
    temporada: "temporada.editar", recebimentos: "recebimentos.editar", unificacao: "unificacao.editar",
  };
  if (modulos[modulo]) return modulos[modulo];
  if (arquivo.includes("/conciliacao/")) return "pagamentos.conciliar";
  if (arquivo.includes("/contas-bancarias/")) return "contas.editar";
  if (arquivo.includes("/notas-fiscais/")) return "fiscal.editar";
  if (arquivo.includes("/automacoes/")) return "comunicacoes.editar";
  if (arquivo.includes("/boletos/")) {
    if (nome === "emitirBoleto") return "boletos.emitir";
    if (nome === "registrarWebhook") return "boletos.configurar";
    if (["liberarEmissaoInconclusiva", "vincularEmissaoInconclusiva"].includes(nome)) return "pagamentos.conciliar";
    return "boletos.sincronizar";
  }
  throw new Error("Action sem política no inventário: " + arquivo);
}
function validarGlobal(chamada: ts.CallExpression, ast: ts.SourceFile) {
  expect(chamada.expression.getText(ast)).toBe("exigirPermissaoAcesso");
  expect(chamada.arguments[1]?.getText(ast).replace(/\s/g, "")).toBe("{global:true}");
}

describe("cobertura de autorização das superfícies operacionais", () => {
  it.each(PAGINAS)("%s autoriza antes de consultas, parâmetros e renderização", arquivo => {
    const ast = ler(arquivo);
    expect(validarImportacao(ast, "exigirPaginaAcesso")).toBe(true);
    const pagina = ast.statements.filter(exportada).find(n => n.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword));
    expect(pagina).toBeDefined();
    const chamada = primeiraChamada(pagina!);
    expect(chamada?.expression.getText(ast)).toBe("exigirPaginaAcesso");
    const rota = "/" + arquivo.replace(/(^|\/)page\.tsx$/, "");
    expect(chamada?.arguments[0] && ts.isStringLiteral(chamada.arguments[0]) ? chamada.arguments[0].text : null).toBe(rota);
  });

  it.each(ACTIONS)("%s protege cada endpoint POST separadamente e exige carteira global", arquivo => {
    const ast = ler(arquivo);
    expect(validarImportacao(ast, "exigirPermissaoAcesso")).toBe(true);
    const funcoes = ast.statements.filter(exportada);
    expect(funcoes.length).toBeGreaterThan(0);
    for (const funcao of funcoes) {
      const chamada = primeiraChamada(funcao);
      expect(chamada, funcao.name?.text).not.toBeNull();
      validarGlobal(chamada!, ast);
      expect(ts.isStringLiteral(chamada!.arguments[0]) ? chamada!.arguments[0].text : null).toBe(permissaoEsperada(arquivo, funcao.name!.text));
    }
  });

  it("exportação autoriza independentemente de layout e consulta", () => {
    const ast = ler("relatorios/exportar/route.ts");
    const get = ast.statements.filter(exportada).find(n => n.name?.text === "GET")!;
    const chamada = primeiraChamada(get)!;
    expect(validarImportacao(ast, "exigirPermissaoAcesso")).toBe(true);
    validarGlobal(chamada, ast);
    expect(chamada.arguments[0].getText(ast)).toBe('"relatorios.exportar"');
  });
});


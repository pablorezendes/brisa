import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuscaCard, Dinheiro, Kpi, PageHeader, SeletorMes } from "./ui";

const ler = (arquivo: string) => readFileSync(path.join(process.cwd(), arquivo), "utf8");

describe("layout compartilhado", () => {
  it("deixa o cabeçalho quebrar linha sem encolher o título ou cortar ações", () => {
    const html = renderToStaticMarkup(<PageHeader titulo="Cobranças em atraso" acoes={<button>Nova cobrança</button>} />);
    expect(html).toContain("flex-wrap items-end justify-between");
    expect(html).toContain("flex-[1_1_22rem]");
    expect(html).toContain("max-w-full flex-wrap items-center");
    expect(html).toContain("Nova cobrança");
  });

  it("preserva valor completo e sigilo em card com número grande", () => {
    const html = renderToStaticMarkup(<Kpi rotulo="Saldo total" valor={<Dinheiro centavos={123456789012} />} nivel="atencao" selo="Precisa da sua atenção" />);
    expect(html).toContain("1.234.567.890,12");
    expect(html).toContain("kpi-valor");
    expect(html).toContain("valor-sigilo-real");
    expect(html).toContain("flex-wrap items-start");
    expect(ler("src/app/globals.css")).toMatch(/\.kpi-valor\s*\{[^}]*overflow-wrap: anywhere;[^}]*white-space: normal;/);
  });

  it("busca cabe em telas pequenas e mantém filtros GET", () => {
    const html = renderToStaticMarkup(<BuscaCard base="/caixa" campo="q" ocultos={{ mes: "2026-10" }} />);
    expect(html).toContain("max-w-full flex-wrap");
    expect(html).toContain('name="mes" value="2026-10"');
    expect(html).toContain('method="get"');
  });

  it("a navegação existente aceita outubro e preserva os demais filtros", () => {
    const html = renderToStaticMarkup(<SeletorMes base="/caixa" mes="2026-10" extras={{ visao: "livro" }} />);
    expect(html).toContain("mes=2026-09");
    expect(html).toContain("mes=2026-11");
    expect(html).toContain("visao=livro");
    expect(html).toContain("OUT");
  });
});

describe("tabelas sem recorte de ações", () => {
  const telas = [
    "src/components/operacao-unificada.tsx",
    "src/app/(app)/financeiro/contas-bancarias/page.tsx",
    "src/app/(app)/financeiro/boletos/page.tsx",
    "src/app/(app)/financeiro/conciliacao/page.tsx",
    "src/app/(app)/financeiro/importacoes/page.tsx",
    "src/app/(app)/financeiro/notas-fiscais/page.tsx",
    "src/app/(app)/cadastros/empreendimentos/page.tsx",
    "src/app/(app)/cadastros/locatarios/page.tsx",
    "src/app/(app)/cadastros/unidades/page.tsx",
    "src/app/(app)/cadastros/pessoas/page.tsx",
    "src/app/(app)/cadastros/imoveis-legado/page.tsx",
    "src/app/(app)/caixa/page.tsx",
    "src/app/(app)/recebimentos/page.tsx",
    "src/app/(app)/contratos/page.tsx",
    "src/app/(app)/temporada/page.tsx",
    "src/app/(app)/unificacao/[chave]/page.tsx",
  ];

  it.each(telas)("%s mantém ações fixas e scroll acessível por teclado", (arquivo) => {
    const codigo = ler(arquivo);
    expect(codigo).toContain("tabela tabela--acoes");
    expect(codigo).toContain('role="region"');
    expect(codigo).toContain("tabIndex={0}");
  });

  it("a Visão geral contém o scroll na própria tabela, sem fixar a coluna de valor", () => {
    const codigo = ler("src/app/(app)/page.tsx");
    expect(codigo.match(/tabela-scroll overflow-x-auto/g)).toHaveLength(2);
    expect(codigo).not.toContain("tabela--acoes");
  });

  it("regras sticky não atingem totais ou mensagens com colspan", () => {
    const css = ler("src/app/globals.css");
    expect(css).toMatch(/\.tabela--acoes[^{}]*:last-child:not\(\[colspan\]\)\s*\{[^}]*position: sticky;[^}]*right: 0;/);
    expect(css).toMatch(/\.app-content[^{}]*:has\(> \.tabela\)\s*\{[^}]*width: 100%;[^}]*overflow: auto;/);
    expect(css).toContain("@media print");
  });

  it("configuração de conta não reserva 310px quando fechada", () => {
    const codigo = ler("src/app/(app)/financeiro/contas-bancarias/page.tsx");
    expect(codigo).not.toContain("min-w-[310px]");
    expect(codigo).not.toContain("w-[330px]");
    expect(codigo).toContain("tabela-configuracao-conta");
    expect(ler("src/app/globals.css")).toContain(".tabela-configuracao-conta[open]");
  });

  it("emissão mantém os campos no mesmo formulário lógico e uma célula própria de ação", () => {
    const codigo = ler("src/app/(app)/financeiro/boletos/page.tsx");
    expect(codigo).not.toContain("colSpan={podeEmitir ? 3 : 1}");
    expect(codigo.match(/form=\{`emitir-\$\{recebimento.id\}`\}/g)).toHaveLength(2);
    expect(codigo).toContain("id={`emitir-${recebimento.id}`} action={emitirBoleto}");
  });
});

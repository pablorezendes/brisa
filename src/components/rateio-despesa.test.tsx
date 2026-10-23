import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DespesaEditor } from "@/lib/despesas/tipos";

const mocks = vi.hoisted(() => ({ salvar: vi.fn(), carregar: vi.fn(), buscar: vi.fn(), visiveis: false }));
vi.mock("@/app/(app)/financeiro/contas-a-pagar/rateio-actions", () => ({ salvarRateioDespesa: mocks.salvar, carregarRateioDespesa: mocks.carregar, procurarPagamentoDespesa: mocks.buscar }));
vi.mock("@/components/botao-sigilo", () => ({ BotaoSigilo: () => <button>Ver valores</button>, useValoresVisiveis: () => mocks.visiveis }));
import { FormularioRateioDespesa, RateioDespesaModal, ResumoRateio } from "./rateio-despesa-modal";
import { RateioDespesaBotao } from "./rateio-despesa-botao";

const editor: DespesaEditor = {
  documento: { origemChave: null, origemHash: null, fonteAlterada: false, versao: 0, fornecedorNome: "Fornecedor teste", fornecedorDocumento: null, numero: "99", serie: null, tomadorNome: null, tomadorDocumento: null, emissao: "2026-10-23", competencia: "2026-10", vencimento: null, total: 10000, statusRateio: "RASCUNHO", rateios: [{ empreendimentoId: "e1", unidadeId: null, descricao: "Serviço de teste", categoria: null, valor: 10000 }] },
  pagamento: { origem: "NENHUM", valor: 0, data: null, lancamentoCaixaId: null, situacao: "EM_ABERTO", ativo: true },
  empreendimentos: [{ id: "e1", nome: "Empreendimento teste", unidades: [{ id: "u1", identificacao: "Unidade teste" }] }], contas: [], permitePagamento: true, anexos: [],
};
function formulario(inicial = editor) { return renderToStaticMarkup(<FormularioRateioDespesa inicial={inicial} aoOcupar={vi.fn()} aoAlterar={vi.fn()} aoFechar={vi.fn()} />); }
beforeEach(() => { vi.clearAllMocks(); mocks.visiveis = false; });

describe("rateio manual na própria tela", () => {
  it("botões não navegam nem carregam documentos enquanto fechados", () => {
    expect(renderToStaticMarkup(<RateioDespesaBotao />)).toContain("Nova despesa com rateio");
    const html = renderToStaticMarkup(<RateioDespesaBotao origemChave="WIDESYS:PAGAR:t1" compacto />);
    expect(html).toContain("Ratear despesa"); expect(html).not.toContain("href=");
    expect(mocks.carregar).not.toHaveBeenCalled(); expect(mocks.salvar).not.toHaveBeenCalled();
  });
  it("modal inicia imediato com dialog acessível sem depender da lista inteira", () => {
    const html = renderToStaticMarkup(<RateioDespesaModal selecao={{}} aoFechar={vi.fn()} />);
    expect(html).toContain("<dialog"); expect(html).toContain("aria-labelledby=");
    expect(html).toContain('class="janela-financeira text-left"');
    expect(html).toContain("Carregando somente esta despesa"); expect(html).toContain("Ver valores");
  });
  it("campos de dinheiro permanecem protegidos até revelar a preferência global", () => {
    const html = formulario();
    expect(html.match(/type="password"/g)).toHaveLength(2);
    expect(html).toContain("readOnly");
    expect(html).toContain("Os valores estão ocultos");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Salvar e concluir conferência<\/button>/);
    expect(html).toContain('class="sigilo"');
  });
  it("mostra nota única, rateio manual e opções de pagamento sem efetuar operação", () => {
    mocks.visiveis = true;
    const html = formulario();
    expect(html).not.toContain('type="password"');
    expect(html).toContain("Adicionar empreendimento ou serviço");
    expect(html).toContain("Salvar rascunho");
    expect(html).toContain("Já está no caixa");
    expect(html).toContain("Vincular uma saída existente, sem repetir");
    expect(html).toContain("CPF/CNPJ do fornecedor para proteção adicional");
    expect(html).toContain("Salve a despesa primeiro para anexar");
    expect(mocks.salvar).not.toHaveBeenCalled(); expect(mocks.buscar).not.toHaveBeenCalled();
  });
  it("origem Widesys não oferece segundo pagamento e permite completar metadados", () => {
    mocks.visiveis = true;
    const html = formulario({ ...editor, documento: { ...editor.documento, origemChave: "WIDESYS:PAGAR:t1", numero: "", emissao: "" }, pagamento: { ...editor.pagamento, origem: "WIDESYS", valor: 10000, situacao: "PAGO" }, permitePagamento: false });
    expect(html).toContain("pode completar os dados locais");
    expect(html).toContain("Pagamento preservado da origem Widesys");
    expect(html).not.toContain('name="modoPagamento"');
    expect(html).toMatch(/Total da nota \(R\$\)<input[^>]*readOnly/);
    expect(html).not.toMatch(/Número da nota<input[^>]*readOnly/);
  });
  it("saída vinculada fica somente leitura e não pode ser registrada novamente", () => {
    const html = formulario({ ...editor, pagamento: { ...editor.pagamento, origem: "CAIXA", lancamentoCaixaId: "cx1", valor: 10000, situacao: "PAGO" }, permitePagamento: false });
    expect(html).toContain("Saída já vinculada no caixa");
    expect(html).not.toContain('name="modoPagamento"');
    expect(html).toContain("não registra outro pagamento");
  });
  it("confirma atualização da fonte e não expõe documentos na carteira", () => {
    const html = formulario({ ...editor, documento: { ...editor.documento, id: "d1", fonteAlterada: true }, anexos: [{ id: "a1", nomeOriginal: "nota.pdf", mimeType: "application/pdf", tamanho: 1024 }] });
    expect(html).toContain("A origem foi atualizada");
    expect(html).toContain("Os anexos não são compartilhados");
    expect(html).toContain("anexos?id=a1");
    expect(html).not.toContain("/public/");
  });
  it("resumo mostra excesso sem sugerir ajuste automático", () => {
    const html = renderToStaticMarkup(<ResumoRateio total="100,00" linhas={[{ valor: "100,01" }]} />);
    expect(html).toContain("Acima do total");
    expect(html).toContain("você pode salvar um rascunho");
    expect(html).not.toContain("Dividir igualmente");
  });
});

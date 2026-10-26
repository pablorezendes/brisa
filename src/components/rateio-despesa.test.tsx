import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DespesaEditor } from "@/lib/despesas/tipos";

const mocks = vi.hoisted(() => ({ salvar: vi.fn(), carregar: vi.fn(), buscar: vi.fn(), visiveis: false }));
vi.mock("@/app/(app)/financeiro/contas-a-pagar/rateio-actions", () => ({ salvarRateioDespesa: mocks.salvar, carregarRateioDespesa: mocks.carregar, procurarPagamentoDespesa: mocks.buscar }));
vi.mock("@/app/(app)/financeiro/contas-a-pagar/categorias-actions", () => ({ carregarCategoriasDespesas: vi.fn(), gravarCategoriaDespesa: vi.fn() }));
vi.mock("@/app/(app)/cadastros/fornecedores/actions", () => ({ pesquisarFornecedores: vi.fn(), salvarCadastroFornecedor: vi.fn(), usarPessoaComoFornecedor: vi.fn() }));
vi.mock("@/components/botao-sigilo", () => ({ BotaoSigilo: () => <button>Ver valores</button>, useValoresVisiveis: () => mocks.visiveis }));
import { FormularioRateioDespesa, RateioDespesaModal, ResumoRateio } from "./rateio-despesa-modal";
import { RateioDespesaBotao } from "./rateio-despesa-botao";

const editor: DespesaEditor = {
  documento: { origemChave: null, origemHash: null, fonteAlterada: false, versao: 0, fornecedorNome: "Fornecedor teste", fornecedorDocumento: null, numero: "99", serie: null, tomadorNome: null, tomadorDocumento: null, emissao: "2026-10-23", competencia: "2026-10", vencimento: null, total: 10000, statusRateio: "RASCUNHO", categoriaCodigo: null, descricao: null, tipoDocumento: "NOTA_FISCAL", destinoCusto: "EMPREENDIMENTOS", rateios: [{ empreendimentoId: "e1", unidadeId: null, descricao: "Serviço de teste", categoria: null, valor: 6000 }, { empreendimentoId: "e1", unidadeId: null, descricao: "Outro serviço", categoria: null, valor: 4000 }] },
  pagamento: { origem: "NENHUM", valor: 0, data: null, lancamentoCaixaId: null, situacao: "EM_ABERTO", ativo: true },
  empreendimentos: [{ id: "e1", nome: "Empreendimento teste", unidades: [{ id: "u1", identificacao: "Unidade teste" }] }], contas: [], permitePagamento: true, anexos: [], categorias: [{ codigo: "PROGRAMA_WIDESYS", rotulo: "Programa Widesys", restrita: false }, { codigo: "IMPOSTOS", rotulo: "Impostos", restrita: false }],
};
function formulario(inicial = editor) { return renderToStaticMarkup(<FormularioRateioDespesa inicial={inicial} aoOcupar={vi.fn()} aoAlterar={vi.fn()} aoFechar={vi.fn()} />); }
beforeEach(() => { vi.clearAllMocks(); mocks.visiveis = false; });

describe("rateio manual na própria tela", () => {
  it("botões não navegam nem carregam documentos enquanto fechados", () => {
    expect(renderToStaticMarkup(<RateioDespesaBotao />)).toContain("Nova despesa");
    const html = renderToStaticMarkup(<RateioDespesaBotao origemChave="WIDESYS:PAGAR:t1" compacto />);
    expect(html).toContain("Organizar despesa"); expect(html).not.toContain("href=");
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
    expect(html.match(/type="password"/g)).toHaveLength(3);
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
    expect(html).toContain("Situação do pagamento preservada do Widesys");
    expect(html).not.toContain('name="modoPagamento"');
    expect(html).toMatch(/Valor total \(R\$\)<input[^>]*readOnly/);
    expect(html).not.toMatch(/Número do documento<input[^>]*readOnly/);
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
  it("despesa administrativa dispensa nota e rateio, mantendo a escolha de pagamento", () => {
    mocks.visiveis = true;
    const html = formulario({ ...editor, documento: { ...editor.documento, destinoCusto: "ADMINISTRADORA", tipoDocumento: "SEM_DOCUMENTO", categoriaCodigo: "PROGRAMA_WIDESYS", descricao: "Mensalidade de outubro", numero: "", emissao: "", rateios: [] } });
    expect(html).toContain("O que será pago?");
    expect(html).toContain("Quem assume o custo?");
    expect(html).toContain("Já foi pago?");
    expect(html).toContain("Adicionar documento (opcional)");
    expect(html).not.toContain("Número do documento");
    expect(html).not.toContain("CPF/CNPJ do tomador");
    expect(html).not.toContain("Adicionar empreendimento ou serviço");
    expect(html).not.toContain("Falta distribuir");
    expect(html).toContain("sem distribuir custos para imóveis ou empreendimentos");
    expect(html).toContain("Já está no caixa");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Salvar e concluir conferência<\/button>/);
    expect(html).not.toContain("Administração/comissão");
    expect(mocks.salvar).not.toHaveBeenCalled();
  });
  it("um empreendimento usa todo o valor e não pede digitação do rateio", () => {
    mocks.visiveis = true;
    const html = formulario({ ...editor, documento: { ...editor.documento, descricao: "Despesa do prédio", rateios: [{ empreendimentoId: "e1", unidadeId: "u1", descricao: "Despesa do prédio", categoria: null, valor: 10000 }] } });
    expect(html).toContain("Todo o valor será atribuído a esse empreendimento");
    expect(html).toContain("Unidade teste");
    expect(html).not.toContain("Valor deste serviço");
    expect(html).not.toContain("Falta distribuir");
  });
  it("destaca comissão somente quando a categoria é autorizada pelo servidor", () => {
    const html = formulario({ ...editor, documento: { ...editor.documento, destinoCusto: "ADMINISTRADORA", tipoDocumento: "SEM_DOCUMENTO", categoriaCodigo: "ADMINISTRACAO_COMISSAO", descricao: "Despesa reservada", rateios: [] }, categorias: [{ codigo: "ADMINISTRACAO_COMISSAO", rotulo: "Administração/comissão", restrita: true }] });
    expect(html).toContain("esta despesa e seus anexos são restritos ao administrador");
  });
  it("preserva documento legado de tipo não comprovado sem exigir número ou emissão de nota", () => {
    const html = formulario({ ...editor, documento: { ...editor.documento, origemChave: "WIDESYS:PAGAR:t1", tipoDocumento: "OUTRO", numero: "REF-99", emissao: "", categoriaCodigo: "IMPOSTOS", descricao: "Guia importada" } });
    expect(html).toContain("Outro documento");
    expect(html).toContain("REF-99");
    expect(html).toMatch(/Número do documento \(opcional\)<input(?![^>]*required)/);
    expect(html).toMatch(/Emissão \(opcional\)<input(?![^>]*required)/);
    expect(html).not.toContain("Tomador na nota");
  });
  it("cadastro rápido de categoria só aparece para acesso autorizado", () => {
    expect(formulario()).not.toContain("+ Nova categoria");
    const html = formulario({ ...editor, gerenciaCategorias: true });
    expect(html).toContain("+ Nova categoria");
    expect(html).toContain('aria-expanded="false"');
    expect(mocks.salvar).not.toHaveBeenCalled();
  });
  it("mantém a categoria inativa usada na despesa, mas não oferece outras inativas", () => {
    const html = formulario({ ...editor, documento: { ...editor.documento, categoriaCodigo: "IMPOSTOS" }, categorias: [...editor.categorias.map(item => ({ ...item, ativa: item.codigo !== "IMPOSTOS" })), { codigo: "ANTIGA", rotulo: "Categoria antiga indisponível", ativa: false, restrita: false }] });
    expect(html).toContain("Impostos · inativa (já vinculada)");
    expect(html).toContain("Você pode mantê-la nesta despesa");
    expect(html).not.toContain("Categoria antiga indisponível");
  });
  it("permite selecionar fornecedor já cadastrado e abrir cadastro rápido sem sair da despesa", () => {
    const html = formulario({ ...editor, permiteCadastrarFornecedor: true });
    expect(html).toContain("Buscar fornecedor por nome ou CPF/CNPJ");
    expect(html).toContain("+ Novo fornecedor");
    expect(html).toContain("Gerenciar fornecedores");
    expect(html.match(/CPF\/CNPJ do fornecedor<input/g)).toHaveLength(1);
    const vinculado = formulario({ ...editor, documento: { ...editor.documento, fornecedorPessoaId: "pessoa-1" } });
    expect(vinculado).toContain("Cadastro vinculado");
    expect(vinculado).toContain("Trocar fornecedor");
    expect(vinculado).not.toContain("+ Novo fornecedor");
  });
});

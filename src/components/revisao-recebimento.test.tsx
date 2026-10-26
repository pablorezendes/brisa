import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RevisaoFinanceira } from "@/lib/unificacao/tipos-revisao-financeira";

const mocks = vi.hoisted(() => ({ carregar: vi.fn(), confirmar: vi.fn(), visiveis: true }));
vi.mock("@/app/(app)/financeiro/contas-a-pagar/rateio-actions", () => ({ carregarRevisaoDespesa: vi.fn(), confirmarRevisaoDespesa: vi.fn() }));
vi.mock("@/app/(app)/recebimentos/revisao-actions", () => ({ carregarRevisaoRecebimento: mocks.carregar, confirmarRevisaoRecebimento: mocks.confirmar }));
vi.mock("@/components/botao-sigilo", () => ({ BotaoSigilo: () => <button>Ver valores</button>, useValoresVisiveis: () => mocks.visiveis }));
import { ConteudoRevisaoFinanceira } from "./revisao-despesa";
import { ProvedorRevisaoRecebimento, RevisaoRecebimentoBotao } from "./revisao-recebimento-botao";
import { RevisaoRecebimentoModal } from "./revisao-recebimento-modal";

const revisao: RevisaoFinanceira = {
  chave: "WIDESYS:RECEBER:t1", dominio: "RECEBER", conferidoManualmente: false, estado: "PENDENTE", pendente: true, podeConcluir: true, incluidoNosTotais: false, candidatosIndisponiveis: 0, motivo: "Compare os dados antes de confirmar.", versao: 1, hashFonte: "fonte", assinatura: "comparacao",
  registro: { chave: "WIDESYS:RECEBER:t1", hash: "fonte", titulo: "Locatário de teste", descricao: "Aluguel de outubro", origem: "WIDESYS", competencia: "2026-10", data: "2026-10-10", valor: 100000, pago: 50000, aberto: 50000 },
  candidatos: [{ chave: "BRISA:RECEBER:r1", hash: "destino", titulo: "Locatário de teste", descricao: "Aluguel de outubro", origem: "BRISA", competencia: "2026-10", data: "2026-10-10", valor: 100000, pago: 50000, aberto: 50000 }],
};
function render(dados = revisao) { return renderToStaticMarkup(<ConteudoRevisaoFinanceira revisao={dados} alterado={false} bloqueado={false} aoConfirmar={mocks.confirmar} />); }
beforeEach(() => { vi.clearAllMocks(); mocks.visiveis = true; });

describe("revisão de contas a receber na própria lista", () => {
  it("abre por botão e identifica conferido sem navegar nem disparar leitura enquanto fechado", () => {
    const html = renderToStaticMarkup(<ProvedorRevisaoRecebimento><RevisaoRecebimentoBotao chave={revisao.chave} /></ProvedorRevisaoRecebimento>);
    expect(html).toContain(">Conferir</button>");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("href=");
    expect(renderToStaticMarkup(<RevisaoRecebimentoBotao chave={revisao.chave} conferido />)).toContain(">Conferido</button>");
    expect(mocks.carregar).not.toHaveBeenCalled();
    expect(mocks.confirmar).not.toHaveBeenCalled();
  });
  it("modal consulta apenas o título selecionado e não oferece criação de despesa ou pagamento", () => {
    const html = renderToStaticMarkup(<RevisaoRecebimentoModal chave={revisao.chave} aoFechar={vi.fn()} />);
    expect(html).toContain("<dialog");
    expect(html).toContain("Conferir conta a receber");
    expect(html).toContain("não cria outra cobrança nem registra um novo recebimento");
    expect(html).toContain("Consultando a situação financeira deste lançamento");
    expect(html).not.toContain("Salvar dados da despesa");
    expect(html).not.toContain("Registrar pagamento");
  });
  it("usa valores recebidos e decisão explícita sem converter a revisão em novo lançamento", () => {
    const html = render();
    expect(html).toContain("Este título");
    expect(html).toContain(">Recebido</dt>");
    expect(html).not.toContain("Esta despesa");
    expect(html).toContain("Mesmo lançamento");
    expect(html).toContain("São lançamentos diferentes");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirmar decisão e concluir<\/button>/);
    expect(mocks.confirmar).not.toHaveBeenCalled();
  });
  it("ativo automático continua conferível e conferido manual fica somente leitura", () => {
    const automatico = render({ ...revisao, estado: "ATIVO", pendente: false, incluidoNosTotais: true, candidatos: [] });
    expect(automatico).toContain("Ainda não conferido manualmente");
    expect(automatico).toContain("Conferir não soma seu valor de novo");
    expect(automatico).toContain("Confirmar decisão e concluir");
    const manual = render({ ...revisao, estado: "ATIVO", pendente: false, conferidoManualmente: true, incluidoNosTotais: true, podeConcluir: false });
    expect(manual).toContain(">Conferido</p>");
    expect(manual).toContain("Locatário de teste");
    expect(manual).not.toContain("Confirmar decisão e concluir");
  });
  it("respeita valores ocultos, falta de permissão e origem em quarentena", () => {
    mocks.visiveis = false;
    expect(render()).toContain("Revele os valores");
    expect(render()).toMatch(/<fieldset[^>]*disabled=""/);
    expect(render({ ...revisao, podeConcluir: false })).not.toContain("Confirmar decisão e concluir");
    expect(render({ ...revisao, estado: "QUARENTENA", podeConcluir: false })).toContain("Dados inconsistentes: ainda fora dos totais");
  });
});

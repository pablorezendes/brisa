import Link from "next/link";
import {
  Card,
  Dinheiro,
  Kpi,
  PageHeader,
  Sigilo,
  Selo,
  btnPrimario,
  btnSecundario,
} from "@/components/ui";
import { dadosPaginaConciliacao } from "@/lib/consultas/boletos";
import { formatarDataBR } from "@/lib/consultas/locacao";
import { sincronizarBoleto } from "../boletos/actions";
import { ignorarLiquidacaoExterna, reprocessarConciliacao } from "./actions";

export const metadata = { title: "Conciliação bancária — Financeiro — Brisa" };
export const dynamic = "force-dynamic";

const MOTIVOS: Record<string, string> = {
  MES_FECHADO: "Mês fechado",
  BAIXA_MANUAL_EXISTENTE: "Baixa manual já existente",
  PAGAMENTO_PARCIAL: "Pagamento parcial",
  PAGAMENTO_MAIOR: "Valor maior que o devido",
};

function dataHora(data: Date | null): string {
  if (!data) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(data);
}

type SearchParams = Promise<{ ok?: string; erro?: string }>;

export default async function PaginaConciliacao({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const dados = await dadosPaginaConciliacao();

  return (
    <div>
      <PageHeader
        titulo="Conciliação bancária"
        descricao="Acompanhe os avisos do Sicoob e só efetive a baixa quando o arquivo de movimentações tipo 5 (LIQUI) confirmar o pagamento."
        acoes={
          <>
            <Link href="/financeiro/boletos" className={btnPrimario}>Abrir boletos</Link>
            <Link href="/financeiro" className={btnSecundario}>Voltar ao financeiro</Link>
          </>
        }
      />

      {sp.erro ? (
        <div role="alert" className="mb-4 rounded-lg border border-erro/25 bg-erro/5 px-4 py-3 text-[12px] font-semibold text-erro">
          {sp.erro}
        </div>
      ) : null}
      {sp.ok ? (
        <div role="status" className="mb-4 rounded-lg border border-oliva/25 bg-oliva/5 px-4 py-3 text-[12px] font-semibold text-oliva-escura">
          {sp.ok}
        </div>
      ) : null}

      <Card className="relative mb-5 overflow-hidden p-5">
        <span className="absolute left-7 top-12 hidden h-px w-[calc(100%-3.5rem)] bg-contorno lg:block" />
        <div className="relative grid gap-3 lg:grid-cols-4">
          {[
            ["1", "Aviso recebido", "Webhook tipo 7 registra um aviso operacional, sem dar baixa."],
            ["2", "Título acompanhado", "A consulta autenticada atualiza a situação, mas não confirma liquidação."],
            ["3", "LIQUI importado", "O arquivo tipo 5 confirma título, conta, data e valor pagos."],
            ["4", "Baixa conciliada", "Valores exatos atualizam o recebimento com trilha auditável."],
          ].map(([passo, titulo, texto]) => (
            <div key={passo} className="rounded-lg border border-contorno bg-white p-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e7f1ee] font-mono text-[10px] font-bold text-oliva-escura">{passo}</span>
              <h2 className="mt-2 text-[12px] font-bold text-tinta">{titulo}</h2>
              <p className="mt-1 text-[10px] leading-relaxed text-tinta-suave">{texto}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi rotulo="Exigem atenção" valor={dados.totais.pagamentosPendentes} nivel={dados.totais.pagamentosPendentes ? "critico" : "otimo"} selo={dados.totais.pagamentosPendentes ? "revisar" : "em dia"} ajuda="Liquidações LIQUI cujo valor, período ou baixa manual impediram conciliação automática." />
        <Kpi rotulo="Conciliados" valor={dados.totais.pagamentosConciliados} nivel={dados.totais.pagamentosConciliados ? "otimo" : "neutro"} ajuda="Pagamentos confirmados no LIQUI e ligados ao recebimento sem divergência." />
        <Kpi rotulo="Avisos aguardando" valor={dados.pagamentosReportados} nivel={dados.pagamentosReportados ? "atencao" : "neutro"} ajuda="Webhook tipo 7 informou uma movimentação; somente o arquivo tipo 5 (LIQUI) confirma o pagamento." />
        <Kpi rotulo="Sem correspondência" valor={dados.totais.eventosSemCorrespondencia} nivel={dados.totais.eventosSemCorrespondencia ? "critico" : "otimo"} selo={dados.totais.eventosSemCorrespondencia ? "investigar" : "nenhum"} ajuda="Eventos pendentes que não puderam ser associados a um nosso número ou seu número conhecido." />
      </div>

      <Card className="mb-5">
        <div className="border-b border-contorno px-5 py-4">
          <h2 className="text-[15px] font-bold text-tinta">Liquidações e divergências</h2>
          <p className="mt-0.5 text-[10px] text-tinta-suave">
            Mostrando {dados.pagamentos.length} de {dados.totais.pagamentos} registro(s). Divergências aparecem antes dos conciliados.
          </p>
        </div>
        {dados.totais.pagamentos > dados.pagamentos.length ? (
          <div className="border-b border-contorno bg-ambar/5 px-5 py-2.5 text-[10px] font-semibold text-[#795a16]">
            A janela exibe {dados.pagamentos.length} registros, priorizando todos os pendentes que couberem; os KPIs consideram a base completa.
          </div>
        ) : null}
        {dados.pagamentos.length === 0 ? (
          <div className="px-5 py-10 text-center text-[12px] text-tinta-suave">Nenhuma liquidação bancária importada até agora.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela min-w-[1120px]">
              <thead><tr><th>Pagador e imóvel</th><th>Data</th><th className="text-right">Banco</th><th className="text-right">Devido</th><th>Conta</th><th>Resultado</th><th>Origem</th><th className="text-right">Ação</th></tr></thead>
              <tbody>
                {dados.pagamentos.map((pagamento) => {
                  const devido = pagamento.recebimento.valor + pagamento.recebimento.iptu + pagamento.recebimento.cond;
                  return (
                    <tr key={pagamento.id}>
                      <td><div className="font-semibold text-tinta">{pagamento.recebimento.contrato.locatario?.nome ?? "Sem pagador"}</div><div className="mt-0.5 text-[10px] text-tinta-suave">{pagamento.recebimento.empreendimento.nome} · {pagamento.recebimento.contrato.unidade.identificacao}</div></td>
                      <td>{formatarDataBR(pagamento.dataPagamento)}</td>
                      <td className="text-right"><Sigilo><Dinheiro centavos={pagamento.valor} destaque /></Sigilo></td>
                      <td className="text-right"><Sigilo><Dinheiro centavos={devido} /></Sigilo></td>
                      <td>{pagamento.contaBancaria?.apelido ?? "—"}</td>
                      <td>{pagamento.conciliadoEm ? <Selo nivel="otimo">conciliado</Selo> : <div><Selo nivel="critico">pendente</Selo><div className="mt-1 text-[9px] text-tinta-suave">{MOTIVOS[pagamento.motivoPendencia ?? ""] ?? pagamento.motivoPendencia ?? "Revisão necessária"}</div></div>}</td>
                      <td><div className="text-[10px] font-semibold text-tinta">{pagamento.origem === "SICOOB" ? "Sicoob · LIQUI tipo 5" : pagamento.origem.toLowerCase()}</div><div className="mt-0.5 text-[9px] text-tinta-suave">{dataHora(pagamento.criadoEm)}</div></td>
                      <td className="text-right">
                        {!pagamento.conciliadoEm && pagamento.origem === "SICOOB" ? (
                          <form action={reprocessarConciliacao}>
                            <input type="hidden" name="pagamentoId" value={pagamento.id} />
                            <button type="submit" className={`${btnSecundario} min-h-8 px-2.5 py-1 text-[10px]`}>
                              Reavaliar
                            </button>
                          </form>
                        ) : <span className="text-[10px] text-tinta-suave">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Card>
          <div className="border-b border-contorno px-5 py-4"><h2 className="text-[15px] font-bold text-tinta">Eventos aguardando processamento</h2><p className="mt-0.5 text-[10px] text-tinta-suave">Mostrando {dados.eventosPendentes.length} de {dados.totais.eventosPendentes}; somente identificadores e hash são guardados.</p></div>
          {dados.totais.eventosPendentes > dados.eventosPendentes.length ? (
            <div className="border-b border-contorno bg-ambar/5 px-5 py-2.5 text-[10px] font-semibold text-[#795a16]">
              Erros aparecem primeiro; o total considera também os eventos fora desta janela.
            </div>
          ) : null}
          {dados.eventosPendentes.length === 0 ? (
            <div className="px-5 py-9 text-center text-[12px] text-tinta-suave">Nenhum evento pendente.</div>
          ) : (
            <div className="divide-y divide-contorno">
              {dados.eventosPendentes.map((evento) => (
                <div key={evento.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><span className="text-[12px] font-bold text-tinta">{evento.tipo.replaceAll("_", " ").toLowerCase()}</span><Selo nivel={evento.statusProcessamento === "ERRO" ? "critico" : "atencao"}>{evento.statusProcessamento.toLowerCase()}</Selo></div>
                    <div className="mt-1 font-mono text-[9px] text-tinta-suave">nosso nº <Sigilo>{evento.nossoNumero ?? "não identificado"}</Sigilo> · {dataHora(evento.recebidoEm)}</div>
                    {evento.erro ? <p className="mt-1 text-[9px] text-erro">{evento.erro}</p> : null}
                  </div>
                  {evento.boletoId && evento.boleto?.nossoNumero ? (
                    <form action={sincronizarBoleto}>
                      <input type="hidden" name="boletoId" value={evento.boletoId} />
                      <input type="hidden" name="mes" value="" />
                      <button type="submit" className={`${btnSecundario} min-h-8 px-2.5 py-1 text-[10px]`}>Consultar título</button>
                    </form>
                  ) : evento.origem === "MOVIMENTACAO" && evento.tipo === "LIQUIDACAO_CONFIRMADA" ? (
                    <form action={ignorarLiquidacaoExterna} className="flex max-w-72 flex-col items-end gap-2">
                      <input type="hidden" name="eventoId" value={evento.id} />
                      <label className="flex items-start gap-2 text-right text-[9px] font-semibold text-tinta-suave">
                        <input type="checkbox" name="confirmacao" required className="mt-0.5 size-3.5 accent-erro" />
                        Conferi: pertence a título externo ao Brisa
                      </label>
                      <button type="submit" className={`${btnSecundario} min-h-8 border-erro/35 px-2.5 py-1 text-[10px] text-erro`}>
                        Ignorar com auditoria
                      </button>
                    </form>
                  ) : <Selo nivel="critico">sem título</Selo>}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-[14px] font-bold text-tinta">Últimas sincronizações</h2>
          <div className="mt-3 space-y-2">
            {dados.sincronizacoes.length === 0 ? <p className="text-[11px] text-tinta-suave">Nenhuma solicitação de arquivo tipo 5 (LIQUI) registrada.</p> : dados.sincronizacoes.map((sync) => (
              <div key={sync.id} className="rounded-lg border border-contorno bg-[#f8fafb] p-3">
                <div className="flex items-center justify-between gap-2"><span className="text-[11px] font-bold text-tinta">{sync.contaBancaria.apelido}</span><Selo nivel={sync.status === "CONCLUIDA" ? "otimo" : sync.status === "ERRO" ? "critico" : "atencao"}>{sync.status.toLowerCase().replaceAll("_", " ")}</Selo></div>
                <div className="mt-1 text-[9px] text-tinta-suave">{sync.tipo} · {dataHora(sync.iniciadaEm)}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

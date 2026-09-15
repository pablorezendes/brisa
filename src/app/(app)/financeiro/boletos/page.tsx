import Link from "next/link";
import {
  Card,
  Dinheiro,
  Kpi,
  PageHeader,
  SeletorMes,
  Sigilo,
  Selo,
  btnPrimario,
  btnSecundario,
  inputBase,
} from "@/components/ui";
import {
  camposPagadorPendentes,
  statusVisualBoleto,
  totalDevido,
  vencimentoDoRecebimento,
} from "@/lib/dominio/boletos";
import { formatarCompetencia } from "@/lib/dominio/normalizacao";
import {
  dadosPaginaBoletos,
  type FiltroBoletos,
} from "@/lib/consultas/boletos";
import {
  formatarDataBR,
  mesPadraoRecebimentos,
  RE_MES,
} from "@/lib/consultas/locacao";
import { obterEstadoConfiguracaoSicoob } from "@/lib/integracoes/sicoob";
import {
  emitirBoleto,
  liberarEmissaoInconclusiva,
  sincronizarBoleto,
  sincronizarTodosBoletos,
  vincularEmissaoInconclusiva,
} from "./actions";

export const metadata = { title: "Boletos Sicoob — Financeiro — Brisa" };
export const dynamic = "force-dynamic";

type Filtro = FiltroBoletos;
type SearchParams = Promise<{
  mes?: string;
  filtro?: string;
  boleto?: string;
  ok?: string;
  erro?: string;
}>;

function hojeNoBrasil(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function adicionarDias(data: string, dias: number): string {
  const [ano, mes, dia] = data.split("-").map(Number);
  const valor = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return valor.toISOString().slice(0, 10);
}

function vencimentoInicial(
  competencia: string,
  diaVencimento: number | null,
): string {
  const calculado = vencimentoDoRecebimento(competencia, diaVencimento);
  const hoje = hojeNoBrasil();
  return calculado && calculado >= hoje ? calculado : adicionarDias(hoje, 5);
}

function dataHora(data: Date | null): string {
  if (!data) return "Ainda não consultado";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(data);
}

function urlFiltro(mes: string, filtro: Filtro): string {
  return `/financeiro/boletos?mes=${mes}&filtro=${filtro}`;
}

const FILTROS: { valor: Filtro; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "abertos", rotulo: "Em aberto" },
  { valor: "atencao", rotulo: "Exigem atenção" },
  { valor: "pagos", rotulo: "Pagos" },
];

export default async function PaginaBoletos({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const mes = sp.mes && RE_MES.test(sp.mes)
    ? sp.mes
    : ((await mesPadraoRecebimentos()) ?? hojeNoBrasil().slice(0, 7));
  const filtro = FILTROS.some((item) => item.valor === sp.filtro)
    ? (sp.filtro as Filtro)
    : "todos";
  const dados = await dadosPaginaBoletos(mes, filtro);
  const configuracao = obterEstadoConfiguracaoSicoob();
  const ambienteServidor = configuracao.ambiente === "producao" ? "PRODUCAO" : "SANDBOX";
  const contasDisponiveis = dados.contas.filter(
    (conta) =>
      conta.integracaoHabilitada &&
      conta.boletosHabilitados &&
      conta.ambiente === ambienteServidor &&
      Boolean(
        conta.numeroCliente &&
          conta.numeroContaCorrenteApi &&
          conta.codigoModalidade &&
          conta.codigoEspecieDocumento,
      ),
  );
  const contaPadrao = contasDisponiveis.find((conta) => conta.padrao) ?? contasDisponiveis[0];
  const boletos = dados.boletos;
  const selecionado = sp.boleto
    ? dados.boletos.find((boleto) => boleto.id === sp.boleto)
    : undefined;
  const emissaoPronta = configuracao.configurado && contasDisponiveis.length > 0;
  const selecionadoLiberavel = Boolean(
    selecionado &&
      !selecionado.nossoNumero &&
      ["EMITINDO", "RESULTADO_DESCONHECIDO"].includes(selecionado.status),
  );

  return (
    <div>
      <PageHeader
        titulo="Boletos Sicoob"
        descricao={`Emissão, retorno bancário e conciliação dos aluguéis de ${formatarCompetencia(mes)} sem misturar aviso de pagamento com liquidação.`}
        acoes={
          <>
            <Link href="/financeiro/contas-bancarias" className={btnSecundario}>
              Contas bancárias
            </Link>
            <SeletorMes base="/financeiro/boletos" mes={mes} />
          </>
        }
      />

      {sp.erro ? (
        <div role="alert" className="mb-4 rounded-lg border border-erro/25 bg-erro/5 px-4 py-3 text-[13px] font-semibold text-erro">
          {sp.erro}
        </div>
      ) : null}
      {sp.ok ? (
        <div role="status" className="mb-4 rounded-lg border border-oliva/25 bg-oliva/5 px-4 py-3 text-[13px] font-semibold text-oliva-escura">
          {sp.ok}
        </div>
      ) : null}

      <Card
        className="relative mb-5 overflow-hidden border-0 p-0 text-white"
        style={{ backgroundColor: "#102f33" }}
      >
        <span className="pointer-events-none absolute -right-12 -top-20 h-56 w-56 rounded-full border border-white/10" />
        <div className="relative grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:px-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#8fd4bf]">Fluxo bancário protegido</span>
              <span className="rounded border border-white/15 bg-white/[0.06] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-white/75">
                {configuracao.ambiente}
              </span>
            </div>
            <h2 className="mt-2 text-xl font-bold text-white">O banco avisa; o Brisa confirma antes de baixar.</h2>
            <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-white/68">
              O webhook tipo 7 é apenas um <strong className="text-white">aviso operacional</strong>. A baixa no aluguel só acontece quando o arquivo de movimentações tipo 5 (<strong className="text-white">LIQUI</strong>) confirma título, conta, data e valor.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Selo nivel={configuracao.configurado ? "otimo" : "atencao"}>
              {configuracao.configurado ? "API preparada" : "API pendente"}
            </Selo>
            <form action={sincronizarTodosBoletos}>
              <input type="hidden" name="mes" value={mes} />
              <button type="submit" className="inline-flex min-h-9 items-center rounded-lg border border-white/20 bg-white/[0.08] px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-white/[0.14]">
                Atualizar e buscar LIQUI
              </button>
            </form>
          </div>
        </div>
      </Card>

      {!emissaoPronta ? (
        <Card className="mb-5 p-4" nivel="atencao">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[13px] font-bold text-tinta">Emissão protegida até concluir a configuração</h2>
              <p className="mt-1 text-[11px] leading-relaxed text-tinta-suave">
                {configuracao.pendencias.length
                  ? `Servidor: ${configuracao.pendencias.join(", ")}. `
                  : "O servidor está preparado. "}
                Falta habilitar ao menos uma conta com cliente Sisbr, conta do convênio, modalidade e espécie documental confirmados.
              </p>
            </div>
            <Link href="/financeiro/contas-bancarias" className={btnPrimario}>Concluir configuração</Link>
          </div>
        </Card>
      ) : null}

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi rotulo="A emitir" valor={dados.kpis.aEmitir} nivel={dados.kpis.aEmitir ? "atencao" : "otimo"} selo={dados.kpis.aEmitir ? "fila" : "em dia"} ajuda="Lançamentos pendentes que ainda não possuem boleto ativo." />
        <Kpi rotulo="Em aberto" valor={dados.kpis.emAberto} nivel="info" ajuda="Boletos registrados e ainda não liquidados." />
        <Kpi rotulo="Pagamento informado" valor={dados.kpis.pagamentosReportados} nivel={dados.kpis.pagamentosReportados ? "atencao" : "neutro"} ajuda="Avisos operacionais recebidos pelo webhook; ainda não são baixa definitiva." />
        <Kpi rotulo="Liquidados" valor={dados.kpis.liquidados} nivel={dados.kpis.liquidados ? "otimo" : "neutro"} ajuda="Pagamentos confirmados pelo arquivo de movimentações tipo 5 (LIQUI) do Sicoob." />
        <Kpi rotulo="Com problema" valor={dados.kpis.falhas} nivel={dados.kpis.falhas ? "critico" : "otimo"} selo={dados.kpis.falhas ? "agir" : "sem falhas"} ajuda="Emissões com erro ou resultado desconhecido que não podem ser repetidas às cegas." />
      </div>

      {(filtro === "todos" || filtro === "atencao") ? (
        <Card className="mb-5">
          <div className="flex flex-col gap-2 border-b border-contorno px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[15px] font-bold text-tinta">Fila para emissão</h2>
              <p className="mt-0.5 text-[10px] text-tinta-suave">Cada linha é validada antes de qualquer chamada externa.</p>
            </div>
            <Selo nivel={dados.fechado ? "critico" : dados.aEmitir.length ? "atencao" : "otimo"}>
              {dados.fechado ? "mês fechado" : `${dados.aEmitir.length} aguardando`}
            </Selo>
          </div>
          {dados.aEmitir.length === 0 ? (
            <div className="px-5 py-9 text-center text-[12px] text-tinta-suave">Nenhum lançamento elegível aguardando boleto neste mês.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="tabela min-w-[1050px]">
                <thead>
                  <tr>
                    <th>Pagador e imóvel</th>
                    <th>Dados do pagador</th>
                    <th className="text-right">Valor</th>
                    <th>Vencimento</th>
                    <th>Conta emissora</th>
                    <th className="text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.aEmitir.map((recebimento) => {
                    const locatario = recebimento.contrato.locatario;
                    const faltantes = locatario ? camposPagadorPendentes(locatario) : [];
                    const podeEmitir = Boolean(
                      locatario && faltantes.length === 0 && emissaoPronta && !dados.fechado,
                    );
                    return (
                      <tr key={recebimento.id}>
                        <td>
                          <div className="font-semibold text-tinta">{locatario?.nome ?? "Sem pagador"}</div>
                          <div className="mt-0.5 text-[10px] text-tinta-suave">{recebimento.empreendimento.nome} · {recebimento.contrato.unidade.identificacao}</div>
                        </td>
                        <td>
                          {!locatario ? (
                            <Selo nivel="critico">sem vínculo</Selo>
                          ) : faltantes.length ? (
                            <div>
                              <Selo nivel="atencao">{faltantes.length} pendência(s)</Selo>
                              <div className="mt-1 text-[9px] text-tinta-suave">{faltantes.map((item) => item.rotulo).join(", ")}</div>
                              <Link href={`/cadastros/locatarios?editar=${locatario.id}`} className="mt-1 inline-block text-[10px] font-semibold text-oliva-escura hover:underline">Completar cadastro</Link>
                            </div>
                          ) : (
                            <Selo nivel="otimo">validado</Selo>
                          )}
                        </td>
                        <td className="text-right"><Sigilo><Dinheiro centavos={totalDevido(recebimento)} destaque /></Sigilo></td>
                        <td colSpan={podeEmitir ? 3 : 1}>
                          {podeEmitir ? (
                            <form action={emitirBoleto} className="grid grid-cols-[140px_minmax(190px,1fr)_auto] items-end gap-2">
                              <input type="hidden" name="recebimentoId" value={recebimento.id} />
                              <input type="hidden" name="mes" value={mes} />
                              <label className="text-[9px] font-bold uppercase tracking-[0.08em] text-tinta-suave">
                                Vencimento
                                <input type="date" name="dataVencimento" min={hojeNoBrasil()} required defaultValue={vencimentoInicial(recebimento.competencia, recebimento.contrato.diaVencimento)} className={`${inputBase} mt-1 block w-full py-1.5`} />
                              </label>
                              <label className="text-[9px] font-bold uppercase tracking-[0.08em] text-tinta-suave">
                                Conta
                                <select name="contaBancariaId" required defaultValue={contaPadrao?.id} className={`${inputBase} mt-1 block w-full py-1.5`}>
                                  {contasDisponiveis.map((conta) => <option key={conta.id} value={conta.id}>{conta.apelido} · {conta.numero}{conta.padrao ? " (padrão)" : ""}</option>)}
                                </select>
                              </label>
                              <button type="submit" className={btnPrimario}>Emitir boleto</button>
                            </form>
                          ) : (
                            <span className="text-[10px] text-tinta-suave">Corrija as pendências para liberar a emissão.</span>
                          )}
                        </td>
                        {!podeEmitir ? <><td>—</td><td className="text-right">—</td></> : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-col gap-3 border-b border-contorno px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[15px] font-bold text-tinta">Títulos bancários</h2>
            <p className="mt-0.5 text-[10px] text-tinta-suave">
              Mostrando {boletos.length} de {dados.totalBoletosFiltro} boleto(s) no filtro atual.
              {filtro === "todos" && dados.contagensFiltro.atencao > 0
                ? " Itens que exigem atenção aparecem primeiro."
                : ""}
            </p>
          </div>
          <div className="inline-flex flex-wrap gap-1 rounded-lg border border-contorno bg-[#f8fafb] p-1">
            {FILTROS.map((item) => (
              <Link key={item.valor} href={urlFiltro(mes, item.valor)} aria-current={filtro === item.valor ? "page" : undefined} className={`rounded-md px-2.5 py-1.5 text-[10px] font-bold transition ${filtro === item.valor ? "bg-white text-tinta shadow-sm" : "text-tinta-suave hover:text-tinta"}`}>
                {item.rotulo} · {dados.contagensFiltro[item.valor]}
              </Link>
            ))}
          </div>
        </div>
        {dados.totalBoletosFiltro > boletos.length ? (
          <div className="border-b border-contorno bg-ambar/5 px-5 py-2.5 text-[10px] font-semibold text-[#795a16]">
            A tela exibe as primeiras {boletos.length} ocorrências; o total acima considera toda a base. Refine o filtro para consultar os demais títulos.
          </div>
        ) : null}
        {boletos.length === 0 ? (
          <div className="px-5 py-10 text-center text-[12px] text-tinta-suave">Nenhum boleto neste filtro.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela min-w-[1120px]">
              <thead>
                <tr>
                  <th>Pagador e imóvel</th>
                  <th>Vencimento</th>
                  <th className="text-right">Valor</th>
                  <th>Conta</th>
                  <th>Nosso número</th>
                  <th>Status</th>
                  <th>Conciliação</th>
                  <th>Atualização bancária</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {boletos.map((boleto) => {
                  const visual = statusVisualBoleto(boleto.status);
                  return (
                    <tr key={boleto.id} className={sp.boleto === boleto.id ? "bg-oliva/5" : ""}>
                      <td>
                        <div className="font-semibold text-tinta">{boleto.pagadorNome}</div>
                        <div className="mt-0.5 text-[10px] text-tinta-suave">{boleto.recebimento.empreendimento.nome} · {boleto.recebimento.contrato.unidade.identificacao}</div>
                      </td>
                      <td>{formatarDataBR(boleto.dataVencimento)}</td>
                      <td className="text-right"><Sigilo><Dinheiro centavos={boleto.valor} /></Sigilo></td>
                      <td>{boleto.contaBancaria.apelido}</td>
                      <td className="font-mono text-[11px] tabular-nums"><Sigilo>{boleto.nossoNumero ?? "aguardando"}</Sigilo></td>
                      <td><Selo nivel={visual.nivel}>{visual.rotulo}</Selo></td>
                      <td>
                        <Selo nivel={boleto.conciliacaoStatus === "CONCILIADO" ? "otimo" : boleto.conciliacaoStatus === "DIVERGENTE" ? "critico" : "atencao"}>
                          {boleto.conciliacaoStatus === "CONCILIADO" ? "conciliado" : boleto.conciliacaoStatus === "DIVERGENTE" ? "divergente" : "aguardando"}
                        </Selo>
                      </td>
                      <td>
                        <span className="whitespace-nowrap text-[10px]">{dataHora(boleto.ultimaConsultaEm)}</span>
                        {boleto.mensagemErro ? <div className="mt-1 max-w-60 text-[9px] leading-snug text-erro">{boleto.mensagemErro}</div> : null}
                      </td>
                      <td className="text-right">
                        <span className="inline-flex gap-2">
                          <Link href={`/financeiro/boletos?mes=${mes}&filtro=${filtro}&boleto=${boleto.id}`} className={`${btnSecundario} min-h-8 px-2.5 py-1 text-[10px]`}>Detalhes</Link>
                          {boleto.nossoNumero && !["BAIXADO_SEM_PAGAMENTO", "ESTORNADO"].includes(boleto.status) ? (
                            <form action={sincronizarBoleto}>
                              <input type="hidden" name="boletoId" value={boleto.id} />
                              <input type="hidden" name="mes" value={mes} />
                              <button type="submit" className={`${btnSecundario} min-h-8 px-2.5 py-1 text-[10px]`}>Consultar</button>
                            </form>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selecionado ? (
        <Card className="mt-5 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-oliva">Detalhe do boleto</div>
              <h2 className="mt-1 text-lg font-bold text-tinta">{selecionado.pagadorNome}</h2>
              <p className="mt-1 text-[11px] text-tinta-suave">Seu número <span className="font-mono">{selecionado.seuNumero}</span> · nosso número <span className="font-mono"><Sigilo>{selecionado.nossoNumero ?? "—"}</Sigilo></span></p>
            </div>
            <Link href={urlFiltro(mes, filtro)} className={btnSecundario}>Fechar detalhe</Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-contorno bg-[#f8fafb] p-3"><div className="text-[9px] font-bold uppercase text-tinta-suave">Linha digitável</div><div className="mt-1 break-all font-mono text-[10px] text-tinta"><Sigilo>{selecionado.linhaDigitavel ?? "Ainda não disponível"}</Sigilo></div></div>
            <div className="rounded-lg border border-contorno bg-[#f8fafb] p-3"><div className="text-[9px] font-bold uppercase text-tinta-suave">Valor liquidado</div><div className="mt-1"><Sigilo><Dinheiro centavos={selecionado.valorPago} destaque /></Sigilo></div></div>
            <div className="rounded-lg border border-contorno bg-[#f8fafb] p-3"><div className="text-[9px] font-bold uppercase text-tinta-suave">Banco</div><div className="mt-1 text-[11px] font-semibold text-tinta">{selecionado.situacaoBanco ?? "Sem retorno"}</div></div>
            <div className="rounded-lg border border-contorno bg-[#f8fafb] p-3"><div className="text-[9px] font-bold uppercase text-tinta-suave">Eventos</div><div className="mt-1 text-[11px] font-semibold text-tinta">{selecionado.eventos.length} recente(s)</div></div>
          </div>
          <div className="mt-4 border-t border-contorno pt-4">
            <h3 className="text-[12px] font-bold text-tinta">Linha do tempo</h3>
            <ol className="mt-3 grid gap-2 sm:grid-cols-3">
              <li className="rounded-lg border border-contorno px-3 py-2 text-[10px]"><Selo nivel="otimo">criado no Brisa</Selo><div className="mt-1 text-tinta-suave">{dataHora(selecionado.criadoEm)}</div></li>
              <li className="rounded-lg border border-contorno px-3 py-2 text-[10px]"><Selo nivel={selecionado.emitidoEm ? "otimo" : "atencao"}>{selecionado.emitidoEm ? "registrado no Sicoob" : "aguardando registro"}</Selo><div className="mt-1 text-tinta-suave">{dataHora(selecionado.emitidoEm)}</div></li>
              <li className="rounded-lg border border-contorno px-3 py-2 text-[10px]"><Selo nivel={selecionado.conciliacaoStatus === "CONCILIADO" ? "otimo" : "atencao"}>{selecionado.conciliacaoStatus === "CONCILIADO" ? "baixa conciliada" : "aguardando liquidação"}</Selo><div className="mt-1 text-tinta-suave">{dataHora(selecionado.liquidadoEm)}</div></li>
            </ol>
          </div>
          {selecionadoLiberavel ? (
            <div className="mt-4 grid gap-3 rounded-lg border border-ambar/30 bg-ambar/5 p-4 lg:grid-cols-2">
              <form action={vincularEmissaoInconclusiva} className="rounded-lg border border-contorno bg-white p-3">
                <input type="hidden" name="boletoId" value={selecionado.id} />
                <input type="hidden" name="mes" value={mes} />
                <div className="text-[12px] font-bold text-tinta">Encontrei o título no Sicoob</div>
                <p className="mt-1 text-[10px] leading-relaxed text-tinta-suave">
                  Informe o nosso número. O Brisa consulta a API e só vincula se conta, modalidade, seu número e valor forem coerentes.
                </p>
                <div className="mt-3 flex gap-2">
                  <input name="nossoNumero" inputMode="numeric" pattern="[0-9]{1,30}" maxLength={30} required placeholder="Nosso número" className={`${inputBase} min-w-0 flex-1`} />
                  <button type="submit" className={btnPrimario}>Conferir e vincular</button>
                </div>
              </form>
              <form action={liberarEmissaoInconclusiva} className="rounded-lg border border-erro/25 bg-white p-3">
                <input type="hidden" name="boletoId" value={selecionado.id} />
                <input type="hidden" name="mes" value={mes} />
              <div className="text-[12px] font-bold text-tinta">Recuperar emissão inconclusiva</div>
              <p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-tinta-suave">
                Use somente depois de procurar este título diretamente no Sicoob. A liberação fica registrada na auditoria e permite uma nova emissão.
              </p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex items-start gap-2 text-[10px] font-semibold text-tinta">
                  <input type="checkbox" name="confirmacao" required className="mt-0.5 size-4 accent-erro" />
                  Conferi no Sicoob e confirmo que este título não existe.
                </label>
                <button type="submit" className={`${btnSecundario} border-erro/40 text-erro hover:bg-erro/10`}>
                  Liberar para nova emissão
                </button>
              </div>
              </form>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

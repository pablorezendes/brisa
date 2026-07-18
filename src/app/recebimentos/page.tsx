import Link from "next/link";
import {
  PageHeader,
  Card,
  Dinheiro,
  Badge,
  SeletorMes,
  btnPrimario,
  btnSecundario,
  inputBase,
} from "@/components/ui";
import { calcularRecebimento, comissaoTotal } from "@/lib/dominio/comissao";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { formatarCompetencia } from "@/lib/dominio/normalizacao";
import {
  RE_MES,
  VIAS_PAGAMENTO,
  formatarDataBR,
  recebimentosDoMes,
  mesPadraoRecebimentos,
  fechamentoDoMes,
  contratosParaSelecao,
  type RecebimentoComRelacoes,
  type ContratoComRelacoes,
} from "@/lib/consultas/locacao";
import {
  gerarDevidosDoMes,
  registrarRecebimento,
  limparRecebimento,
  excluirRecebimento,
  criarLancamentoAvulso,
  fecharMes,
  reabrirMes,
} from "./actions";

type SearchParams = Promise<{
  mes?: string;
  emp?: string;
  editar?: string;
  excluir?: string;
  avulso?: string;
  reabrir?: string;
  erro?: string;
  ok?: string;
}>;

const btnPerigo =
  "inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500";

export default async function PaginaRecebimentos({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const mes =
    sp.mes && RE_MES.test(sp.mes)
      ? sp.mes
      : ((await mesPadraoRecebimentos()) ?? "2026-01");

  const [recebimentos, fechamento] = await Promise.all([
    recebimentosDoMes(mes),
    fechamentoDoMes(mes),
  ]);
  const fechado = fechamento !== null;

  // Filtro por empreendimento (?emp=id)
  const empreendimentos = Array.from(
    new Map(recebimentos.map((r) => [r.empreendimentoId, r.empreendimento])).values()
  ).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const empFiltro = empreendimentos.some((e) => e.id === sp.emp) ? sp.emp : undefined;
  const exibidos = empFiltro
    ? recebimentos.filter((r) => r.empreendimentoId === empFiltro)
    : recebimentos;

  const linhas = exibidos.map((r) => ({ r, calc: calcularRecebimento(r) }));
  const totais = linhas.reduce(
    (t, { r, calc }) => {
      t.valor += r.valor;
      t.iptu += r.iptu;
      t.cond += r.cond;
      t.total += calc.totalDevido ?? 0;
      t.recebido += r.recebido ?? 0;
      t.base += calc.baseCalculo ?? 0;
      return t;
    },
    { valor: 0, iptu: 0, cond: 0, total: 0, recebido: 0, base: 0 }
  );
  const totalComissao = comissaoTotal(exibidos);
  const pendentes = recebimentos.filter((r) => r.recebido === null).length;

  const editando = !fechado && sp.editar
    ? (recebimentos.find((r) => r.id === sp.editar) ?? null)
    : null;
  const excluindo = !fechado && sp.excluir
    ? (recebimentos.find((r) => r.id === sp.excluir) ?? null)
    : null;
  const mostrarAvulso = !fechado && sp.avulso === "1";
  const confirmarReabrir = fechado && sp.reabrir === "1";
  const contratosSelecao = mostrarAvulso ? await contratosParaSelecao() : [];

  const urlBase = (extras?: Record<string, string>) => {
    const p = new URLSearchParams({ mes });
    if (empFiltro) p.set("emp", empFiltro);
    for (const [k, v] of Object.entries(extras ?? {})) p.set(k, v);
    return `/recebimentos?${p.toString()}`;
  };

  return (
    <div>
      <PageHeader
        titulo="Recebimentos"
        descricao={`${recebimentos.length} lançamento(s) em ${formatarCompetencia(mes)} — ${pendentes} pendente(s)`}
        acoes={<SeletorMes base="/recebimentos" mes={mes} />}
      />

      {sp.erro ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {sp.erro}
        </div>
      ) : null}
      {sp.ok ? (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          {sp.ok}
        </div>
      ) : null}

      {/* Barra de ações do mês */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {fechado ? (
          <>
            <Badge cor="vermelho">Mês fechado</Badge>
            <span className="text-sm text-slate-500">
              Comissão fechada:{" "}
              <Dinheiro centavos={fechamento.comissaoTotal} destaque /> em{" "}
              {fechamento.fechadoEm.toLocaleDateString("pt-BR")}
            </span>
            <Link href={urlBase({ reabrir: "1" })} className={btnSecundario}>
              Reabrir
            </Link>
          </>
        ) : (
          <>
            <form action={gerarDevidosDoMes}>
              <input type="hidden" name="mes" value={mes} />
              <button type="submit" className={btnSecundario}>
                Gerar devidos do mês
              </button>
            </form>
            <Link href={urlBase({ avulso: "1" })} className={btnSecundario}>
              Lançamento avulso
            </Link>
            <form action={fecharMes}>
              <input type="hidden" name="mes" value={mes} />
              <button type="submit" className={btnPrimario}>
                Fechar mês
              </button>
            </form>
          </>
        )}
      </div>

      {/* Filtro por empreendimento */}
      {empreendimentos.length > 1 ? (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Empreendimento:
          </span>
          <Link
            href={`/recebimentos?mes=${mes}`}
            className={`rounded-full px-2.5 py-0.5 ${!empFiltro ? "bg-slate-900 text-white" : "bg-slate-100 hover:bg-slate-200"}`}
          >
            Todos
          </Link>
          {empreendimentos.map((e) => (
            <Link
              key={e.id}
              href={`/recebimentos?mes=${mes}&emp=${e.id}`}
              className={`rounded-full px-2.5 py-0.5 ${empFiltro === e.id ? "bg-slate-900 text-white" : "bg-slate-100 hover:bg-slate-200"}`}
            >
              {e.nome}
            </Link>
          ))}
        </div>
      ) : null}

      {confirmarReabrir && fechamento ? (
        <Card className="mb-4 border-amber-300 bg-amber-50 p-4">
          <p className="text-sm">
            Reabrir <strong>{formatarCompetencia(mes)}</strong>? O fechamento de{" "}
            <Dinheiro centavos={fechamento.comissaoTotal} destaque /> será
            apagado e os lançamentos voltarão a aceitar alterações.
          </p>
          <div className="mt-3 flex gap-2">
            <form action={reabrirMes}>
              <input type="hidden" name="mes" value={mes} />
              <button type="submit" className={btnPerigo}>
                Confirmar reabertura
              </button>
            </form>
            <Link href={urlBase()} className={btnSecundario}>
              Cancelar
            </Link>
          </div>
        </Card>
      ) : null}

      {excluindo ? (
        <Card className="mb-4 border-red-300 bg-red-50 p-4">
          <p className="text-sm">
            Excluir o lançamento de{" "}
            <strong>{excluindo.empreendimento.nome}</strong> —{" "}
            {excluindo.contrato.unidade.identificacao} (
            {excluindo.contrato.locatario?.nome ?? "Desocupado"}), competência{" "}
            {formatarCompetencia(excluindo.competencia)}, valor{" "}
            <Dinheiro centavos={excluindo.valor} />? Esta ação não pode ser
            desfeita.
          </p>
          <div className="mt-3 flex gap-2">
            <form action={excluirRecebimento}>
              <input type="hidden" name="id" value={excluindo.id} />
              <button type="submit" className={btnPerigo}>
                Confirmar exclusão
              </button>
            </form>
            <Link href={urlBase()} className={btnSecundario}>
              Cancelar
            </Link>
          </div>
        </Card>
      ) : null}

      {editando ? <FormRegistrar lancamento={editando} urlVoltar={urlBase()} /> : null}

      {mostrarAvulso ? (
        <FormAvulso mes={mes} contratos={contratosSelecao} urlVoltar={urlBase()} />
      ) : null}

      <Card>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>Empreendimento</th>
                <th>Locatário</th>
                <th>Localização</th>
                <th style={{ textAlign: "right" }}>Valor</th>
                <th style={{ textAlign: "right" }}>IPTU</th>
                <th style={{ textAlign: "right" }}>Cond.</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th style={{ textAlign: "right" }}>Recebido</th>
                <th style={{ textAlign: "right" }}>Base de cálculo</th>
                <th style={{ textAlign: "right" }}>Comissão</th>
                <th>Data</th>
                <th>Competência</th>
                <th>Via</th>
                <th>Observação</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 ? (
                <tr>
                  <td colSpan={15} className="py-6 text-center text-slate-400">
                    Nenhum lançamento em {formatarCompetencia(mes)}. Use
                    “Gerar devidos do mês” para criar os devidos dos contratos
                    ativos.
                  </td>
                </tr>
              ) : (
                linhas.map(({ r, calc }) => (
                  <tr key={r.id} className={r.recebido === null ? "bg-amber-50/60" : ""}>
                    <td>{r.empreendimento.nome}</td>
                    <td>
                      {r.contrato.locatario?.nome ?? (
                        <span className="text-slate-400">Desocupado</span>
                      )}{" "}
                      {r.origemAgregada ? <Badge cor="azul">Agregado</Badge> : null}
                    </td>
                    <td>{r.contrato.unidade.identificacao}</td>
                    <td className="text-right"><Dinheiro centavos={r.valor} /></td>
                    <td className="text-right"><Dinheiro centavos={r.iptu} /></td>
                    <td className="text-right"><Dinheiro centavos={r.cond} /></td>
                    <td className="text-right"><Dinheiro centavos={calc.totalDevido} /></td>
                    <td className="text-right">
                      {r.recebido === null ? (
                        <Badge cor="ambar">Pendente</Badge>
                      ) : (
                        <Dinheiro centavos={r.recebido} destaque />
                      )}
                    </td>
                    <td className="text-right"><Dinheiro centavos={calc.baseCalculo} /></td>
                    <td className="text-right"><Dinheiro centavos={calc.comissao} destaque /></td>
                    <td>{formatarDataBR(r.dataPagamento)}</td>
                    <td>
                      {r.competencia === r.mesLancamento ? (
                        formatarCompetencia(r.competencia)
                      ) : (
                        <Badge cor="ambar">{formatarCompetencia(r.competencia)}</Badge>
                      )}
                    </td>
                    <td>{r.via ?? "—"}</td>
                    <td className="max-w-48 truncate" title={r.observacao ?? undefined}>
                      {r.observacao ?? "—"}
                    </td>
                    <td>
                      {!fechado ? (
                        <span className="flex gap-2 text-xs">
                          <Link
                            href={urlBase({ editar: r.id })}
                            className="text-sky-700 hover:underline"
                          >
                            {r.recebido === null ? "Registrar" : "Editar"}
                          </Link>
                          <Link
                            href={urlBase({ excluir: r.id })}
                            className="text-red-600 hover:underline"
                          >
                            Excluir
                          </Link>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {linhas.length > 0 ? (
              <tfoot>
                <tr>
                  <td colSpan={3}>
                    Totais {empFiltro ? "(empreendimento filtrado)" : "do mês"}
                  </td>
                  <td className="text-right"><Dinheiro centavos={totais.valor} /></td>
                  <td className="text-right"><Dinheiro centavos={totais.iptu} /></td>
                  <td className="text-right"><Dinheiro centavos={totais.cond} /></td>
                  <td className="text-right"><Dinheiro centavos={totais.total} /></td>
                  <td className="text-right"><Dinheiro centavos={totais.recebido} /></td>
                  <td className="text-right"><Dinheiro centavos={totais.base} /></td>
                  <td className="text-right"><Dinheiro centavos={totalComissao} destaque /></td>
                  <td colSpan={5}></td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </Card>
    </div>
  );
}

/** Form de registro/edição de recebimento de uma linha (server-side, sem JS). */
function FormRegistrar({
  lancamento,
  urlVoltar,
}: {
  lancamento: RecebimentoComRelacoes;
  urlVoltar: string;
}) {
  const calc = calcularRecebimento(lancamento);
  const sugerido = lancamento.recebido ?? calc.totalDevido;
  return (
    <Card className="mb-4 p-4">
      <h2 className="mb-1 text-sm font-semibold">
        {lancamento.recebido === null ? "Registrar recebimento" : "Editar recebimento"} —{" "}
        {lancamento.empreendimento.nome} · {lancamento.contrato.unidade.identificacao} ·{" "}
        {lancamento.contrato.locatario?.nome ?? "Desocupado"}
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        Total devido: {formatarBRL(calc.totalDevido)} (valor {formatarBRL(lancamento.valor)}
        {" + "}IPTU {formatarBRL(lancamento.iptu)} + cond. {formatarBRL(lancamento.cond)})
        — IPTU e condomínio são repasses e não entram na comissão.
      </p>
      <form action={registrarRecebimento} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={lancamento.id} />
        <label className="block text-xs font-medium text-slate-600">
          Recebido
          <input
            name="recebido"
            defaultValue={sugerido !== null ? formatarBRL(sugerido) : ""}
            placeholder="1.234,56"
            className={`${inputBase} mt-1 block w-32`}
            required
          />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Data do pagamento
          <input
            type="date"
            name="dataPagamento"
            defaultValue={lancamento.dataPagamento ?? ""}
            className={`${inputBase} mt-1 block`}
          />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Competência
          <input
            type="month"
            name="competencia"
            defaultValue={lancamento.competencia}
            className={`${inputBase} mt-1 block`}
          />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Via
          <select name="via" defaultValue={lancamento.via ?? ""} className={`${inputBase} mt-1 block`}>
            <option value="">—</option>
            {VIAS_PAGAMENTO.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="block grow text-xs font-medium text-slate-600">
          Observação
          <input
            name="observacao"
            defaultValue={lancamento.observacao ?? ""}
            className={`${inputBase} mt-1 block w-full`}
          />
        </label>
        <button type="submit" className={btnPrimario}>Salvar</button>
        <Link href={urlVoltar} className={btnSecundario}>Cancelar</Link>
      </form>
      {lancamento.recebido !== null ? (
        <form action={limparRecebimento} className="mt-3">
          <input type="hidden" name="id" value={lancamento.id} />
          <button type="submit" className="text-xs text-red-600 hover:underline">
            Limpar recebimento (voltar a pendente)
          </button>
        </form>
      ) : null}
    </Card>
  );
}

/** Form de lançamento avulso (atrasos/adiantamentos: competência editável). */
function FormAvulso({
  mes,
  contratos,
  urlVoltar,
}: {
  mes: string;
  contratos: ContratoComRelacoes[];
  urlVoltar: string;
}) {
  const grupos = new Map<string, ContratoComRelacoes[]>();
  for (const c of contratos) {
    const nome = c.unidade.empreendimento.nome;
    const lista = grupos.get(nome) ?? [];
    lista.push(c);
    grupos.set(nome, lista);
  }
  return (
    <Card className="mb-4 p-4">
      <h2 className="mb-1 text-sm font-semibold">
        Lançamento avulso em {formatarCompetencia(mes)}
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        Para atrasos, a competência pode ser um mês anterior ao lançamento.
        Valor/IPTU/Cond. em branco herdam os valores do contrato.
      </p>
      <form action={criarLancamentoAvulso} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="mes" value={mes} />
        <label className="block text-xs font-medium text-slate-600">
          Contrato
          <select name="contratoId" className={`${inputBase} mt-1 block max-w-96`} required defaultValue="">
            <option value="" disabled>— selecione —</option>
            {Array.from(grupos.entries()).map(([nome, lista]) => (
              <optgroup key={nome} label={nome}>
                {lista.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.unidade.identificacao} — {c.locatario?.nome ?? "Desocupado"}
                    {c.status !== "ativo" ? ` (${c.status})` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Competência
          <input type="month" name="competencia" defaultValue={mes} className={`${inputBase} mt-1 block`} />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Valor
          <input name="valor" placeholder="do contrato" className={`${inputBase} mt-1 block w-28`} />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          IPTU
          <input name="iptu" placeholder="do contrato" className={`${inputBase} mt-1 block w-24`} />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Cond.
          <input name="cond" placeholder="do contrato" className={`${inputBase} mt-1 block w-24`} />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Recebido (opcional)
          <input name="recebido" placeholder="pendente" className={`${inputBase} mt-1 block w-28`} />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Data do pagamento
          <input type="date" name="dataPagamento" className={`${inputBase} mt-1 block`} />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Via
          <select name="via" defaultValue="" className={`${inputBase} mt-1 block`}>
            <option value="">—</option>
            {VIAS_PAGAMENTO.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="block grow text-xs font-medium text-slate-600">
          Observação
          <input name="observacao" className={`${inputBase} mt-1 block w-full`} />
        </label>
        <button type="submit" className={btnPrimario}>Criar lançamento</button>
        <Link href={urlVoltar} className={btnSecundario}>Cancelar</Link>
      </form>
    </Card>
  );
}

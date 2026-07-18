import Link from "next/link";
import { notFound } from "next/navigation";
import {
  PageHeader,
  Card,
  Dinheiro,
  Badge,
  Kpi,
  btnPrimario,
  btnSecundario,
  inputBase,
} from "@/components/ui";
import { calcularRecebimento, comissaoTotal } from "@/lib/dominio/comissao";
import {
  formatarCompetencia,
  NOME_MES_COMPLETO,
} from "@/lib/dominio/normalizacao";
import {
  contratoDetalhe,
  recebimentosDoContrato,
  formatarDataBR,
} from "@/lib/consultas/locacao";
import { encerrarContrato } from "../actions";
import { badgeStatus } from "../status";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ encerrar?: string; erro?: string; ok?: string }>;

/** Data de hoje "YYYY-MM-DD" no fuso local (só como default do formulário). */
function hojeLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function Item({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {rotulo}
      </div>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}

export default async function PaginaDetalheContrato({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const contrato = await contratoDetalhe(id);
  if (!contrato) notFound();

  const recebimentos = await recebimentosDoContrato(id);
  const linhas = recebimentos.map((r) => ({ r, calc: calcularRecebimento(r) }));
  const totalComissao = comissaoTotal(recebimentos);
  const totalRecebido = recebimentos.reduce((s, r) => s + (r.recebido ?? 0), 0);
  const pendentes = recebimentos.filter((r) => r.recebido === null).length;
  const totalContratado =
    contrato.valorBase + contrato.iptu + contrato.condominio;
  const confirmarEncerrar =
    sp.encerrar === "1" && contrato.status !== "encerrado";

  return (
    <div>
      <PageHeader
        titulo={`${contrato.unidade.empreendimento.nome} — ${contrato.unidade.identificacao}`}
        descricao={contrato.locatario?.nome ?? "Desocupado"}
        acoes={
          <>
            <Link href="/contratos" className={btnSecundario}>
              Voltar
            </Link>
            <Link href={`/contratos/${contrato.id}/editar`} className={btnSecundario}>
              Editar
            </Link>
            {contrato.status !== "encerrado" ? (
              <Link
                href={`/contratos/${contrato.id}?encerrar=1`}
                className={btnPrimario}
              >
                Encerrar contrato
              </Link>
            ) : null}
          </>
        }
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

      {confirmarEncerrar ? (
        <Card className="mb-4 border-amber-300 bg-amber-50 p-4">
          <p className="text-sm">
            Encerrar este contrato? Ele deixará de gerar devidos mensais em
            “Gerar devidos do mês”.
          </p>
          <form
            action={encerrarContrato}
            className="mt-3 flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="id" value={contrato.id} />
            <label className="block text-xs font-medium text-slate-600">
              Data de encerramento
              <input
                type="date"
                name="fim"
                defaultValue={contrato.fim ?? hojeLocal()}
                className={`${inputBase} mt-1 block`}
                required
              />
            </label>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
            >
              Confirmar encerramento
            </button>
            <Link href={`/contratos/${contrato.id}`} className={btnSecundario}>
              Cancelar
            </Link>
          </form>
        </Card>
      ) : null}

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi
          rotulo="Comissão gerada"
          valor={<Dinheiro centavos={totalComissao} destaque />}
          detalhe={`${recebimentos.length} lançamento(s) no histórico`}
        />
        <Kpi
          rotulo="Total recebido"
          valor={<Dinheiro centavos={totalRecebido} />}
          detalhe={pendentes > 0 ? `${pendentes} pendente(s)` : "sem pendências"}
        />
        <Kpi
          rotulo="Total contratado / mês"
          valor={<Dinheiro centavos={totalContratado} />}
          detalhe="valor + IPTU + condomínio"
        />
      </div>

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Item rotulo="Status">{badgeStatus(contrato.status)}</Item>
          <Item rotulo="Locatário">
            {contrato.locatario?.nome ?? <Badge cor="slate">Desocupado</Badge>}
          </Item>
          <Item rotulo="CPF/CNPJ">{contrato.locatario?.cpfCnpj ?? "—"}</Item>
          <Item rotulo="Contato">{contrato.locatario?.contato ?? "—"}</Item>
          <Item rotulo="Valor (aluguel)">
            <Dinheiro centavos={contrato.valorBase} />
          </Item>
          <Item rotulo="IPTU (repasse)">
            <Dinheiro centavos={contrato.iptu} />
          </Item>
          <Item rotulo="Condomínio (repasse)">
            <Dinheiro centavos={contrato.condominio} />
          </Item>
          <Item rotulo="Dia de vencimento">
            {contrato.diaVencimento ?? "—"}
          </Item>
          <Item rotulo="Mês de reajuste">
            {contrato.mesReajuste
              ? NOME_MES_COMPLETO[contrato.mesReajuste]
              : "—"}
          </Item>
          <Item rotulo="Índice de reajuste">
            {contrato.indiceReajuste ?? "—"}
          </Item>
          <Item rotulo="Início">{formatarDataBR(contrato.inicio)}</Item>
          <Item rotulo="Fim">{formatarDataBR(contrato.fim)}</Item>
        </div>
        {contrato.observacao ? (
          <div className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600">
            <span className="font-semibold">Observação:</span>{" "}
            {contrato.observacao}
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="px-4 pb-1 pt-3">
          <h2 className="text-sm font-bold">Histórico de recebimentos</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>Mês (lançamento)</th>
                <th>Competência</th>
                <th style={{ textAlign: "right" }}>Valor</th>
                <th style={{ textAlign: "right" }}>IPTU</th>
                <th style={{ textAlign: "right" }}>Cond.</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th style={{ textAlign: "right" }}>Recebido</th>
                <th style={{ textAlign: "right" }}>Base de cálculo</th>
                <th style={{ textAlign: "right" }}>Comissão</th>
                <th>Data</th>
                <th>Via</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-6 text-center text-slate-400">
                    Nenhum recebimento lançado para este contrato.
                  </td>
                </tr>
              ) : (
                linhas.map(({ r, calc }) => (
                  <tr
                    key={r.id}
                    className={r.recebido === null ? "bg-amber-50/60" : ""}
                  >
                    <td>{formatarCompetencia(r.mesLancamento)}</td>
                    <td>
                      {r.competencia === r.mesLancamento ? (
                        formatarCompetencia(r.competencia)
                      ) : (
                        <Badge cor="ambar">
                          {formatarCompetencia(r.competencia)}
                        </Badge>
                      )}
                    </td>
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
                    <td>{r.via ?? "—"}</td>
                    <td className="max-w-48 truncate" title={r.observacao ?? undefined}>
                      {r.observacao ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {linhas.length > 0 ? (
              <tfoot>
                <tr>
                  <td colSpan={6}>Total do contrato</td>
                  <td className="text-right"><Dinheiro centavos={totalRecebido} /></td>
                  <td></td>
                  <td className="text-right"><Dinheiro centavos={totalComissao} destaque /></td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </Card>
    </div>
  );
}

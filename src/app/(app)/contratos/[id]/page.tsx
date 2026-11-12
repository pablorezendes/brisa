import { acessoAtual, exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { pode } from "@/lib/acesso/politica";
import Link from "next/link";
import { ExcluirRegistroLink } from "@/components/excluir-registro-link";
import { notFound } from "next/navigation";
import {
  PageHeader,
  Card,
  Badge,
  btnPrimario,
  btnSecundario,
  inputBase,
} from "@/components/ui";
import {
  NOME_MES_COMPLETO,
} from "@/lib/dominio/normalizacao";
import {
  contratoDetalhe,
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
      <div className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">
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
  await exigirPaginaAcesso("/contratos/[id]");
  const acesso = await acessoAtual();
  const podeVerPii = pode(acesso, "cadastros.sensiveis");
  const podeEditar = pode(acesso, "contratos.editar");
  const { id } = await params;
  const sp = await searchParams;
  const contrato = await contratoDetalhe(id);
  if (!contrato) notFound();

  const confirmarEncerrar =
    podeEditar && sp.encerrar === "1" && contrato.status !== "encerrado";

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
            {podeEditar && podeVerPii ? <Link href={`/contratos/${contrato.id}/editar`} className={btnSecundario}>
              Editar
            </Link> : null}
            <ExcluirRegistroLink tipo="CONTRATO" origemId={contrato.id} />
            {podeEditar && contrato.status !== "encerrado" ? (
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
        <div className="mb-4 rounded-md border border-erro/25 bg-erro/5 px-4 py-2.5 text-sm text-erro">
          {sp.erro}
        </div>
      ) : null}
      {sp.ok ? (
        <div className="mb-4 rounded-md border border-oliva/30 bg-oliva/10 px-4 py-2.5 text-sm text-oliva-escura">
          {sp.ok}
        </div>
      ) : null}

      {confirmarEncerrar ? (
        <Card className="mb-4 border-ambar/40 bg-ambar/10 p-4">
          <p className="text-sm">
            Encerrar este contrato no cadastro do Brisa?
          </p>
          <form
            action={encerrarContrato}
            className="mt-3 flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="id" value={contrato.id} />
            <label className="block text-xs font-medium text-tinta-suave">
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
              className="inline-flex items-center gap-1.5 rounded-md bg-erro px-3 py-1.5 text-sm font-medium text-white hover:bg-erro/85"
            >
              Confirmar encerramento
            </button>
            <Link href={`/contratos/${contrato.id}`} className={btnSecundario}>
              Cancelar
            </Link>
          </form>
        </Card>
      ) : null}

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Item rotulo="Status">{badgeStatus(contrato.status)}</Item>
          <Item rotulo="Locatário">
            {contrato.locatario?.nome ?? <Badge cor="slate">Desocupado</Badge>}
          </Item>
          <Item rotulo="CPF/CNPJ">{podeVerPii ? contrato.locatario?.cpfCnpj ?? "—" : "Acesso restrito"}</Item>
          <Item rotulo="Contato">{podeVerPii ? contrato.locatario?.contato ?? "—" : "Acesso restrito"}</Item>
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
        {podeVerPii && contrato.observacao ? (
          <div className="mt-4 border-t border-contorno/60 pt-3 text-sm text-tinta-suave">
            <span className="font-semibold">Observação:</span>{" "}
            {contrato.observacao}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

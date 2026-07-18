import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import {
  contratoDetalhe,
  empreendimentosAtivos,
  locatariosParaSelecao,
  unidadesParaSelecao,
} from "@/lib/consultas/locacao";
import { atualizarContrato } from "../../actions";
import { FormularioContrato } from "../../formulario-contrato";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ erro?: string }>;

export default async function PaginaEditarContrato({
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

  const [unidades, empreendimentos, locatarios] = await Promise.all([
    unidadesParaSelecao(),
    empreendimentosAtivos(),
    locatariosParaSelecao(),
  ]);

  return (
    <div>
      <PageHeader
        titulo={`Editar contrato — ${contrato.unidade.empreendimento.nome} · ${contrato.unidade.identificacao}`}
        descricao={contrato.locatario?.nome ?? "Desocupado"}
      />
      {sp.erro ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {sp.erro}
        </div>
      ) : null}
      <FormularioContrato
        action={atualizarContrato}
        contrato={contrato}
        unidades={unidades}
        empreendimentos={empreendimentos}
        locatarios={locatarios}
      />
    </div>
  );
}

import { PageHeader } from "@/components/ui";
import {
  empreendimentosAtivos,
  locatariosParaSelecao,
  unidadesParaSelecao,
} from "@/lib/consultas/locacao";
import { criarContrato } from "../actions";
import { FormularioContrato } from "../formulario-contrato";

type SearchParams = Promise<{ erro?: string }>;

export default async function PaginaNovoContrato({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const [unidades, empreendimentos, locatarios] = await Promise.all([
    unidadesParaSelecao(),
    empreendimentosAtivos(),
    locatariosParaSelecao(),
  ]);

  return (
    <div>
      <PageHeader
        titulo="Novo contrato"
        descricao="Vincule uma unidade (existente ou nova) a um locatário e defina os valores contratados"
      />
      {sp.erro ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {sp.erro}
        </div>
      ) : null}
      <FormularioContrato
        action={criarContrato}
        unidades={unidades}
        empreendimentos={empreendimentos}
        locatarios={locatarios}
      />
    </div>
  );
}

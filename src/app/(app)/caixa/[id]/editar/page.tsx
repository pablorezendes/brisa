/** /caixa/[id]/editar — mesmo formulário do novo lançamento, pré-preenchido. */
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { formatarCompetencia } from "@/lib/dominio/normalizacao";
import { buscarLancamento, categoriasPorCentro } from "@/lib/consultas/caixa";
import { salvarLancamento } from "../../actions";
import { FormLancamento } from "../../FormLancamento";

export default async function PaginaEditarLancamento({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [lancamento, categorias] = await Promise.all([
    buscarLancamento(id),
    categoriasPorCentro(),
  ]);
  if (!lancamento) notFound();

  return (
    <>
      <PageHeader
        titulo="Editar lançamento"
        descricao={`Livro-caixa CONTA_AC — ${formatarCompetencia(lancamento.mesReferencia)}`}
      />
      <Card className="max-w-2xl p-5">
        <FormLancamento
          acao={salvarLancamento}
          categoriasAL={categorias.AL}
          categoriasCH={categorias.CH}
          mes={lancamento.mesReferencia}
          inicial={lancamento}
        />
      </Card>
    </>
  );
}

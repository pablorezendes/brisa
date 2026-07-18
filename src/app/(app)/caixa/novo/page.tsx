/** /caixa/novo — formulário de novo lançamento (?mes=YYYY-MM pré-seleciona o mês). */
import { Card, PageHeader } from "@/components/ui";
import { formatarCompetencia } from "@/lib/dominio/normalizacao";
import { categoriasPorCentro, mesMaisRecente } from "@/lib/consultas/caixa";
import { salvarLancamento } from "../actions";
import { FormLancamento } from "../FormLancamento";

const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function PaginaNovoLancamento({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const sp = await searchParams;
  const mes = sp.mes && RE_MES.test(sp.mes) ? sp.mes : await mesMaisRecente();
  const categorias = await categoriasPorCentro();

  return (
    <>
      <PageHeader
        titulo="Novo lançamento"
        descricao={`Livro-caixa CONTA_AC — mês em foco: ${formatarCompetencia(mes)}`}
      />
      <Card className="max-w-2xl p-5">
        <FormLancamento
          acao={salvarLancamento}
          categoriasAL={categorias.AL}
          categoriasCH={categorias.CH}
          mes={mes}
        />
      </Card>
    </>
  );
}

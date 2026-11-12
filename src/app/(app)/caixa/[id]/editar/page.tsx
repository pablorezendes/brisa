import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { exigirPaginaAcesso, exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { Card, PageHeader } from "@/components/ui";
import { buscarLancamento, categoriasPorCentro } from "@/lib/consultas/caixa";
import { contemComissaoRestrita } from "@/lib/despesas/sigilo";
import { prisma } from "@/lib/db";
import { salvarLancamentoManual } from "../../actions";
import { FormLancamento } from "../../FormLancamento";

export default async function PaginaEditarLancamento({ params }: { params: Promise<{ id: string }> }) {
  await exigirPaginaAcesso("/caixa/[id]/editar");
  const acesso = await exigirPermissaoAcesso("caixa.editar", { global: true });
  const { id } = await params;
  const lancamento = await buscarLancamento(id);
  if (!lancamento?.criadoManualBrisa || lancamento.recebimentoManualId || lancamento.caixaOrigem === "BRISA:DESPESA") notFound();
  if (acesso.perfil !== "ADMINISTRADOR" && contemComissaoRestrita([lancamento.descricao, lancamento.categoria])) notFound();
  if (await prisma.recebimentoWidesysLocal.findUnique({ where: { lancamentoCaixaId: id }, select: { id: true } })) notFound();
  const categorias = await categoriasPorCentro();
  const permitida = (categoria: string) => acesso.perfil === "ADMINISTRADOR" || !contemComissaoRestrita(categoria);
  return (
    <>
      <PageHeader titulo="Editar movimento" />
      <Card className="max-w-2xl p-5">
        <FormLancamento
          acao={salvarLancamentoManual.bind(null, randomUUID())}
          categoriasAL={categorias.AL.filter(permitida)}
          categoriasCH={categorias.CH.filter(permitida)}
          categoriasBRISA={categorias.BRISA.filter(permitida)}
          mes={lancamento.mesReferencia}
          inicial={lancamento}
          manual
        />
      </Card>
    </>
  );
}

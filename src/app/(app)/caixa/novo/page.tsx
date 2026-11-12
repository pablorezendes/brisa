import { randomUUID } from "node:crypto";
import { exigirPaginaAcesso, exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { Card, PageHeader } from "@/components/ui";
import { categoriasPorCentro } from "@/lib/consultas/caixa";
import { hojeISO } from "@/lib/dominio/periodo";
import { contemComissaoRestrita } from "@/lib/despesas/sigilo";
import { salvarLancamentoManual } from "../actions";
import { FormLancamento } from "../FormLancamento";

const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function PaginaNovoLancamento({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  await exigirPaginaAcesso("/caixa/novo");
  const acesso = await exigirPermissaoAcesso("caixa.editar", { global: true });
  const { mes: selecionado } = await searchParams;
  const hoje = hojeISO();
  const mes = selecionado && RE_MES.test(selecionado) ? selecionado : hoje.slice(0, 7);
  const categorias = await categoriasPorCentro();
  const permitida = (categoria: string) => acesso.perfil === "ADMINISTRADOR" || !contemComissaoRestrita(categoria);
  return (
    <>
      <PageHeader titulo="Novo movimento" descricao="Registre uma entrada ou saída no caixa do Brisa." />
      <Card className="max-w-2xl p-5">
        <FormLancamento
          acao={salvarLancamentoManual.bind(null, randomUUID())}
          categoriasAL={categorias.AL.filter(permitida)}
          categoriasCH={categorias.CH.filter(permitida)}
          categoriasBRISA={categorias.BRISA.filter(permitida)}
          mes={mes}
          dataPadrao={mes === hoje.slice(0, 7) ? hoje : `${mes}-01`}
          manual
        />
      </Card>
    </>
  );
}

import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { exigirAcessoFiscal } from "@/lib/fiscal/acesso";
import { obterConfiguracaoFiscal } from "@/lib/fiscal/servico";
import { ROTA_FISCAL } from "@/lib/fiscal/dominio";
import { AvisoFiscal, FormularioRascunho, botaoFiscalSecundario } from "../_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Novo rascunho fiscal — Brisa" };

export default async function NovoFiscal({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  await exigirAcessoFiscal();
  const config = await obterConfiguracaoFiscal();
  const params = await searchParams;
  return <div><PageHeader titulo="Novo rascunho fiscal" descricao="Preencha apenas dados conferidos. Este passo reserva uma DPS, mas não transmite a nota." acoes={<Link className={botaoFiscalSecundario} href={ROTA_FISCAL}>Voltar</Link>}/><AvisoFiscal {...params}/>{config ? <FormularioRascunho/> : <Card className="p-6"><p className="mb-4 text-sm text-tinta">Cadastre e valide os parâmetros fiscais antes de criar o primeiro rascunho.</p><Link className={botaoFiscalSecundario} href={`${ROTA_FISCAL}/configuracao`}>Configurar emitente</Link></Card>}</div>;
}

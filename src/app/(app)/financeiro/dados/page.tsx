import Link from "next/link";
import { acessoAtual, exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { podeAbrirRota } from "@/lib/acesso/politica";
import { resumoAtalhoMigracaoWidesys } from "@/lib/consultas/operacao-widesys";
import { listarUnificados } from "@/lib/consultas/unificacao";
import { Card, PageHeader, btnPrimario, btnSecundario } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dados do Widesys — Brisa" };

const LISTAS = [
  { dominio: "RECEBER", titulo: "Contas a receber", rota: "/recebimentos" },
  { dominio: "PAGAR", titulo: "Contas a pagar", rota: "/financeiro/contas-a-pagar" },
  { dominio: "MOVIMENTO", titulo: "Entradas e saídas", rota: "/caixa" },
] as const;

const dataHora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export default async function PaginaConferirDados() {
  await exigirPaginaAcesso("/financeiro/dados");
  const acesso = await acessoAtual();
  const abrir = (rota: string) => podeAbrirRota(acesso, rota);
  const [captura, listas] = await Promise.all([
    resumoAtalhoMigracaoWidesys(),
    Promise.all(LISTAS.filter(lista => abrir(lista.rota)).map(async lista => ({
      ...lista,
      resumo: (await listarUnificados({ dominio: lista.dominio, porPagina: 1 })).resumo,
    }))),
  ]);

  return <div>
    <PageHeader
      titulo="Dados do Widesys"
      descricao="Acompanhe a última captura usada pelo financeiro e localize registros com inconsistências."
      acoes={abrir("/financeiro/migracao-widesys") ? <Link href="/financeiro/migracao-widesys" className={btnSecundario}>Detalhes da captura</Link> : undefined}
    />

    <Card className="mb-5 p-5">
      <h2 className="text-sm font-bold">Última captura importada</h2>
      <p className="mt-2 text-sm text-tinta-suave">{captura ? dataHora.format(captura.capturadoEm) : "Nenhuma captura registrada."}</p>
      <p className="mt-2 text-xs leading-relaxed text-tinta-suave">Os lançamentos financeiros refletem os dados importados em lote. Registre as correções no Widesys e importe uma captura atualizada para refletir as mudanças no Brisa.</p>
    </Card>

    <section className="grid gap-3 lg:grid-cols-3" aria-label="Registros financeiros">
      {listas.map(({ dominio, titulo, rota, resumo }) => <Card key={dominio} className="flex flex-col p-5" nivel={resumo.quarentena ? "atencao" : "neutro"}>
        <h2 className="text-base font-bold">{titulo}</h2>
        <dl className="my-4 space-y-2 text-xs text-tinta-suave">
          <div className="flex justify-between gap-3"><dt>Disponíveis</dt><dd className="font-semibold tabular-nums">{resumo.ativos.toLocaleString("pt-BR")}</dd></div>
          <div className="flex justify-between gap-3"><dt>Inconsistências na captura</dt><dd className="font-semibold tabular-nums">{resumo.quarentena.toLocaleString("pt-BR")}</dd></div>
        </dl>
        <div className="mt-auto flex flex-wrap gap-2">
          <Link href={rota} className={btnPrimario}>Ver lançamentos</Link>
          {resumo.quarentena > 0 ? <Link href={`${rota}?estado=QUARENTENA`} className={btnSecundario} aria-label={`Ver inconsistências em ${titulo.toLocaleLowerCase("pt-BR")}`}>Ver inconsistências</Link> : null}
        </div>
      </Card>)}
    </section>
  </div>;
}

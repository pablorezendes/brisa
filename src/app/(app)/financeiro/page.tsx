import Link from "next/link";
import { acessoAtual, exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { pode, podeAbrirRota } from "@/lib/acesso/politica";
import { podeExibirAcao } from "@/components/acao-autorizada";
import { IconeMenu, type IconeMenuNome } from "@/components/icones-menu";
import { Dinheiro, Kpi, PageHeader, SeletorMes, Sigilo } from "@/components/ui";
import { operacaoNaRequisicao } from "@/lib/consultas/operacao-na-requisicao";
import { listarUnificados } from "@/lib/consultas/unificacao";
import { formatarCompetencia } from "@/lib/dominio/normalizacao";
import { hojeISO } from "@/lib/dominio/periodo";
import { mesPadraoConsolidado } from "@/lib/unificacao/executivo-consolidado";
import { chavesRestritasUnificacao } from "@/lib/unificacao/privacidade";

export const metadata = { title: "Resumo financeiro — Brisa" };
export const dynamic = "force-dynamic";

const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const PERFIS_UNIFICACAO = ["ADMINISTRADOR", "FINANCEIRO"];

type Atalho = {
  titulo: string;
  descricao: string;
  href: string;
  icone?: IconeMenuNome;
  perfis?: string[];
};

export default async function PaginaFinanceiro({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  await exigirPaginaAcesso("/financeiro");
  const [sp, acesso] = await Promise.all([searchParams, acessoAtual()]);
  const podeConsolidar = podeExibirAcao(acesso, {
    permissao: "cadastros.sensiveis",
    perfis: PERFIS_UNIFICACAO,
  });
  const hoje = hojeISO();
  let mes = hoje.slice(0, 7);
  if (sp.mes && RE_MES.test(sp.mes)) {
    mes = sp.mes;
  } else if (podeConsolidar) {
    const operacao = await operacaoNaRequisicao();
    const restritas = pode(acesso, "comissoes.ver") ? new Set<string>() : chavesRestritasUnificacao(operacao.fontes, operacao.decisoes);
    mes = mesPadraoConsolidado(operacao.linhas.filter(linha => !restritas.has(linha.chave)), hoje);
  }
  const abrir = (href: string) => podeAbrirRota(acesso, href.split("?")[0]);
  const permitido = (atalho: Atalho) => abrir(atalho.href)
    && (!atalho.perfis || atalho.perfis.includes(acesso.perfil));
  const [receber, pagar, movimentos] = await Promise.all([
    podeConsolidar ? listarUnificados({ dominio: "RECEBER", mes, porPagina: 1 }) : null,
    podeConsolidar ? listarUnificados({ dominio: "PAGAR", mes, porPagina: 1 }) : null,
    podeConsolidar ? listarUnificados({ dominio: "MOVIMENTO", mes, porPagina: 1 }) : null,
  ]);
  const tarefas: Atalho[] = [
    { titulo: "Contas a receber", descricao: "Consulte valores e pagamentos recebidos.", href: `/recebimentos?mes=${mes}`, icone: "recebimentos" },
    { titulo: "Contas a pagar", descricao: "Confira obrigações e vencimentos.", href: `/financeiro/contas-a-pagar?mes=${mes}`, icone: "financeiro", perfis: PERFIS_UNIFICACAO },
    { titulo: "Entradas e saídas", descricao: "Veja os movimentos do dinheiro.", href: `/caixa?mes=${mes}`, icone: "caixa" },
    { titulo: "Cobranças", descricao: "Acompanhe saldos de locação em aberto.", href: `/paineis/cobranca?mes=${mes}`, icone: "cobranca" },
  ];
  const ferramentas: { titulo: string; itens: Atalho[] }[] = [
    {
      titulo: "Banco e boletos",
      itens: [
        { titulo: "Boletos", descricao: "Acompanhe boletos já emitidos no Sicoob.", href: `/financeiro/boletos?mes=${mes}` },
        { titulo: "Conferir pagamentos", descricao: "Compare pagamentos e confirmações do banco.", href: "/financeiro/conciliacao", perfis: PERFIS_UNIFICACAO },
        { titulo: "Contas bancárias", descricao: "Consulte as contas usadas na operação.", href: "/financeiro/contas-bancarias" },
      ],
    },
    {
      titulo: "Documentos e mensagens",
      itens: [
        { titulo: "Notas de serviço", descricao: "Consulte e acompanhe notas de serviços.", href: "/financeiro/notas-fiscais", perfis: ["ADMINISTRADOR"] },
        { titulo: "Mensagens de cobrança", descricao: "Acompanhe os envios e suas configurações.", href: "/financeiro/automacoes", perfis: ["ADMINISTRADOR"] },
      ],
    },
    {
      titulo: "Widesys",
      itens: [
        { titulo: "Dados do Widesys", descricao: "Veja a data da última captura e os registros com inconsistências.", href: "/financeiro/dados", perfis: PERFIS_UNIFICACAO },
      ],
    },
  ];
  const gruposVisiveis = ferramentas
    .map(grupo => ({ ...grupo, itens: grupo.itens.filter(permitido) }))
    .filter(grupo => grupo.itens.length > 0);
  const gestao: Atalho[] = [
    { titulo: "Executivo", descricao: "Indicadores de gestão", href: `/executivo?mes=${mes}` },
    { titulo: "Contratos e reajustes", descricao: "Contratos de locação", href: "/contratos?visao=locacao" },
  ].filter(permitido);

  return (
    <div>
      <PageHeader
        titulo="Resumo financeiro"
        descricao="Acompanhe contas a pagar, contas a receber e movimentos de caixa."
        acoes={<SeletorMes base="/financeiro" mes={mes} />}
      />

      <section className="mb-6" aria-labelledby="tarefas-financeiras">
        <h2 id="tarefas-financeiras" className="mb-3 text-base font-bold text-tinta">O que você precisa fazer?</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {tarefas.filter(permitido).map(tarefa => (
            <Link
              key={tarefa.href}
              href={tarefa.href}
              className="group rounded-xl border border-contorno bg-carta p-4 transition-colors hover:border-oliva hover:bg-[#f8faf9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oliva/30"
            >
              <div className="flex items-center gap-2 text-oliva-escura">
                {tarefa.icone && <IconeMenu nome={tarefa.icone} tamanho={19} />}
                <h3 className="text-sm font-bold">{tarefa.titulo}</h3>
                <span aria-hidden="true" className="ml-auto">→</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-tinta-suave">{tarefa.descricao}</p>
            </Link>
          ))}
        </div>
      </section>

      {receber && pagar && movimentos && (
        <section className="mb-6" aria-labelledby="valores-financeiros">
          <h2 id="valores-financeiros" className="text-base font-bold text-tinta">Valores do mês · {formatarCompetencia(mes)}</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Kpi
              rotulo="A receber em aberto"
              valor={<Dinheiro centavos={receber.resumo.aberto} />}
              detalhe={<Sigilo>{receber.resumo.ativos} registros aceitos</Sigilo>}
              href={abrir("/recebimentos") ? `/recebimentos?mes=${mes}` : undefined}
              ajuda="Saldo em aberto dos títulos válidos a receber."
            />
            <Kpi
              rotulo="A pagar em aberto"
              valor={<Dinheiro centavos={pagar.resumo.aberto} />}
              detalhe={<Sigilo>{pagar.resumo.ativos} registros aceitos</Sigilo>}
              href={abrir("/financeiro/contas-a-pagar") ? `/financeiro/contas-a-pagar?mes=${mes}` : undefined}
              ajuda="Saldo em aberto dos títulos válidos a pagar."
            />
            <Kpi
              rotulo="Saldo de entradas e saídas"
              valor={<Dinheiro centavos={movimentos.resumo.entradas - movimentos.resumo.saidas} />}
              detalhe="Entradas menos saídas aceitas"
              href={abrir("/caixa") ? `/caixa?mes=${mes}` : undefined}
              ajuda="Entradas menos saídas dos movimentos válidos."
            />
          </div>
        </section>
      )}

      {gruposVisiveis.length > 0 && (
        <details className="mb-5 rounded-xl border border-contorno bg-carta">
          <summary className="cursor-pointer px-5 py-4 text-sm font-bold text-tinta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oliva/30">
            Outras ferramentas
          </summary>
          <div className="grid gap-6 border-t border-contorno p-5 md:grid-cols-3">
            {gruposVisiveis.map(grupo => (
              <section key={grupo.titulo}>
                <h2 className="mb-3 text-xs font-bold text-tinta">{grupo.titulo}</h2>
                <ul className="space-y-3">
                  {grupo.itens.map(item => (
                    <li key={item.href}>
                      <Link href={item.href} className="text-sm font-semibold text-oliva-escura hover:underline">
                        {item.titulo} <span aria-hidden="true">→</span>
                      </Link>
                      <p className="mt-0.5 text-xs leading-relaxed text-tinta-suave">{item.descricao}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </details>
      )}

      {gestao.length > 0 && (
        <aside className="border-t border-contorno pt-4" aria-label="Gestão de locações">
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {gestao.map(item => (
              <Link key={item.href} href={item.href} className="text-xs font-semibold text-oliva-escura hover:underline">
                {item.titulo} <span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}

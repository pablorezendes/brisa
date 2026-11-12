import { exigirPaginaAcesso, exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Badge,
  Card,
  Dinheiro,
  Kpi,
  PageHeader,
  Sigilo,
  btnSecundario,
  inputBase,
} from "@/components/ui";
import { dadosAuditoriaOperacaoWidesys } from "@/lib/consultas/operacao-widesys";
import { perfilAtual } from "@/lib/autorizacao";
import type { EscopoOperacaoWidesys } from "@/lib/dominio/auditoria-widesys";
import type { Nivel } from "@/lib/dominio/semaforo";

export const metadata = { title: "Auditoria Widesys — Brisa" };
export const dynamic = "force-dynamic";

const ROTULOS_ESCOPO: Record<EscopoOperacaoWidesys, string> = {
  CONTRATO: "Contratos",
  CONTRATO_PARTE: "Partes dos contratos",
  TITULO_RECEBER: "Títulos a receber",
  TITULO_PAGAR: "Títulos a pagar",
  BAIXA_RECEBER: "Baixas de recebimentos",
  BAIXA_PAGAR: "Baixas de pagamentos",
  MOVIMENTO: "Movimentos",
};

function primeiro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

function pagina(valor: string | undefined): number {
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : 1;
}

function formatarData(valor: string | null): string {
  if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return "—";
  const [ano, mes, dia] = valor.split("-");
  return `${dia}/${mes}/${ano}`;
}

function formatarDataHora(valor: Date | null): string {
  if (!valor) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(valor);
}

function nivelLote(status: string): Nivel {
  if (status === "CONCLUIDO") return "otimo";
  if (status === "PROCESSANDO") return "info";
  if (status === "QUARENTENA") return "atencao";
  if (status === "FALHOU") return "critico";
  return "neutro";
}

function nivelImportacao(status: string): Nivel {
  if (status === "STAGING" || status === "RECONCILIADO" || status === "PROMOVIDO") return "info";
  if (status === "QUARENTENA") return "critico";
  if (status === "AUSENTE_NA_FONTE") return "atencao";
  return "neutro";
}

function rotuloStatus(status: string): string {
  return {
    STAGING: "staging",
    QUARENTENA: "quarentena",
    RECONCILIADO: "reconciliado",
    PROMOVIDO: "promovido",
    AUSENTE_NA_FONTE: "ausente na fonte",
    CONCLUIDO: "concluído",
    PROCESSANDO: "processando",
    FALHOU: "falhou",
  }[status] ?? status.toLocaleLowerCase("pt-BR").replaceAll("_", " ");
}

function hrefPagina(destino: number, estado: string, natureza: string): string {
  const query = new URLSearchParams();
  if (estado !== "todos") query.set("estado", estado);
  if (natureza !== "todos") query.set("natureza", natureza);
  if (destino > 1) query.set("pagina", String(destino));
  const texto = query.toString();
  return texto ? `/financeiro/migracao-widesys?${texto}` : "/financeiro/migracao-widesys";
}

function Paginacao({
  atual,
  total,
  estado,
  natureza,
  quantidade,
  porPagina,
}: {
  atual: number;
  total: number;
  estado: string;
  natureza: string;
  quantidade: number;
  porPagina: number;
}) {
  if (total <= 1) return null;
  const inicio = (atual - 1) * porPagina + 1;
  const fim = Math.min(quantidade, atual * porPagina);
  return (
    <nav
      aria-label="Paginação dos títulos importados"
      className="flex flex-col gap-2 border-t border-contorno px-5 py-3 text-[11px] sm:flex-row sm:items-center sm:justify-between"
    >
      <span className="text-tinta-suave">Mostrando {inicio}–{fim} de {quantidade}</span>
      <div className="flex items-center gap-3">
        {atual > 1 ? (
          <Link href={hrefPagina(atual - 1, estado, natureza)} className="font-bold text-oliva-escura hover:underline">
            ← Anterior
          </Link>
        ) : <span className="text-tinta-suave/50">← Anterior</span>}
        <span className="font-mono tabular-nums text-tinta-suave">{atual}/{total}</span>
        {atual < total ? (
          <Link href={hrefPagina(atual + 1, estado, natureza)} className="font-bold text-oliva-escura hover:underline">
            Próxima →
          </Link>
        ) : <span className="text-tinta-suave/50">Próxima →</span>}
      </div>
    </nav>
  );
}

export default async function PaginaAuditoriaWidesys({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirPaginaAcesso("/financeiro/migracao-widesys");
  await exigirPermissaoAcesso("cadastros.sensiveis", { global: true });
  const perfil = await perfilAtual();
  if (perfil !== "ADMINISTRADOR" && perfil !== "FINANCEIRO") notFound();

  const sp = await searchParams;
  const dados = await dadosAuditoriaOperacaoWidesys({
    pagina: pagina(primeiro(sp.pagina)),
    estado: primeiro(sp.estado),
    natureza: primeiro(sp.natureza),
  });
  const lote = dados.lote;
  const nivelAtual = lote ? nivelLote(lote.status) : "neutro";

  return (
    <div>
      <PageHeader
        titulo="Auditoria financeira Widesys"
        descricao="Acompanhe o processamento das capturas, os títulos importados e as ocorrências que precisam de correção no Widesys."
        acoes={<><Link href="/financeiro/dados" className={btnSecundario}>Dados do Widesys</Link><Link href="/financeiro" className={btnSecundario}>Voltar ao financeiro</Link></>}
      />

      {lote ? (
        <Card className="mb-4 p-5" nivel={nivelAtual}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge nivel={nivelAtual}>{rotuloStatus(lote.status)}</Badge>
                <span className="font-mono text-[10px] text-tinta-suave">captura {lote.capturaId}</span>
              </div>
              <h2 className="mt-3 text-lg font-bold tracking-[-0.02em] text-tinta">Último lote operacional</h2>
              <p className="mt-1 text-[11px] leading-relaxed text-tinta-suave">
                Capturado em {formatarDataHora(lote.capturadoEm)} · iniciado em {formatarDataHora(lote.iniciadoEm)} · atualizado em {formatarDataHora(lote.atualizadoEm)}.
              </p>
              {lote.erroCodigo ? (
                <p className="mt-2 text-[11px] font-semibold text-erro">Código de interrupção: {lote.erroCodigo}</p>
              ) : null}
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-3 text-right sm:grid-cols-4">
              <div><div className="text-[9px] font-bold uppercase tracking-[0.1em] text-tinta-suave">Esperado</div><div className="mt-1 font-mono text-lg font-bold">{lote.totalEsperado}</div></div>
              <div><div className="text-[9px] font-bold uppercase tracking-[0.1em] text-tinta-suave">Processado</div><div className="mt-1 font-mono text-lg font-bold">{lote.totalProcessado}</div></div>
              <div><div className="text-[9px] font-bold uppercase tracking-[0.1em] text-tinta-suave">Quarentena</div><div className="mt-1 font-mono text-lg font-bold">{lote.totalQuarentena}</div></div>
              <div><div className="text-[9px] font-bold uppercase tracking-[0.1em] text-tinta-suave">Lotes</div><div className="mt-1 font-mono text-lg font-bold">{dados.totalLotes}</div></div>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="mb-4 border-dashed p-5">
          <h2 className="text-[15px] font-bold text-tinta">Nenhum lote operacional aplicado</h2>
          <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-tinta-suave">
            As informações de processamento estarão disponíveis após a primeira captura importada.
          </p>
        </Card>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi
          rotulo="Registros preservados"
          valor={dados.totais.registrosAtuais}
          detalhe="Fotografia preservada da importação"
          nivel={dados.totais.registrosAtuais > 0 ? "info" : "neutro"}
          ajuda="Contagem dos contratos, partes, títulos, baixas e movimentos preservados da captura. Consulte os lançamentos na área financeira."
        />
        <Kpi
          rotulo="Quarentena atual"
          valor={dados.totais.quarentena}
          detalhe={`${dados.quarentenas.total} ocorrência(s) na trilha de lotes`}
          nivel={dados.totais.quarentena > 0 ? "critico" : dados.totais.registrosAtuais > 0 ? "otimo" : "neutro"}
          ajuda="Registros com dados inconsistentes que precisam de correção no Widesys."
        />
        <Kpi
          rotulo="Ausentes na fonte"
          valor={dados.totais.ausentes}
          nivel={dados.totais.ausentes > 0 ? "atencao" : "neutro"}
          ajuda="Itens presentes em captura anterior e ausentes na fotografia mais recente. Eles não são apagados."
        />
        <Kpi
          rotulo="Cobranças vencidas Widesys"
          valor={dados.inadimplencia.quantidade}
          detalhe={<Sigilo><Dinheiro centavos={dados.inadimplencia.valorAberto} /></Sigilo>}
          nivel={dados.inadimplencia.quantidade > 0 ? "critico" : dados.totais.registrosAtuais > 0 ? "otimo" : "neutro"}
          nota={dados.inadimplencia.emQuarentena > 0 ? `${dados.inadimplencia.emQuarentena} título(s) vencido(s) ficaram fora do indicador por estarem em quarentena.` : undefined}
          ajuda="Títulos aceitos no staging, vencidos e com saldo aberto. Quarentena e cobrança operacional atual não entram neste indicador."
        />
        <Kpi
          rotulo="Pagamentos vencidos Widesys"
          valor={dados.pagamentosVencidos.quantidade}
          detalhe={<Sigilo><Dinheiro centavos={dados.pagamentosVencidos.valorAberto} /></Sigilo>}
          nivel={dados.pagamentosVencidos.quantidade > 0 ? "atencao" : dados.totais.registrosAtuais > 0 ? "otimo" : "neutro"}
          nota={dados.pagamentosVencidos.emQuarentena > 0 ? `${dados.pagamentosVencidos.emQuarentena} título(s) vencido(s) ficaram fora do indicador por estarem em quarentena.` : undefined}
          ajuda="Contas a pagar aceitas no staging, vencidas e ainda abertas. Quarentena e cobranças contra inquilinos não entram neste indicador."
        />
      </div>

      <Card className="mb-4 overflow-hidden">
        <div className="border-b border-contorno px-5 py-4">
          <h2 className="text-[15px] font-bold text-tinta">Conferência da captura por escopo</h2>
          <p className="mt-0.5 text-[10px] text-tinta-suave">Contagens registradas na importação do Widesys.</p>
        </div>
        <div className="tabela-scroll overflow-x-auto" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}>
          <table className="tabela">
            <thead><tr><th>Escopo</th><th className="text-right">Fonte</th><th className="text-right">Atual</th><th className="text-right">Staging</th><th className="text-right">Quarentena</th><th className="text-right">Ausentes</th><th className="text-right">Soma fonte</th><th className="text-right">Soma aceita</th><th className="text-right">Saldo aberto</th></tr></thead>
            <tbody>
              {dados.escopos.map((linha) => {
                const monetario = !["CONTRATO", "CONTRATO_PARTE"].includes(linha.escopo);
                const titulo = linha.escopo === "TITULO_RECEBER" || linha.escopo === "TITULO_PAGAR";
                return (
                  <tr key={linha.escopo}>
                    <td className="font-semibold text-tinta">{ROTULOS_ESCOPO[linha.escopo]}</td>
                    <td className="text-right font-mono tabular-nums">{linha.quantidadeFonte}</td>
                    <td className="text-right font-mono tabular-nums">{linha.totalAtual}</td>
                    <td className="text-right font-mono tabular-nums">{linha.staging}</td>
                    <td className="text-right font-mono tabular-nums">{linha.quarentena}</td>
                    <td className="text-right font-mono tabular-nums">{linha.ausentes}</td>
                    <td className="text-right">{monetario ? <Sigilo><Dinheiro centavos={linha.somaFonte} /></Sigilo> : "—"}</td>
                    <td className="text-right">{monetario ? <Sigilo><Dinheiro centavos={linha.somaAceita} /></Sigilo> : "—"}</td>
                    <td className="text-right">{titulo ? <Sigilo><Dinheiro centavos={linha.somaAberto} /></Sigilo> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mb-4 overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-contorno px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-[15px] font-bold text-tinta">Títulos importados</h2>
            <p className="mt-0.5 text-[10px] text-tinta-suave">{dados.titulos.total} título(s) no filtro; sem nomes, documentos pessoais, contas bancárias ou snapshots.</p>
          </div>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="text-[10px] font-bold uppercase tracking-[0.08em] text-tinta-suave">Estado
              <select name="estado" defaultValue={dados.titulos.estado} className={`${inputBase} mt-1 min-w-40`}>
                <option value="todos">Todos</option>
                <option value="inadimplentes">Inadimplentes</option>
                <option value="quarentena">Quarentena</option>
                <option value="ausentes">Ausentes na fonte</option>
              </select>
            </label>
            <label className="text-[10px] font-bold uppercase tracking-[0.08em] text-tinta-suave">Natureza
              <select name="natureza" defaultValue={dados.titulos.natureza} className={`${inputBase} mt-1 min-w-36`}>
                <option value="todos">Receber e pagar</option>
                <option value="RECEBER">A receber</option>
                <option value="PAGAR">A pagar</option>
              </select>
            </label>
            <button type="submit" className={btnSecundario}>Filtrar</button>
          </form>
        </div>
        {dados.titulos.itens.length === 0 ? (
          <div className="px-5 py-10 text-center text-[12px] text-tinta-suave">Nenhum título encontrado neste filtro.</div>
        ) : (
          <div className="tabela-scroll overflow-x-auto" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}>
            <table className="tabela">
              <thead><tr><th>Título</th><th>Origem</th><th>Natureza</th><th>Vencimento</th><th>Situação</th><th className="text-right">Devido</th><th className="text-right">Pago</th><th className="text-right">Aberto</th><th>Importação</th></tr></thead>
              <tbody>
                {dados.titulos.itens.map((titulo) => (
                  <tr key={titulo.id}>
                    <td>
                      <div className="font-mono text-[11px] font-semibold text-tinta">{titulo.numeroDocumento ?? `legado ${titulo.legadoId}`}</div>
                      <div className="mt-0.5 text-[9px] text-tinta-suave">{titulo.parcela ? `parcela ${titulo.parcela} · ` : ""}captura {formatarDataHora(titulo.capturadoEm)}</div>
                    </td>
                    <td><Badge cor="azul">Widesys</Badge></td>
                    <td><Badge cor={titulo.natureza === "RECEBER" ? "verde" : "azul"}>{titulo.natureza === "RECEBER" ? "a receber" : "a pagar"}</Badge></td>
                    <td>{formatarData(titulo.vencimento)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge cor={titulo.inadimplente ? "vermelho" : titulo.situacaoNormalizada === "PAGO" ? "verde" : "slate"}>{titulo.situacaoNormalizada.toLocaleLowerCase("pt-BR")}</Badge>
                        {titulo.pagamentoParcial ? <Badge cor="ambar">parcial</Badge> : null}
                      </div>
                    </td>
                    <td className="text-right"><Sigilo><Dinheiro centavos={titulo.valorDevido} /></Sigilo></td>
                    <td className="text-right"><Sigilo><Dinheiro centavos={titulo.valorPago} /></Sigilo></td>
                    <td className="text-right"><Sigilo><Dinheiro centavos={titulo.valorAberto} destaque /></Sigilo></td>
                    <td>
                      <Badge nivel={nivelImportacao(titulo.statusImportacao)}>{rotuloStatus(titulo.statusImportacao)}</Badge>
                      {titulo.quarentenaMotivo ? <div className="mt-1 max-w-64 font-mono text-[9px] leading-snug text-erro">{titulo.quarentenaMotivo}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Paginacao atual={dados.titulos.pagina} total={dados.titulos.totalPaginas} estado={dados.titulos.estado} natureza={dados.titulos.natureza} quantidade={dados.titulos.total} porPagina={dados.titulos.porPagina} />
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-contorno px-5 py-4">
          <h2 className="text-[15px] font-bold text-tinta">Quarentenas recentes</h2>
          <p className="mt-0.5 text-[10px] text-tinta-suave">Últimas {dados.quarentenas.recentes.length} de {dados.quarentenas.total} ocorrência(s) preservadas na trilha de lotes.</p>
        </div>
        {dados.quarentenas.recentes.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12px] text-tinta-suave">Nenhuma quarentena registrada.</div>
        ) : (
          <div className="tabela-scroll overflow-x-auto" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}>
            <table className="tabela">
              <thead><tr><th>Escopo</th><th>ID legado</th><th>Ação</th><th>Motivo</th><th>Captura</th><th>Processado em</th></tr></thead>
              <tbody>
                {dados.quarentenas.recentes.map((item) => (
                  <tr key={item.id}>
                    <td><Badge cor="vermelho">{ROTULOS_ESCOPO[item.escopo as EscopoOperacaoWidesys] ?? item.escopo}</Badge></td>
                    <td className="font-mono text-[11px]">{item.legadoId}</td>
                    <td>{item.acao.toLocaleLowerCase("pt-BR").replaceAll("_", " ")}</td>
                    <td className="max-w-80 font-mono text-[10px] text-erro">{item.motivo ?? "Motivo não informado"}</td>
                    <td className="font-mono text-[10px] text-tinta-suave">{item.capturaId}</td>
                    <td>{formatarDataHora(item.processadoEm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-4 text-[10px] leading-relaxed text-tinta-suave">
        Esta visão deliberadamente não carrega snapshots técnicos, URLs da origem, nomes de pessoas, documentos pessoais, contas bancárias ou chaves PIX. Os valores permanecem protegidos pelo controle de sigilo da interface.
      </p>
    </div>
  );
}

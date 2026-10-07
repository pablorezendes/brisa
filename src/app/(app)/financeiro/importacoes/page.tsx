import { exigirPaginaAcesso } from "@/lib/acesso/servidor";
import Link from "next/link";
import { Badge, Card, Dinheiro, PageHeader, Sigilo, btnSecundario, inputBase } from "@/components/ui";
import { listarImportacoesPlanilha } from "@/lib/consultas/importacoes-planilha";

export const dynamic = "force-dynamic";
export const metadata = { title: "Importações de planilhas — Brisa" };

const ROTULOS_STATUS: Record<string, string> = {
  IMPORTADO: "Importado", JA_EXISTENTE: "Já existente", PENDENTE: "A conferir",
};

function destino(pagina: number, filtros: { lote: string; status: string; porPagina: number }) {
  const query = new URLSearchParams({ pagina: String(pagina), limite: String(filtros.porPagina) });
  if (filtros.lote) query.set("lote", filtros.lote);
  if (filtros.status) query.set("status", filtros.status);
  return `/financeiro/importacoes?${query}`;
}

function dataHora(data: Date) {
  return data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

export default async function PaginaImportacoes({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirPaginaAcesso("/financeiro/importacoes");
  const dados = await listarImportacoesPlanilha(await searchParams);
  const lote = dados.lotes.find(item => item.id === dados.filtros.lote);
  return <div>
    <PageHeader titulo="Importações de planilhas" descricao="Rastreabilidade da carga: o que entrou no caixa, o que já existia e o que precisa de conferência. A consulta não altera os registros." acoes={<Link href="/financeiro" className={btnSecundario}>Voltar ao financeiro</Link>} />

    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        ["Linhas preservadas", dados.totais.linhas, "Origem rastreável por arquivo e célula"],
        ["Importadas", dados.totais.importados, "Novos lançamentos criados no caixa"],
        ["Já existentes", dados.totais.existentes, "Reconhecidas sem criar uma nova soma"],
        ["A conferir", dados.totais.pendentes, "Não participam do saldo do caixa"],
      ].map(([titulo, valor, descricao]) => <Card key={String(titulo)} className="p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-tinta-suave">{titulo}</p>
        <p className="mt-2 font-mono text-2xl font-bold tabular-nums">{valor}</p>
        <p className="mt-1 text-xs text-tinta-suave">{descricao}</p>
      </Card>)}
    </div>

    <Card className="mb-4 p-4" nivel="info">
      <p className="text-sm font-semibold">Conferência antes de somar</p>
      <p className="mt-1 text-xs leading-relaxed text-tinta-suave">Pendências ficam fora da operação. Compare a planilha original, a data, o histórico e a origem do registro antes de resolver uma possível repetição. Nome ou valor semelhante não comprovam que seja o mesmo lançamento.</p>
      <p className="mt-2 text-xs font-semibold">Carga parcial de lançamentos: os totais da planilha não significam saldo conciliado.</p>
      <p className="mt-1 text-xs leading-relaxed text-tinta-suave">Saldos iniciais, resumos e subtotais ficam fora dos lançamentos. A carga preserva seus controles, mas uma fórmula quebrada ou não conferida não é uma validação do saldo. Acompanhe as limitações por lote abaixo.</p>
      {dados.totais.reservados > 0 ? <p className="mt-2 text-xs text-tinta-suave">{dados.totais.reservados} linha(s) com conteúdo reservado. Valores e detalhes de comissões não são exibidos neste módulo.</p> : null}
    </Card>

    {dados.lotes.length > 0 ? <Card className="mb-4 overflow-hidden">
      <div className="border-b border-contorno p-4"><h2 className="text-sm font-bold">Lotes e controles de conferência</h2><p className="mt-1 text-xs text-tinta-suave">Contagens de verificações, sem publicar valores ou fórmulas da origem. Uma mesma célula pode ter mais de uma limitação.</p></div>
      <div className="tabela-scroll overflow-x-auto" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}><table className="tabela">
        <thead><tr><th>Arquivo e carga</th><th>Linhas</th><th>Controles</th><th>Limitações encontradas</th></tr></thead>
        <tbody>{dados.lotes.map(item => <tr key={item.id}>
          <td><Link href={`/financeiro/importacoes?lote=${encodeURIComponent(item.id)}`} className="text-xs font-semibold text-oliva-escura hover:underline">{item.arquivo}</Link><p className="mt-1 text-[10px] text-tinta-suave">{dataHora(item.criadoEm)}</p></td>
          <td className="font-mono text-xs">{item._count.linhas}</td><td className="font-mono text-xs">{item.controles.total}</td>
          <td className="whitespace-normal! text-xs"><div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>{item.controles.divergencias} divergência(s)</span><span>{item.controles.semResultado} sem resultado válido</span><span>{item.controles.formulasNaoConferidas} fórmula(s) não conferida(s)</span>
          </div>{item.controles.ilegivel ? <p className="mt-1 font-semibold text-erro">Parte da evidência de controle não pôde ser interpretada.</p> : null}</td>
        </tr>)}</tbody>
      </table></div>
    </Card> : null}

    <Card className="mb-4 p-4">
      <form className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_180px_130px_auto]" action="/financeiro/importacoes">
        <label className="grid gap-1.5 text-xs font-semibold">Lote
          <select name="lote" defaultValue={dados.filtros.lote} className={inputBase}>
            <option value="">Todos os lotes ({dados.totalLotes})</option>
            {dados.lotes.map(item => <option key={item.id} value={item.id}>{item.arquivo} · {dataHora(item.criadoEm)} · {item._count.linhas} linhas</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-xs font-semibold">Situação
          <select name="status" defaultValue={dados.filtros.status} className={inputBase}>
            <option value="">Todas</option>
            {Object.entries(ROTULOS_STATUS).map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-xs font-semibold">Por página
          <select name="limite" defaultValue={dados.filtros.porPagina} className={inputBase}><option value="30">30 linhas</option><option value="50">50 linhas</option></select>
        </label>
        <button type="submit" className={btnSecundario}>Filtrar</button>
      </form>
      {dados.totalLotes > 50 ? <p className="mt-2 text-xs text-tinta-suave">O seletor mostra os 50 lotes mais recentes; a consulta “Todos os lotes” inclui o histórico completo.</p> : null}
      {lote ? <details className="mt-3 border-t border-contorno pt-3 text-xs">
        <summary className="cursor-pointer font-semibold">Identificação técnica do lote</summary>
        <dl className="mt-2 grid gap-2 text-tinta-suave">
          <div><dt className="font-semibold">Arquivo</dt><dd className="break-words">{lote.arquivo}</dd></div>
          <div><dt className="font-semibold">SHA-256 do arquivo</dt><dd className="break-all font-mono">{lote.hashArquivo}</dd></div>
          <div><dt className="font-semibold">Versão do extrator</dt><dd>{lote.versao}</dd></div>
          <div><dt className="font-semibold">Registrado em</dt><dd>{dataHora(lote.criadoEm)}</dd></div>
        </dl>
      </details> : null}
    </Card>

    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-contorno p-4">
        <h2 className="text-sm font-bold">Trilha da carga</h2>
        <span className="text-xs text-tinta-suave">{dados.quantidade} linha(s) nesta consulta · somente leitura</span>
      </div>
      <div className="tabela-scroll overflow-x-auto" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}><table className="tabela tabela--acoes">
        <thead><tr><th>Origem</th><th>Descrição</th><th>Referência</th><th>Situação</th><th className="text-right">Valor</th><th><span className="sr-only">Conferência</span></th></tr></thead>
        <tbody>{dados.linhas.map(linha => <tr key={linha.id}>
          <td><div className="max-w-64 break-words text-xs font-semibold">{linha.arquivo}</div><div className="mt-1 text-[11px] text-tinta-suave">{linha.reservado ? `Linha ${linha.linha}` : `${linha.aba} · linha ${linha.linha} · ${linha.faixa}`}</div></td>
          <td className="max-w-80 whitespace-normal!"><span className="text-xs">{linha.reservado ? "Conteúdo reservado" : linha.conteudo?.descricao || linha.conteudo?.cliente || linha.conteudo?.categoria || "Sem descrição"}</span>{!linha.reservado && linha.conteudo ? <><div className="mt-1 text-[10px] text-tinta-suave">{linha.conteudo.tipo === "SAIDA" ? "Saída" : linha.conteudo.tipo === "ENTRADA" ? "Entrada" : "Recebimento em dinheiro"} · {linha.conteudo.centroCusto}</div><div className="mt-1 break-words font-mono text-[10px] text-tinta-suave">{linha.conteudo.caixaOrigem}</div></> : null}</td>
          <td className="font-mono text-xs">{linha.reservado ? "—" : linha.conteudo?.data || linha.conteudo?.mesReferencia || "Não definida"}</td>
          <td><Badge cor={linha.status === "IMPORTADO" ? "verde" : linha.status === "JA_EXISTENTE" ? "azul" : "ambar"}>{ROTULOS_STATUS[linha.status] ?? "A conferir"}</Badge></td>
          <td className="text-right">{linha.reservado ? "—" : <Sigilo><Dinheiro centavos={linha.conteudo?.valor} /></Sigilo>}</td>
          <td><Link href={`/financeiro/importacoes/${linha.id}`} prefetch={false} className="text-xs font-semibold text-oliva-escura hover:underline">Conferir origem →</Link></td>
        </tr>)}
        {dados.linhas.length === 0 ? <tr><td colSpan={6} className="py-12! text-center! text-sm text-tinta-suave">{dados.totalLotes === 0 ? "Nenhuma carga de planilha registrada ainda." : "Nenhuma linha corresponde aos filtros selecionados."}</td></tr> : null}
        </tbody>
      </table></div>
      <nav aria-label="Paginação das linhas importadas" className="flex flex-wrap items-center justify-between gap-3 border-t border-contorno p-4 text-xs">
        <span className="text-tinta-suave">Página {dados.filtros.pagina} de {dados.totalPaginas}</span>
        <div className="flex items-center gap-4">
          {dados.filtros.pagina > 1 ? <Link href={destino(dados.filtros.pagina - 1, dados.filtros)} className="font-semibold text-oliva-escura">← Anterior</Link> : null}
          {dados.filtros.pagina < dados.totalPaginas ? <Link href={destino(dados.filtros.pagina + 1, dados.filtros)} className="font-semibold text-oliva-escura">Próxima →</Link> : null}
        </div>
      </nav>
    </Card>
  </div>;
}

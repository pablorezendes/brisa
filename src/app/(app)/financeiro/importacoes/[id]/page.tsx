import { exigirPaginaAcesso } from "@/lib/acesso/servidor";
import Link from "next/link";
import { Badge, Card, Dinheiro, PageHeader, Sigilo, btnSecundario } from "@/components/ui";
import { detalheImportacaoPlanilha } from "@/lib/consultas/importacoes-planilha";
import { ExcluirRegistroLink } from "@/components/excluir-registro-link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Origem da linha importada — Brisa" };

export default async function PaginaOrigemImportacao({ params }: { params: Promise<{ id: string }> }) {
  await exigirPaginaAcesso("/financeiro/importacoes/[id]");
  const registro = await detalheImportacaoPlanilha((await params).id);
  const dados = registro.detalhe;
  const volta = `/financeiro/importacoes?lote=${encodeURIComponent(registro.loteId)}`;
  return <div>
    <PageHeader titulo="Origem da linha importada" descricao="Consulta da evidência preservada na carga. Esta página não cria lançamentos, não vincula registros e não altera o caixa." acoes={<Link href={volta} className={btnSecundario}>Voltar ao lote</Link>} />
    {registro.reservado || !dados ? <Card className="p-6" nivel="info">
      <h2 className="text-lg font-bold">Conteúdo reservado</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-tinta-suave">Os dados desta linha não são exibidos na auditoria geral. Informações de comissões ficam exclusivamente no menu Comissões, com acesso restrito.</p>
      <Link href="/financeiro/comissoes" className="mt-4 inline-block text-sm font-semibold text-oliva-escura hover:underline">Abrir Comissões →</Link>
    </Card> : <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-base font-bold">Localização exata na planilha</h2>
          <Badge cor={registro.status === "IMPORTADO" ? "verde" : registro.status === "JA_EXISTENTE" ? "azul" : "ambar"}>{registro.status === "IMPORTADO" ? "Importado" : registro.status === "JA_EXISTENTE" ? "Já existente" : "A conferir"}</Badge>
        </div>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          {[
            ["Arquivo", registro.arquivo], ["Aba", registro.aba],
            ["Linha", String(registro.linha)], ["Células", dados.celulas],
            ["Faixa", registro.faixa], ["Caixa de origem", dados.caixaOrigem],
            ["Mês de referência", dados.mesReferencia], ["Data", dados.data],
            ["Natureza", dados.tipo === "SAIDA" ? "Saída" : dados.tipo === "ENTRADA" ? "Entrada" : "Recebimento em dinheiro"],
            ["Centro de custo", dados.centroCusto], ["Categoria", dados.categoria], ["Local", dados.local],
          ].map(([rotulo, valor]) => <div key={rotulo}><dt className="text-[10px] font-bold uppercase tracking-wider text-tinta-suave">{rotulo}</dt><dd className="mt-1 break-words">{valor || "Não informado"}</dd></div>)}
          <div className="sm:col-span-2"><dt className="text-[10px] font-bold uppercase tracking-wider text-tinta-suave">Descrição / identificação</dt><dd className="mt-1 whitespace-pre-wrap break-words">{dados.descricao || dados.cliente || "Não informada"}</dd></div>
          <div><dt className="text-[10px] font-bold uppercase tracking-wider text-tinta-suave">Valor preservado na origem</dt><dd className="mt-1 text-xl font-bold"><Sigilo><Dinheiro centavos={dados.valor} /></Sigilo></dd></div>
        </dl>
        <details className="mt-5 border-t border-contorno pt-4 text-xs"><summary className="cursor-pointer font-semibold">Identificação da evidência</summary><p className="mt-2 break-all font-mono text-tinta-suave">SHA-256 do conteúdo: {dados.hashConteudo}</p><p className="mt-2 text-tinta-suave">O arquivo original e a fotografia mínima da linha são preservados. Fórmulas, resultados internos e dados brutos não são publicados nesta tela. Uma edição posterior no caixa não reescreve esta fotografia: os dados exibidos aqui são os da origem no momento da carga.</p></details>
      </Card>
      <div className="grid content-start gap-4">
        <Card className="p-5" nivel={registro.status === "PENDENTE" ? "atencao" : "info"}>
          <h2 className="text-base font-bold">Efeito desta carga</h2>
          <p className="mt-2 text-sm leading-relaxed text-tinta-suave">{registro.status === "IMPORTADO" ? "Um novo lançamento foi criado no caixa a partir desta linha." : registro.status === "JA_EXISTENTE" ? "A origem foi reconhecida como um lançamento já existente. Nenhum valor foi somado novamente." : "Esta linha permanece em conferência e não participa do saldo nem dos indicadores do caixa."}</p>
          {dados.lancamentoCaixaId && dados.mesReferencia ? <Link href={`/caixa?mes=${encodeURIComponent(dados.mesReferencia)}`} className="mt-3 inline-block text-sm font-semibold text-oliva-escura hover:underline">Consultar caixa do período →</Link> : null}
          {dados.lancamentoCaixaId && <div className="mt-3"><ExcluirRegistroLink tipo="CAIXA" origemId={dados.lancamentoCaixaId}>Excluir lançamento vinculado</ExcluirRegistroLink><p className="mt-1 text-xs text-tinta-suave">A evidência da importação continua preservada; a decisão retira somente o lançamento da operação atual.</p></div>}
          {dados.motivos.length > 0 ? <ul className="mt-4 grid list-disc gap-2 pl-4 text-xs leading-relaxed text-tinta-suave">{dados.motivos.map(motivo => <li key={motivo}>{motivo}</li>)}</ul> : null}
        </Card>
        {dados.candidatos.length > 0 ? <Card className="p-5">
          <h2 className="text-sm font-bold">Referências para comparação</h2>
          <p className="mt-2 text-xs leading-relaxed text-tinta-suave">São sugestões de conferência, não vínculos aprovados. Compare conta, data, histórico e evidência de origem; coincidência de valor não comprova duplicidade.</p>
          <ul className="mt-3 grid gap-2">{dados.candidatos.map(chave => <li key={chave}><Link href={`/unificacao/${encodeURIComponent(chave)}`} prefetch={false} className="break-all font-mono text-[11px] text-oliva-escura hover:underline">{chave} →</Link></li>)}</ul>
        </Card> : null}
        {registro.status === "PENDENTE" ? <Card className="p-5">
          <h2 className="text-sm font-bold">Como conferir</h2>
          <ol className="mt-3 grid list-decimal gap-2 pl-4 text-xs leading-relaxed text-tinta-suave"><li>Abra o arquivo e confira a aba, a linha e as células indicadas.</li><li>Verifique a qual caixa o movimento pertence e se já foi realizado.</li><li>Compare com os registros existentes e documente a evidência antes de aprovar uma nova carga.</li></ol>
          <p className="mt-3 text-xs text-tinta-suave">Não há aprovação automática ou botão de mesclagem nesta consulta.</p>
        </Card> : null}
      </div>
    </div>}
  </div>;
}

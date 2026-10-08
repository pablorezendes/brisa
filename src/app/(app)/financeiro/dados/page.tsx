import Link from "next/link";
import { acessoAtual, exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { podeAbrirRota } from "@/lib/acesso/politica";
import { organizacaoDosDados } from "@/lib/consultas/unificacao";
import { ROTULOS_ORIGEM_DADOS } from "@/lib/unificacao/origens";
import { ROTULOS_DOMINIO } from "@/lib/unificacao/tipos";
import { Badge, Card, PageHeader, btnPrimario, btnSecundario } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organizar dados — Brisa" };
const data = (valor: Date | null | undefined) => valor ? valor.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "Ainda não registrada";

export default async function PaginaOrganizarDados() {
  await exigirPaginaAcesso("/financeiro/dados");
  const [dados, acesso] = await Promise.all([organizacaoDosDados(), acessoAtual()]);
  const abrir = (rota: string) => podeAbrirRota(acesso, rota);
  const temPendencias = dados.pendentes + dados.inconsistentes > 0;
  return <div>
    <PageHeader titulo="Organizar dados" descricao="Veja de onde veio cada informação, o que entra nos totais e o que ainda precisa de uma decisão." acoes={<Link href="/financeiro" className={btnSecundario}>Voltar ao financeiro</Link>} />
    <Card nivel={temPendencias ? "atencao" : "info"} className="mb-5 p-5">
      <div className="flex flex-wrap items-center gap-3"><Badge cor={temPendencias ? "ambar" : "azul"}>{temPendencias ? "Consolidação parcial" : "Sem pendências detectadas nesta análise"}</Badge><h2 className="text-lg font-bold">Importado não significa conferido</h2></div>
      <p className="mt-3 max-w-4xl text-sm leading-relaxed text-tinta-suave">Os registros aceitos já participam da visão unificada. Possíveis repetições e inconsistências ficam separados para revisão. Uma inclusão automática não comprova conciliação bancária nem fechamento contábil.</p>
      <p className="mt-2 text-xs text-tinta-suave">Esta página consulta o banco deste ambiente, não o Widesys ao vivo. Última análise registrada: {data(dados.ultimaAnalise)}.</p>
    </Card>

    <section className="mb-6" aria-labelledby="origens-dados"><h2 id="origens-dados" className="mb-3 text-base font-bold">1. Identifique de onde veio</h2>
      <div className="grid gap-3 md:grid-cols-3">{dados.origens.map(origem => <Card key={origem.origem} className="flex flex-col p-5">
        <h3 className="font-semibold">{ROTULOS_ORIGEM_DADOS[origem.origem]}</h3>
        <p className="numero-card mt-3 text-2xl font-bold">{origem.quantidade.toLocaleString("pt-BR")}</p><p className="text-xs text-tinta-suave">referências financeiras identificadas</p>
        <p className="my-3 flex-1 text-xs leading-relaxed text-tinta-suave">{origem.origem === "PLANILHA" ? "Arquivo Excel comprovado. Confira arquivo, aba e linha quando preservada pela importação. As abas de caixas distintos continuam separadas." : origem.origem === "WIDESYS" ? "Dados capturados do sistema anterior. A data da captura indica até quando a informação foi observada." : "Registro existente no Brisa sem prova suficiente do arquivo de origem. Não é classificado como lançamento manual por suposição."}</p>
        <Link href={`/unificacao?origem=${origem.origem}`} className={btnSecundario}>Ver registros desta origem</Link>
      </Card>)}</div>
      <p className="mt-2 text-xs text-tinta-suave">Um registro vinculado pode ter mais de uma origem. Não some essas contagens: elas não representam lançamentos adicionais.</p>
    </section>

    <Card className="mb-6 overflow-hidden">
      <div className="border-b border-contorno p-5"><h2 className="font-bold">2. Entenda o que entra nos totais</h2><p className="mt-1 text-xs text-tinta-suave">Todas as competências da visão unificada. São contagens, não valores. Cobrança, pagamento e movimento não devem ser somados como se fossem receitas diferentes.</p></div>
      <div className="tabela-scroll overflow-x-auto" tabIndex={0} role="region" aria-label="Situação da consolidação financeira"><table className="tabela tabela--acoes">
        <thead><tr><th>Tipo</th><th>Incluídos nos totais</th><th>Precisam conferir</th><th>Inconsistentes</th><th>Cópias vinculadas</th><th>Sem efeito / ausentes</th><th>Ação</th></tr></thead>
        <tbody>{dados.dominios.map(d => <tr key={d.dominio}><td>{ROTULOS_DOMINIO[d.dominio]}</td><td>{d.incluidos}</td><td>{d.pendentes}</td><td>{d.inconsistentes}</td><td>{d.vinculados}</td><td>{d.semEfeito} / {d.ausentes}</td><td><Link href={`/unificacao?dominio=${d.dominio}&estado=PENDENTE`} className="text-sm font-semibold text-oliva-escura hover:underline">Conferir →</Link></td></tr>)}</tbody>
      </table></div>
      <p className="border-t border-contorno p-4 text-xs leading-relaxed text-tinta-suave">Cópias vinculadas permanecem no histórico sem uma segunda soma. Transferências, cancelamentos e registros informativos podem ficar sem efeito no saldo. Exclusões com histórico ficam fora desta projeção.</p>
    </Card>

    <section className="mb-6" aria-labelledby="revisao-dados"><h2 id="revisao-dados" className="mb-3 text-base font-bold">3. Escolha o que precisa resolver</h2>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-5"><h3 className="font-semibold">Dois registros parecem iguais?</h3><p className="mt-2 mb-4 text-sm text-tinta-suave">Compare origem, pessoa, imóvel, data e conta. Confirme “É o mesmo registro” para manter um principal ou “São registros diferentes” para preservar ambos.</p><Link href="/unificacao?estado=PENDENTE" className={btnPrimario}>Comparar possíveis duplicados</Link></Card>
        <Card className="p-5"><h3 className="font-semibold">Precisa excluir um cadastro ou lançamento?</h3><p className="mt-2 mb-4 text-sm text-tinta-suave">Busque pelo nome ou descrição, confira os vínculos e informe o motivo. A exclusão mantém o histórico e pode ser restaurada pelo administrador. Pagamentos e meses fechados têm proteção.</p>{abrir("/cadastros/governanca") ? <Link href="/cadastros/governanca" className={btnSecundario}>Excluir ou restaurar com revisão</Link> : <p className="text-xs font-semibold">Solicite a um usuário com permissão de revisão e exclusão.</p>}</Card>
        <Card className="p-5"><h3 className="font-semibold">Linha do Excel ainda não entrou?</h3><p className="mt-2 mb-3 text-sm text-tinta-suave">{dados.planilhas.pendentes} ocorrências pendentes foram preservadas no histórico dos lotes, sem conteúdo reservado. Naquela carga, não criaram lançamentos no caixa.</p><p className="mb-4 text-xs leading-relaxed text-tinta-suave">Uma carga posterior pode ter corrigido a mesma linha; por isso, esta contagem histórica não é uma fila líquida de pendências atuais. Confira o lote e os registros existentes antes de importar outra vez.</p>{abrir("/financeiro/importacoes") && acesso.perfil === "ADMINISTRADOR" ? <Link href="/financeiro/importacoes?status=PENDENTE" className={btnSecundario}>Conferir histórico do Excel</Link> : <p className="text-xs font-semibold">A conferência dos arquivos é restrita ao administrador.</p>}</Card>
      </div>
    </section>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5"><h2 className="font-bold">Por que alguns painéis mostram outra base?</h2><p className="mt-3 text-sm leading-relaxed text-tinta-suave">Contas a receber, a pagar e movimentações na visão unificada usam os registros aceitos das fontes. O Executivo, as locações e o livro original preservam a base de gestão já utilizada, com suas regras de apuração. Não some os dois painéis e não espere igualdade enquanto houver correspondências pendentes.</p><p className="mt-3 text-xs text-tinta-suave">Não alteramos cálculos nem aprovamos correspondências automaticamente para fazer os números coincidirem.</p></Card>
      <Card className="p-5"><h2 className="font-bold">Atualização das fontes</h2><dl className="mt-3 space-y-3 text-sm"><div><dt className="font-semibold">Última carga Excel</dt><dd className="text-tinta-suave">{data(dados.ultimoExcel)}</dd></div><div><dt className="font-semibold">Última captura Widesys importada</dt><dd className="text-tinta-suave">{data(dados.ultimoWidesys?.capturadoEm)}{dados.ultimoWidesys ? ` · ${dados.ultimoWidesys.status === "CONCLUIDO" ? "lote concluído" : dados.ultimoWidesys.status === "QUARENTENA" ? "lote com inconsistências" : "lote requer conferência"}` : ""}</dd></div></dl><p className="mt-3 text-xs leading-relaxed text-tinta-suave">O conector atual trabalha por capturas em lote. Não há sincronização contínua ativada nesta versão. “Atualizar análise” revisa o que já está no Brisa; não busca novos dados no Widesys. O diagnóstico de conexão é executado separadamente no servidor.</p>{abrir("/financeiro/migracao-widesys") && <Link href="/financeiro/migracao-widesys" className="mt-4 inline-block text-sm font-semibold text-oliva-escura hover:underline">Conferir captura Widesys →</Link>}</Card>
    </div>
  </div>;
}

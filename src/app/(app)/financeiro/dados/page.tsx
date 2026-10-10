import Link from "next/link";
import { acessoAtual, exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { podeAbrirRota } from "@/lib/acesso/politica";
import { organizacaoDosDados } from "@/lib/consultas/unificacao";
import { ROTULOS_ORIGEM_DADOS } from "@/lib/unificacao/origens";
import { Badge, Card, PageHeader, btnPrimario, btnSecundario } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conferir dados — Brisa" };

const LISTAS = [
  { dominio: "RECEBER", titulo: "Contas a receber", descricao: "Cobranças e recebimentos de clientes.", rota: "/recebimentos" },
  { dominio: "PAGAR", titulo: "Contas a pagar", descricao: "Despesas e pagamentos a fornecedores.", rota: "/financeiro/contas-a-pagar" },
  { dominio: "MOVIMENTO", titulo: "Entradas e saídas", descricao: "Movimentos registrados nas contas e no caixa.", rota: "/caixa" },
] as const;

const numero = (valor: number) => valor.toLocaleString("pt-BR");
const data = (valor: Date | null | undefined) => valor ? valor.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "Ainda não registrada";
const resumoDetalhes = "cursor-pointer rounded-lg text-sm font-semibold text-tinta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oliva/30";

export default async function PaginaConferirDados() {
  await exigirPaginaAcesso("/financeiro/dados");
  const [dados, acesso] = await Promise.all([organizacaoDosDados(), acessoAtual()]);
  const abrir = (rota: string) => podeAbrirRota(acesso, rota);
  const listas = LISTAS.map(lista => ({ ...lista, resumo: dados.dominios.find(d => d.dominio === lista.dominio) }));
  const temPendencias = dados.pendentes + dados.inconsistentes > 0;

  return <div>
    <PageHeader
      titulo="Conferir dados"
      descricao="Escolha uma lista e confira cada registro antes de confirmar uma decisão."
      acoes={abrir("/financeiro") ? <Link href="/financeiro" className={btnSecundario}>Resumo financeiro</Link> : undefined}
    />

    <section className="mb-5" aria-labelledby="listas-conferencia">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="listas-conferencia" className="text-base font-bold">Por onde começar</h2>
        <Badge cor={temPendencias ? "ambar" : "azul"}>{temPendencias ? "Há registros para conferir" : "Sem pendências detectadas nesta análise"}</Badge>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {listas.map(lista => {
          const resumo = lista.resumo;
          const quantidade = (resumo?.pendentes ?? 0) + (resumo?.inconsistentes ?? 0);
          return <Card key={lista.dominio} nivel={quantidade > 0 ? "atencao" : "info"} className="flex flex-col p-5">
            <h3 className="text-base font-bold">{lista.titulo}</h3>
            <p className="mt-1 text-sm text-tinta-suave">{lista.descricao}</p>
            <p className="numero-card mt-4 text-3xl font-bold">{numero(quantidade)}</p>
            <p className="text-sm font-semibold">registros para conferir</p>
            <dl className="my-4 space-y-2 text-xs text-tinta-suave">
              <div className="flex justify-between gap-3"><dt>Duplicatas possíveis ou decisões a revisar</dt><dd className="font-semibold tabular-nums">{numero(resumo?.pendentes ?? 0)}</dd></div>
              <div className="flex justify-between gap-3"><dt>Inconsistências</dt><dd className="font-semibold tabular-nums">{numero(resumo?.inconsistentes ?? 0)}</dd></div>
              <div className="flex justify-between gap-3 border-t border-contorno pt-2"><dt>Incluídos nos totais</dt><dd className="font-semibold tabular-nums">{numero(resumo?.incluidos ?? 0)}</dd></div>
            </dl>
            {abrir(lista.rota) ? <div className="mt-auto flex flex-col gap-2">
              {(resumo?.pendentes ?? 0) > 0 ? <>
                <Link href={`${lista.rota}?estado=PENDENTE`} className={`${btnPrimario} justify-center`} aria-label={`Ver possíveis duplicatas em ${lista.titulo.toLowerCase()}`}>Possíveis duplicatas →</Link>
                <Link href={`${lista.rota}?estado=REVISAR`} className={`${btnSecundario} justify-center`} aria-label={`Ver decisões a revisar em ${lista.titulo.toLowerCase()}`}>Decisões a revisar →</Link>
              </> : null}
              {(resumo?.inconsistentes ?? 0) > 0 ? <Link href={`${lista.rota}?estado=QUARENTENA`} className={`${(resumo?.pendentes ?? 0) > 0 ? btnSecundario : btnPrimario} justify-center`} aria-label={`Ver inconsistências em ${lista.titulo.toLowerCase()}`}>Inconsistências →</Link> : null}
              {quantidade === 0 ? <Link href={lista.rota} className={`${btnPrimario} justify-center`}>Ver registros →</Link> : null}
            </div> : <p className="mt-auto text-xs text-tinta-suave">Seu acesso não permite abrir esta lista.</p>}
          </Card>;
        })}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-tinta-suave">Contagens de todas as competências. O subtotal de duplicatas possíveis ou decisões a revisar reúne duas listas separadas.</p>
    </section>

    <Card className="mb-5 p-4 sm:p-5">
      <h2 className="mb-3 text-sm font-bold">Como conferir</h2>
      <ol className="grid gap-4 text-sm sm:grid-cols-3">
        <li><span className="font-semibold">1. Escolha a lista</span><p className="mt-1 text-tinta-suave">Abra uma das situações acima.</p></li>
        <li><span className="font-semibold">2. Abra o registro</span><p className="mt-1 text-tinta-suave">Em contas a pagar e receber, clique em “Revisar” para abrir os detalhes sobre a lista.</p></li>
        <li><span className="font-semibold">3. Compare e confirme</span><p className="mt-1 text-tinta-suave">Confira origem, pessoa, data e valor antes de decidir.</p></li>
      </ol>
      <p className="mt-4 border-t border-contorno pt-3 text-xs text-tinta-suave">Estar incluído nos totais não significa conferência manual concluída. Nenhuma correspondência é aprovada automaticamente nesta página.</p>
    </Card>

    <div className="space-y-3">
      <Card className="p-4 sm:p-5">
        <details>
          <summary className={resumoDetalhes}>Entender as contagens e os totais</summary>
          <div className="mt-4 space-y-4 text-sm text-tinta-suave">
            <p>São contagens de registros, não valores. Cobrança, pagamento e movimento não devem ser somados como receitas diferentes.</p>
            <div className="tabela-scroll overflow-x-auto" tabIndex={0} role="region" aria-label="Situação da consolidação financeira">
              <table className="tabela">
                <thead><tr><th>Lista</th><th>Incluídos nos totais</th><th>Duplicatas / decisões a revisar</th><th>Inconsistências</th><th>Cópias vinculadas</th><th>Sem efeito</th><th>Ausentes</th></tr></thead>
                <tbody>{listas.map(({ dominio, titulo, resumo }) => <tr key={dominio}><td>{titulo}</td><td>{numero(resumo?.incluidos ?? 0)}</td><td>{numero(resumo?.pendentes ?? 0)}</td><td>{numero(resumo?.inconsistentes ?? 0)}</td><td>{numero(resumo?.vinculados ?? 0)}</td><td>{numero(resumo?.semEfeito ?? 0)}</td><td>{numero(resumo?.ausentes ?? 0)}</td></tr>)}</tbody>
              </table>
            </div>
            <p>Registros aceitos participam da visão unificada. Possíveis duplicatas, decisões a revisar e inconsistências ficam separados. Cópias vinculadas mantêm o histórico sem somar novamente. Transferências, cancelamentos e registros informativos podem ficar sem efeito no saldo; exclusões com histórico ficam fora desta projeção.</p>
            <div className="border-t border-contorno pt-4">
              <h3 className="font-semibold text-tinta">Por que outro painel pode mostrar números diferentes?</h3>
              <p className="mt-2">Estas listas usam a visão unificada. O Executivo, as locações e o livro original preservam a base de gestão e suas regras de apuração. Não some as duas bases nem espere igualdade enquanto houver correspondências pendentes.</p>
              <p className="mt-2">Inclusão automática não comprova conciliação bancária nem fechamento contábil. Não alteramos cálculos nem aprovamos correspondências para fazer os números coincidirem.</p>
            </div>
          </div>
        </details>
      </Card>

      <Card className="p-4 sm:p-5">
        <details>
          <summary className={resumoDetalhes}>Ver a origem e a atualização dos dados</summary>
          <div className="mt-4 space-y-4 text-sm text-tinta-suave">
            <div className="grid gap-4 md:grid-cols-3">{dados.origens.map(origem => <div key={origem.origem}>
              <h3 className="font-semibold text-tinta">{ROTULOS_ORIGEM_DADOS[origem.origem]}</h3>
              <p className="mt-1"><span className="font-semibold tabular-nums text-tinta">{numero(origem.quantidade)}</span> referências financeiras</p>
              <p className="mt-2 text-xs leading-relaxed">{origem.origem === "PLANILHA" ? "Arquivo Excel comprovado. Confira arquivo, aba e linha quando preservada na importação. Abas de caixas distintos continuam separadas." : origem.origem === "WIDESYS" ? "Dados capturados do sistema anterior. A captura indica até quando a informação foi observada." : "Registro do Brisa sem prova suficiente do arquivo de origem. Não é considerado manual por suposição."}</p>
            </div>)}</div>
            <p className="text-xs">Um registro vinculado pode ter mais de uma origem. Não some essas contagens: não são lançamentos adicionais. Na lista, use o filtro “De onde veio” para conferir cada fonte.</p>
            <dl className="grid gap-4 border-t border-contorno pt-4 sm:grid-cols-3">
              <div><dt className="font-semibold text-tinta">Última análise registrada</dt><dd className="mt-1">{data(dados.ultimaAnalise)}</dd></div>
              <div><dt className="font-semibold text-tinta">Última carga Excel</dt><dd className="mt-1">{data(dados.ultimoExcel)}</dd></div>
              <div><dt className="font-semibold text-tinta">Última captura Widesys importada</dt><dd className="mt-1">{data(dados.ultimoWidesys?.capturadoEm)}{dados.ultimoWidesys ? ` · ${dados.ultimoWidesys.status === "CONCLUIDO" ? "lote concluído" : dados.ultimoWidesys.status === "QUARENTENA" ? "lote com inconsistências" : "lote requer conferência"}` : ""}</dd></div>
            </dl>
            <p>Esta página consulta o banco deste ambiente. O Widesys é importado por capturas em lote, sem sincronização em tempo real. “Reanalisar correspondências” revisa o que já está no Brisa; não busca novos dados no Widesys.</p>
            {abrir("/financeiro/migracao-widesys") ? <Link href="/financeiro/migracao-widesys" className={btnSecundario}>Conferir captura Widesys</Link> : null}
          </div>
        </details>
      </Card>

      <Card className="p-4 sm:p-5">
        <details>
          <summary className={resumoDetalhes}>Consultar pendências antigas do Excel</summary>
          <div className="mt-4 space-y-3 text-sm text-tinta-suave">
            <p><span className="font-semibold text-tinta">{numero(dados.planilhas.pendentes)} ocorrências pendentes</span> foram preservadas no histórico dos lotes, sem conteúdo reservado. Naquela carga, não criaram lançamentos no caixa.</p>
            <p>Esta contagem histórica não é uma fila líquida de pendências atuais: uma carga posterior pode ter corrigido a mesma linha. Confira o lote e os registros existentes antes de importar outra vez.</p>
            {abrir("/financeiro/importacoes") && acesso.perfil === "ADMINISTRADOR" ? <Link href="/financeiro/importacoes?status=PENDENTE" className={btnSecundario}>Conferir histórico do Excel</Link> : <p className="text-xs">A conferência dos arquivos é restrita ao administrador.</p>}
          </div>
        </details>
      </Card>

      <Card className="p-4 sm:p-5">
        <details>
          <summary className={resumoDetalhes}>Excluir ou restaurar um registro</summary>
          <div className="mt-4 space-y-3 text-sm text-tinta-suave">
            <p>O administrador pode usar “Excluir da plataforma” na própria lista, inclusive para registros pagos ou conciliados, com motivo, histórico e restauração. A exclusão não cancela nem estorna operações no banco ou no fisco.</p>
            {abrir("/cadastros/governanca") ? <div className="flex flex-wrap gap-2"><Link href="/cadastros/governanca" className={btnSecundario}>Revisar registros</Link>{acesso.perfil === "ADMINISTRADOR" ? <Link href="/cadastros/governanca?modo=lixeira" className={btnSecundario}>Ver lixeira</Link> : null}</div> : <p className="text-xs">Solicite ao administrador a revisão e exclusão.</p>}
          </div>
        </details>
      </Card>
    </div>
  </div>;
}

import {
  Card,
  Dinheiro,
  Kpi,
  PageHeader,
  SeletorPeriodo,
  TituloCard,
  btnSecundario,
} from "@/components/ui";
import { BarrasMensais, MapaCalor } from "@/components/graficos";
import { ComposicaoComissao } from "@/components/graficos-interativos";
import {
  matrizComissao,
  matrizComissaoPeriodo,
  mesMaisRecenteComLancamentos,
} from "@/lib/consultas/relatorios";
import {
  NOME_MES_ABREV,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";
import { parsePeriodo, rotulosCompetencias } from "@/lib/dominio/periodo";
import { SeletorAno, anoDaQuery } from "../../relatorios/seletor-ano";

function CelulaValor({ centavos }: { centavos: number }) {
  return (
    <td className="text-right">
      {centavos !== 0 ? (
        <Dinheiro centavos={centavos} />
      ) : (
        <span className="text-tinta-suave/40">—</span>
      )}
    </td>
  );
}

export default async function ComissaoPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string; de?: string; ate?: string }>;
}) {
  const sp = await searchParams;
  const periodo = parsePeriodo(sp.de, sp.ate);
  const mesRecente = await mesMaisRecenteComLancamentos();
  const ano = anoDaQuery(sp.ano, parseCompetencia(mesRecente).ano);

  // as duas visões desembocam no mesmo view-model: colunas + linhas + totais
  const vm = periodo
    ? await (async () => {
        const m = await matrizComissaoPeriodo(periodo.meses);
        return {
          colunas: rotulosCompetencias(periodo.meses),
          linhas: m.linhas,
          totalPorMes: m.totalPorMes,
          totalGeral: m.totalGeral,
          janela: `no período ${periodo.rotulo}`,
          janelaCurta: "no período",
        };
      })()
    : await (async () => {
        const m = await matrizComissao(ano);
        return {
          colunas: NOME_MES_ABREV.slice(1),
          linhas: m.linhas,
          totalPorMes: m.totalPorMes,
          totalGeral: m.totalGeral,
          janela: `em ${ano}`,
          janelaCurta: `em ${ano}`,
        };
      })();

  const exportarHref = periodo
    ? `/relatorios/exportar?tipo=comissao&de=${periodo.de}&ate=${periodo.ate}`
    : `/relatorios/exportar?tipo=comissao&ano=${ano}`;
  const mesesComApuracao = vm.totalPorMes.filter((valor) => valor > 0).length;
  const maiorValor = Math.max(0, ...vm.totalPorMes);
  const maiorIndice = maiorValor > 0 ? vm.totalPorMes.indexOf(maiorValor) : -1;
  const empreendimentosComApuracao = vm.linhas.filter((linha) => linha.total > 0);
  const maiores = empreendimentosComApuracao.slice(0, 4).map((linha) => ({
    rotulo: linha.empreendimento,
    valor: linha.total,
  }));
  const demais = empreendimentosComApuracao.slice(4).reduce((soma, linha) => soma + linha.total, 0);
  if (demais > 0) maiores.push({ rotulo: "Demais empreendimentos", valor: demais });

  return (
    <div>
      <PageHeader
        titulo="Comissões"
        descricao={`Comissão por empreendimento × mês de lançamento ${vm.janela}. IPTU e condomínio são repasses e não entram na base.`}
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            {!periodo ? (
              <SeletorAno base="/financeiro/comissoes" ano={ano} />
            ) : null}
            <SeletorPeriodo base="/financeiro/comissoes" periodo={periodo} />
            <a href={exportarHref} className={btnSecundario}>
              Exportar Excel
            </a>
          </div>
        }
      />

      <p className="mb-4 text-xs leading-relaxed text-tinta-suave">
        Apuração dos recebimentos com composição registrada no Brisa. Títulos importados
        sem aluguel, repasses e taxa conferidos aguardam validação antes de gerar comissão.
      </p>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi rotulo="Total apurado" valor={<Dinheiro centavos={vm.totalGeral} destaque />} detalhe={vm.janela} destaque />
        <Kpi rotulo="Média dos meses com apuração" valor={<Dinheiro centavos={mesesComApuracao ? Math.round(vm.totalGeral / mesesComApuracao) : 0} />} detalhe={`${mesesComApuracao} mês(es) com lançamento`} />
        <Kpi rotulo="Maior mês" valor={<Dinheiro centavos={maiorValor} />} detalhe={maiorIndice >= 0 ? vm.colunas[maiorIndice] : "Sem apuração"} />
        <Kpi rotulo="Empreendimentos" valor={empreendimentosComApuracao.length} detalhe="Com comissão na janela selecionada" />
      </div>

      {vm.totalGeral > 0 ? (
        <div className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(290px,1fr)]">
          <Card className="min-w-0 p-5">
            <TituloCard titulo="Evolução mensal" ajuda="Cada barra mostra a comissão apurada no mês de lançamento. Selecione outro ano ou período para comparar a evolução." />
            <div className="mt-4 overflow-x-auto">
              <div className="min-w-[520px]">
                <BarrasMensais valores={vm.totalPorMes} rotulos={vm.colunas} rotuloAcessivel={`Evolução mensal das comissões ${vm.janela}`} />
              </div>
            </div>
          </Card>
          <Card className="min-w-0 p-5">
            <TituloCard titulo="Origem por empreendimento" ajuda="Distribuição da comissão apurada entre os empreendimentos. A fatia Demais reúne os que ficaram fora dos quatro maiores." />
            <ComposicaoComissao fatias={maiores} total={vm.totalGeral} />
          </Card>
        </div>
      ) : null}

      {vm.linhas.length > 0 ? (
        <Card className="mb-4 p-5">
          <TituloCard
            titulo="Mapa de calor"
            ajuda="Cada célula é a comissão de um empreendimento num mês. Quanto mais intenso o verde, maior o valor. Passe o cursor ou navegue até um valor para ver o total completo; traço significa sem movimento."
          />
          <MapaCalor
            colunas={vm.colunas}
            linhas={vm.linhas.map((l) => ({
              rotulo: l.empreendimento,
              valores: l.porMes.map((v) => (v !== 0 ? v : null)),
            }))}
            rotuloLinhas="Empreendimento"
            rotuloAcessivel={`Mapa de calor da comissão ${vm.janela}`}
          />
        </Card>
      ) : null}

      <Card>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>Empreendimento</th>
                {vm.colunas.map((m) => (
                  <th key={m} className="text-right">
                    {m}
                  </th>
                ))}
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {vm.linhas.map((l) => (
                <tr key={l.empreendimentoId}>
                  <td className="font-medium">{l.empreendimento}</td>
                  {l.porMes.map((v, i) => (
                    <CelulaValor key={i} centavos={v} />
                  ))}
                  <td className="text-right">
                    <Dinheiro centavos={l.total} destaque />
                  </td>
                </tr>
              ))}
              {vm.linhas.length === 0 ? (
                <tr>
                  <td
                    colSpan={vm.colunas.length + 2}
                    className="py-6 text-center text-tinta-suave"
                  >
                    Nenhuma comissão lançada {vm.janelaCurta}.
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                {vm.totalPorMes.map((v, i) => (
                  <td key={i} className="text-right">
                    <Dinheiro centavos={v} destaque />
                  </td>
                ))}
                <td className="text-right">
                  <Dinheiro centavos={vm.totalGeral} destaque />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

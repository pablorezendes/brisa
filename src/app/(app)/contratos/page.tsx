import Link from "next/link";
import {
  Ajuda,
  PageHeader,
  Card,
  Dinheiro,
  Badge,
  Kpi,
  btnPrimario,
  btnSecundario,
} from "@/components/ui";
import { NOME_MES_COMPLETO } from "@/lib/dominio/normalizacao";
import {
  contratosParaLista,
  type ContratoComRelacoes,
} from "@/lib/consultas/locacao";
import { badgeStatus } from "./status";

type SearchParams = Promise<{ todos?: string; erro?: string }>;

export default async function PaginaContratos({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const incluirEncerrados = sp.todos === "1";
  const contratos = await contratosParaLista(incluirEncerrados);

  const hoje = new Date();
  const mesCorrente = hoje.getMonth() + 1;
  const comReajuste = contratos.filter(
    (c) => c.status !== "encerrado" && c.mesReajuste === mesCorrente
  );

  const ativos = contratos.filter((c) => c.status === "ativo");
  const desocupados = ativos.filter((c) => c.locatarioId === null);
  const totalContratado = ativos.reduce(
    (s, c) => s + c.valorBase + c.iptu + c.condominio,
    0
  );

  // Agrupa por empreendimento (consulta já vem ordenada por nome)
  const grupos = new Map<string, ContratoComRelacoes[]>();
  for (const c of contratos) {
    const nome = c.unidade.empreendimento.nome;
    const lista = grupos.get(nome) ?? [];
    lista.push(c);
    grupos.set(nome, lista);
  }

  return (
    <div>
      <PageHeader
        titulo="Contratos"
        descricao="Rent roll por empreendimento — valores contratados em vigor"
        acoes={
          <>
            <Link
              href={incluirEncerrados ? "/contratos" : "/contratos?todos=1"}
              className={btnSecundario}
            >
              {incluirEncerrados ? "Ocultar encerrados" : "Mostrar encerrados"}
            </Link>
            <Link href="/contratos/novo" className={btnPrimario}>
              Novo contrato
            </Link>
          </>
        }
      />

      {sp.erro ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {sp.erro}
        </div>
      ) : null}

      {comReajuste.length > 0 ? (
        <Card className="mb-4 border-amber-300 bg-amber-50 p-4">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Badge cor="ambar">Reajuste este mês</Badge>
            <span>
              {comReajuste.length} contrato(s) com reajuste em{" "}
              {NOME_MES_COMPLETO[mesCorrente]}
            </span>
          </div>
          <ul className="text-sm text-slate-700">
            {comReajuste.map((c) => (
              <li key={c.id}>
                <Link href={`/contratos/${c.id}`} className="hover:underline">
                  {c.unidade.empreendimento.nome} — {c.unidade.identificacao} —{" "}
                  {c.locatario?.nome ?? "Desocupado"}
                  {c.indiceReajuste ? ` (${c.indiceReajuste})` : ""}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi
          rotulo="Contratos ativos"
          valor={ativos.length}
          ajuda="Contratos com status ativo — geram cobrança todo mês pelo botão Gerar devidos, em Recebimentos. Contratos em acordo ou encerrados ficam de fora desta conta."
        />
        <Kpi
          rotulo="Unidades desocupadas"
          valor={desocupados.length}
          detalhe="contratos ativos sem locatário"
          ajuda="Unidades com contrato ativo mas sem locatário — não estão rendendo. Quando alugar, edite o contrato e vincule o novo locatário."
        />
        <Kpi
          rotulo="Total contratado / mês"
          valor={<Dinheiro centavos={totalContratado} destaque />}
          detalhe="valor + IPTU + condomínio dos ativos"
          ajuda="Quanto entraria por mês se todos os ativos pagassem em dia: aluguel + IPTU + condomínio. É o teto teórico — o realizado aparece em Recebimentos."
        />
      </div>

      {Array.from(grupos.entries()).map(([nomeEmpreendimento, lista]) => {
        const subtotais = lista.reduce(
          (t, c) => {
            t.valor += c.valorBase;
            t.iptu += c.iptu;
            t.cond += c.condominio;
            return t;
          },
          { valor: 0, iptu: 0, cond: 0 }
        );
        return (
          <Card key={nomeEmpreendimento} className="mb-4">
            <div className="flex items-baseline justify-between px-4 pb-1 pt-3">
              <h2 className="text-sm font-bold tracking-tight">
                {nomeEmpreendimento}
              </h2>
              <span className="text-xs text-slate-500">
                {lista.length} contrato(s)
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Localização</th>
                    <th>Locatário</th>
                    <th style={{ textAlign: "right" }}>
                      Valor{" "}
                      <Ajuda dica="Aluguel-base combinado no contrato. É a parte que gera comissão — IPTU e condomínio ficam de fora." />
                    </th>
                    <th style={{ textAlign: "right" }}>
                      IPTU{" "}
                      <Ajuda dica="Parcela mensal de IPTU cobrada junto com o aluguel. É repasse ao proprietário, não receita da administradora." />
                    </th>
                    <th style={{ textAlign: "right" }}>
                      Cond.{" "}
                      <Ajuda dica="Condomínio cobrado junto com o aluguel. Também é repasse — nunca entra na comissão." />
                    </th>
                    <th style={{ textAlign: "right" }}>
                      Total contratado{" "}
                      <Ajuda dica="Valor + IPTU + condomínio: o boleto cheio do locatário. É este total que vira o devido do mês em Recebimentos." />
                    </th>
                    <th style={{ textAlign: "right" }}>
                      Dia venc.{" "}
                      <Ajuda dica="Dia do mês em que o aluguel vence. Depois dessa data, a cobrança pendente conta dias de atraso nos painéis." />
                    </th>
                    <th>
                      Mês de reajuste{" "}
                      <Ajuda dica="Aniversário anual de correção do aluguel. Quando chega, aplique o índice do contrato e atualize o valor aqui — o sistema avisa, mas não reajusta sozinho." />
                    </th>
                    <th>
                      Status{" "}
                      <Ajuda dica="Ativo = gera cobrança todo mês; Acordo = renegociação em curso (lançamentos manuais); Encerrado = não gera mais nada." />
                    </th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((c) => (
                    <tr key={c.id}>
                      <td>{c.unidade.identificacao}</td>
                      <td>
                        {c.locatario ? (
                          c.locatario.nome
                        ) : (
                          <Badge cor="slate">Desocupado</Badge>
                        )}
                      </td>
                      <td className="text-right"><Dinheiro centavos={c.valorBase} /></td>
                      <td className="text-right"><Dinheiro centavos={c.iptu} /></td>
                      <td className="text-right"><Dinheiro centavos={c.condominio} /></td>
                      <td className="text-right">
                        <Dinheiro
                          centavos={c.valorBase + c.iptu + c.condominio}
                          destaque
                        />
                      </td>
                      <td className="text-right">{c.diaVencimento ?? "—"}</td>
                      <td>
                        {c.mesReajuste ? NOME_MES_COMPLETO[c.mesReajuste] : "—"}{" "}
                        {c.status !== "encerrado" && c.mesReajuste === mesCorrente ? (
                          <Badge cor="ambar">Reajuste este mês</Badge>
                        ) : null}
                      </td>
                      <td>{badgeStatus(c.status)}</td>
                      <td>
                        <Link
                          href={`/contratos/${c.id}`}
                          className="text-xs font-semibold text-oliva-escura hover:underline"
                        >
                          Detalhe
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Subtotal</td>
                    <td className="text-right"><Dinheiro centavos={subtotais.valor} /></td>
                    <td className="text-right"><Dinheiro centavos={subtotais.iptu} /></td>
                    <td className="text-right"><Dinheiro centavos={subtotais.cond} /></td>
                    <td className="text-right">
                      <Dinheiro
                        centavos={subtotais.valor + subtotais.iptu + subtotais.cond}
                        destaque
                      />
                    </td>
                    <td colSpan={4}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

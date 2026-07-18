/**
 * /ajuda — "Como funciona": central de explicação do sistema.
 *
 * Página estática e editorial: o ciclo do mês em 7 passos, glossário da
 * linguagem do negócio, erros comuns e a origem dos números calculados.
 * Escrita para a família — frases curtas, exemplos com números reais e
 * sempre a dica do que fazer no lançamento.
 */
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Como funciona — Brisa" };

/** Número de passo em círculo editorial (flat, borda 1px). */
function NumeroPasso({ n }: { n: number }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-tinta font-mono text-sm font-bold text-tinta">
      {n}
    </span>
  );
}

function Passo({
  n,
  titulo,
  href,
  rotuloLink,
  children,
}: {
  n: number;
  titulo: string;
  href: string;
  rotuloLink: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4 border-b border-contorno py-4 last:border-b-0">
      <NumeroPasso n={n} />
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-tinta">{titulo}</h3>
        <p className="mt-1 text-sm leading-relaxed text-tinta-suave">
          {children}
        </p>
        <Link
          href={href}
          className="mt-1.5 inline-block text-sm font-semibold text-oliva-escura hover:underline"
        >
          {rotuloLink} →
        </Link>
      </div>
    </li>
  );
}

/** Verbete do glossário: termo + definição + exemplo com números reais. */
function Termo({
  nome,
  exemplo,
  children,
}: {
  nome: string;
  exemplo: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-contorno py-3 last:border-b-0">
      <dt className="font-serif text-base font-semibold text-tinta">{nome}</dt>
      <dd className="mt-0.5 text-sm leading-relaxed text-tinta-suave">
        {children}
        <span className="mt-1 block font-mono text-[13px] text-tinta">
          Ex.: {exemplo}
        </span>
      </dd>
    </div>
  );
}

function Erro({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <li className="border-b border-contorno py-3 last:border-b-0">
      <p className="text-sm font-semibold text-erro">✘ {titulo}</p>
      <p className="mt-0.5 text-sm leading-relaxed text-tinta-suave">
        {children}
      </p>
    </li>
  );
}

export default function PaginaAjuda() {
  return (
    <div className="max-w-4xl">
      <PageHeader
        titulo="Como funciona"
        descricao="O ciclo do mês, a linguagem do negócio e os erros mais comuns — tudo em um lugar só."
      />

      {/* ---------- resumo de abertura ---------- */}
      <Card className="mb-8 border-l-4 border-l-oliva px-6 py-4">
        <p className="text-sm leading-relaxed text-tinta">
          O sistema faz o que a planilha COMISSÃO fazia, sem fórmula quebrada:
          você lança <strong>o que aconteceu</strong> (contratos, pagamentos,
          gastos) e ele calcula <strong>o resto</strong> (total devido, base,
          comissão, saldos). A regra de ouro:{" "}
          <strong>
            a comissão incide só sobre o aluguel recebido — IPTU e condomínio
            são repasses ao proprietário
          </strong>
          .
        </p>
      </Card>

      {/* ---------- 1. ciclo do mês ---------- */}
      <h2 className="text-xl font-bold tracking-tight text-tinta">
        O ciclo do mês em 7 passos
      </h2>
      <p className="mt-1 text-sm text-tinta-suave">
        A rotina de todo mês, na ordem. Seguindo os passos, nada fica para
        trás.
      </p>
      <Card className="mt-3 px-6 py-2">
        <ol>
          <Passo
            n={1}
            titulo="Gerar os devidos do mês"
            href="/recebimentos"
            rotuloLink="Recebimentos"
          >
            No início do mês, clique em <strong>Gerar devidos do mês</strong>:
            o sistema cria uma cobrança para cada contrato ativo, com aluguel,
            IPTU e condomínio do contrato. Nada é cobrado duas vezes — quem já
            tem lançamento não é recriado.
          </Passo>
          <Passo
            n={2}
            titulo="Registrar cada pagamento"
            href="/recebimentos"
            rotuloLink="Recebimentos"
          >
            Quando o dinheiro entra, clique em <strong>Registrar</strong> na
            linha: informe o valor recebido, a <strong>data</strong> e a{" "}
            <strong>via</strong> (boleto, PIX, dinheiro, serviço). Se for
            pagamento atrasado, ajuste a <strong>competência</strong> para o
            mês devido. Se for parcial, acordo ou permuta, explique na{" "}
            <strong>Observação</strong>.
          </Passo>
          <Passo
            n={3}
            titulo="Acompanhar os pendentes"
            href="/relatorios/inadimplencia"
            rotuloLink="Relatórios → Inadimplência"
          >
            As linhas sem recebimento ficam destacadas e somam a inadimplência
            do mês. Acompanhe pela Visão geral ou pelo relatório de
            inadimplência e cobre quem está atrasado — acima de 30 dias o
            painel marca em vermelho.
          </Passo>
          <Passo
            n={4}
            titulo="Lançar a temporada e conferir a conciliação"
            href="/temporada"
            rotuloLink="Temporada"
          >
            Lance limpezas, despesas e repasses das plataformas. No fim, o
            selo de <strong>conciliação</strong> deve ficar verde: a receita
            da temporada tem que bater com a linha AIRBNB do núcleo de
            recebimentos. Diferença = algo faltou em um dos dois lados.
          </Passo>
          <Passo
            n={5}
            titulo="Lançar o caixa"
            href="/caixa"
            rotuloLink="Caixa"
          >
            Registre as entradas e as saídas de cada centro (Antonio/Laura e
            Chácara Brisa), com categoria. Recebimentos em espécie vão no
            bloco próprio de <strong>Recebimentos em dinheiro</strong> — eles
            não entram no saldo.
          </Passo>
          <Passo
            n={6}
            titulo="Fechar o mês"
            href="/recebimentos"
            rotuloLink="Recebimentos"
          >
            Com tudo conferido, clique em <strong>Fechar mês</strong>. É como
            enviar a planilha ao cliente: a comissão fica travada e os
            lançamentos não aceitam mais alteração. Precisou corrigir?{" "}
            <strong>Reabrir</strong> existe, mas é um ato explícito — o
            fechamento é apagado e refeito.
          </Passo>
          <Passo
            n={7}
            titulo="Exportar os relatórios"
            href="/relatorios"
            rotuloLink="Relatórios"
          >
            Matriz de comissão, resultado consolidado e inadimplência, prontos
            para imprimir ou enviar. Os números são os mesmos das telas —
            calculados na hora, nunca digitados.
          </Passo>
        </ol>
      </Card>

      {/* ---------- 2. glossário ---------- */}
      <h2 className="mt-10 text-xl font-bold tracking-tight text-tinta">
        Glossário — a linguagem do negócio
      </h2>
      <p className="mt-1 text-sm text-tinta-suave">
        Os termos que aparecem nas telas, com um exemplo real em cada um. O
        caso-guia: aluguel de R$ 5.347,00 com IPTU de R$ 400,92.
      </p>
      <Card className="mt-3 px-6 py-3">
        <dl>
          <Termo
            nome="Empreendimento"
            exemplo="um prédio comercial com 8 salas é 1 empreendimento com 8 unidades."
          >
            O imóvel (ou conjunto) administrado — o nível em que a comissão é
            somada na matriz mensal.
          </Termo>
          <Termo
            nome="Unidade / Localização"
            exemplo={<>&quot;Sala 3&quot;, &quot;Apto 208&quot;, &quot;Casa fundos&quot;.</>}
          >
            Cada espaço alugável dentro de um empreendimento. A
            &quot;localização&quot; nas tabelas é a identificação da unidade.
          </Termo>
          <Termo
            nome="Rent roll"
            exemplo="a tela Contratos é o rent roll: cada linha, um contrato com seus valores em vigor."
          >
            A lista de todos os contratos com os valores contratados. Mostra
            quanto entraria por mês se todos pagassem em dia.
          </Termo>
          <Termo
            nome="Recebimento"
            exemplo="a cobrança de julho da Sala 3: devido R$ 5.747,92, ainda pendente."
          >
            Uma cobrança de um contrato em um mês: nasce como &quot;devido&quot; e
            vira &quot;recebido&quot; quando você registra o pagamento.
          </Termo>
          <Termo
            nome="Valor"
            exemplo="R$ 5.347,00 — só esta parte gera comissão."
          >
            O aluguel-base do contrato, sem IPTU nem condomínio.
          </Termo>
          <Termo
            nome="IPTU e Cond. (repasses)"
            exemplo="IPTU de R$ 400,92 cobrado junto: entra no total, mas sai da conta da comissão."
          >
            Valores que o locatário paga junto com o aluguel e que são
            repassados ao proprietário. A administradora não ganha nada sobre
            eles — nunca entram na comissão.
          </Termo>
          <Termo
            nome="Total devido"
            exemplo="R$ 5.347,00 + R$ 400,92 = R$ 5.747,92."
          >
            Valor + IPTU + condomínio: o que o locatário deve pagar no mês.
            Calculado pelo sistema; fica vazio quando não há nada a cobrar.
          </Termo>
          <Termo
            nome="Recebido"
            exemplo="recebido R$ 5.747,92 = pagou tudo. Pode ser maior (quitou atraso junto) ou menor (parcial) — anote o motivo na Observação."
          >
            O que de fato entrou. Vazio significa pendente — é isso que conta
            como inadimplência.
          </Termo>
          <Termo
            nome="Base de cálculo"
            exemplo="R$ 5.747,92 − R$ 400,92 de IPTU = R$ 5.347,00."
          >
            Recebido menos IPTU e condomínio: a parte de aluguel do que
            entrou. É sobre ela que a comissão incide.
          </Termo>
          <Termo
            nome="Comissão"
            exemplo="10% de R$ 5.347,00 = R$ 534,70."
          >
            O ganho da administradora: base de cálculo × taxa vigente no
            lançamento (padrão 10%), arredondada ao centavo. Sempre calculada,
            nunca digitada.
          </Termo>
          <Termo
            nome="Competência × Mês de lançamento"
            exemplo="aluguel de maio pago em julho: competência MAI/2026, lançado em JUL/2026."
          >
            Competência é o mês a que o aluguel se refere; mês de lançamento é
            o mês operacional em que a cobrança entrou na planilha. Só
            diferem em atrasos e adiantamentos — e a comissão conta no mês de
            lançamento.
          </Termo>
          <Termo
            nome="Via"
            exemplo="PIX. Pagou em espécie? Via DINHEIRO — e registre também no bloco de espécie do Caixa."
          >
            Como o dinheiro entrou: BOLETO, PIX, DINHEIRO ou SERVICO
            (permuta). Sempre preencha ao registrar.
          </Termo>
          <Termo
            nome="Reajuste"
            exemplo="contrato com mês de reajuste em julho e índice IGP-M: em julho, aplique o índice e atualize o valor no contrato."
          >
            O aniversário anual de correção do aluguel. O sistema avisa quando
            chega o mês, mas a atualização do valor é sua.
          </Termo>
          <Termo
            nome="Fechamento"
            exemplo="fechou junho com comissão de R$ 8.712,34: nada de junho muda até alguém reabrir."
          >
            O ato de travar o mês, como enviar a planilha ao cliente. Guarda a
            comissão total e bloqueia alterações; reabrir é explícito e apaga
            o fechamento.
          </Termo>
          <Termo
            nome="Centro de custo"
            exemplo="conta de luz da chácara → saída CH; farmácia → saída AL."
          >
            Para quem foi o gasto no caixa: AL (Antonio/Laura) ou CH (Chácara
            Brisa). Entradas são gerais. É o que separa as contas de cada
            núcleo.
          </Termo>
          <Termo
            nome="Temporada"
            exemplo="lucro do mês = repasses do Airbnb − energia/condomínio/IPTU − limpezas da diarista."
          >
            A operação Airbnb das unidades de temporada: recebimentos das
            plataformas, despesas e limpezas, com apuração própria que deve
            conciliar com o núcleo.
          </Termo>
        </dl>
      </Card>

      {/* ---------- 3. erros comuns ---------- */}
      <h2 className="mt-10 text-xl font-bold tracking-tight text-tinta">
        Erros comuns e como evitar
      </h2>
      <Card className="mt-3 px-6 py-3">
        <ul>
          <Erro titulo="Esquecer a competência num pagamento atrasado">
            Se o locatário pagou em julho o aluguel de maio, a competência do
            lançamento continua sendo maio — só o mês de lançamento é julho.
            Ao registrar, ajuste o campo Competência; a linha fica destacada
            em âmbar para mostrar que é atraso.
          </Erro>
          <Erro titulo="Achar que IPTU e condomínio entram na comissão">
            Eles entram no total devido, mas são repasses ao proprietário. O
            sistema já desconta sozinho: comissão = (recebido − IPTU − cond.)
            × taxa. Não tente &quot;corrigir&quot; a base à mão.
          </Erro>
          <Erro titulo="Deixar a via vazia">
            Sem a via, ninguém sabe depois se foi boleto, PIX ou espécie — e a
            conferência bancária vira caça ao tesouro. Preencha sempre ao
            registrar; se foi em espécie, lance também no bloco de dinheiro do
            Caixa.
          </Erro>
          <Erro titulo="Tentar lançar num mês fechado">
            Mês fechado é planilha enviada: o sistema bloqueia. Se realmente
            precisar corrigir, use Reabrir em Recebimentos — consciente de que
            o fechamento será apagado e o mês terá que ser fechado de novo.
          </Erro>
          <Erro titulo="Registrar pagamento parcial sem observação">
            Recebido menor que o devido sem explicação vira mistério no
            fechamento. Escreva o motivo na Observação: &quot;pagou 50%,
            restante dia 20&quot;, &quot;acordo — 3ª parcela&quot; etc.
          </Erro>
          <Erro titulo="Confundir recebimentos em dinheiro com entradas do caixa">
            O bloco &quot;Recebimentos em dinheiro&quot; é um registro paralelo de
            espécie e não entra no saldo do mês. O que movimenta o saldo são
            as Entradas. Não lance o mesmo dinheiro nos dois blocos.
          </Erro>
        </ul>
      </Card>

      {/* ---------- 4. de onde vêm os números ---------- */}
      <h2 className="mt-10 text-xl font-bold tracking-tight text-tinta">
        De onde vêm os números
      </h2>
      <Card className="mt-3 px-6 py-4">
        <p className="text-sm leading-relaxed text-tinta-suave">
          <strong className="text-tinta">
            Total devido, base de cálculo e comissão são sempre calculados —
            nunca digitados.
          </strong>{" "}
          Você informa só os fatos (valores do contrato e o que foi recebido);
          o sistema aplica a regra única:
        </p>
        <div className="mt-3 overflow-x-auto rounded border border-contorno bg-papel px-4 py-3 font-mono text-[13px] leading-7 text-tinta">
          total devido&nbsp;&nbsp;= valor + IPTU + cond.
          <br />
          base&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;=
          recebido − IPTU − cond.
          <br />
          comissão&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= base × taxa (padrão 10%),
          arredondada ao centavo
        </div>
        <p className="mt-3 text-sm leading-relaxed text-tinta-suave">
          É a mesma fórmula da planilha COMISSÃO de sempre — na migração, o
          sistema reproduziu a planilha <strong>ao centavo</strong>, linha por
          linha. Se um número parecer estranho, o caminho é conferir o
          lançamento (recebido, IPTU, condomínio, taxa), nunca editar o
          resultado: ele não é editável em lugar nenhum. A taxa gravada em
          cada lançamento é um retrato do momento — mudar a taxa vigente hoje
          não altera meses já lançados.
        </p>
      </Card>

      <p className="mt-6 text-xs text-tinta-suave">
        Dica: em todas as telas, passe o mouse (ou o foco) no{" "}
        <span className="dica" tabIndex={0} data-dica="Isso! Cada ? explica a métrica ao lado e diz o que fazer no lançamento.">
          ?
        </span>{" "}
        ao lado de um número para ver a explicação daquela métrica.
      </p>
    </div>
  );
}

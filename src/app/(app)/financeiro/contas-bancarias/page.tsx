import "server-only";
import Link from "next/link";
import { acessoAtual, exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { carteiraIrrestrita, pode } from "@/lib/acesso/politica";
import { ExcluirRegistroLink } from "@/components/excluir-registro-link";
import { filtroGovernanca } from "@/lib/governanca/filtros";
import { Card, Kpi, PageHeader, Selo, Sigilo, btnPrimario, btnSecundario, inputBase } from "@/components/ui";
import { prisma } from "@/lib/db";
import { atualizarCadastroContaBancaria } from "./actions";

export const metadata = { title: "Contas bancárias — Financeiro — Brisa" };
export const dynamic = "force-dynamic";

type ContaCadastro = {
  id: string;
  codigoBanco: string;
  nomeBanco: string;
  agencia: string;
  numero: string;
  apelido: string;
  finalidade: string | null;
  ativa: boolean;
  padrao: boolean;
  _count: { boletos: number };
};

const FINALIDADES: Record<string, string> = {
  OPERACIONAL: "Operacional",
  APLICACAO: "Aplicação",
  IPTU: "IPTU",
  OUTRA: "Outra finalidade",
};

function EditarCadastro({ conta }: { conta: ContaCadastro }) {
  return (
    <details className="tabela-configuracao-conta group">
      <summary className={`${btnSecundario} cursor-pointer list-none justify-center text-[12px] [&::-webkit-details-marker]:hidden`}>
        Editar cadastro
      </summary>
      <form action={atualizarCadastroContaBancaria} className="mt-3 space-y-3 rounded-xl border border-contorno bg-[#fbfcfc] p-4 text-left">
        <input type="hidden" name="id" value={conta.id} />
        <input type="hidden" name="retorno" value="/financeiro/contas-bancarias" />
        <label className="block text-[12px] font-semibold text-tinta">
          Apelido
          <input name="apelido" required maxLength={80} defaultValue={conta.apelido} className={`${inputBase} mt-1.5 block w-full`} />
        </label>
        <label className="block text-[12px] font-semibold text-tinta">
          Finalidade
          <select name="finalidade" defaultValue={conta.finalidade ?? "OUTRA"} className={`${inputBase} mt-1.5 block w-full`}>
            {Object.entries(FINALIDADES).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
          </select>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-contorno p-3">
          <input type="checkbox" name="padrao" defaultChecked={conta.padrao} disabled={!conta.ativa} className="mt-0.5 h-4 w-4 accent-[#315f56]" />
          <span className="text-[12px] font-semibold text-tinta">Usar como conta padrão</span>
        </label>
        <p className="text-[11px] leading-relaxed text-tinta-suave">
          Altera somente o cadastro. Não ativa a API, não emite boletos e não movimenta saldo.
          Banco, agência e número permanecem preservados.
        </p>
        <button type="submit" className={btnPrimario}>Salvar cadastro</button>
      </form>
    </details>
  );
}

export default async function PaginaContasBancarias({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  await exigirPaginaAcesso("/financeiro/contas-bancarias");
  const sp = await searchParams;
  const acesso = await acessoAtual();
  const podeGerenciar = acesso.perfil === "ADMINISTRADOR" && pode(acesso, "contas.editar") && carteiraIrrestrita(acesso);
  const podeIntegrar = podeGerenciar && pode(acesso, "integracoes.gerenciar") && pode(acesso, "boletos.configurar");
  const contas: ContaCadastro[] = await prisma.contaBancaria.findMany({
    where: await filtroGovernanca(prisma, "CONTA"),
    select: {
      id: true, codigoBanco: true, nomeBanco: true, agencia: true, numero: true,
      apelido: true, finalidade: true, ativa: true, padrao: true,
      _count: { select: { boletos: true } },
    },
    orderBy: [{ padrao: "desc" }, { ativa: "desc" }, { apelido: "asc" }],
  });
  const ativas = contas.filter((conta) => conta.ativa).length;
  const padrao = contas.find((conta) => conta.padrao);

  return (
    <div>
      <PageHeader
        titulo="Contas bancárias"
        descricao="Veja onde o dinheiro entra e sai. Aqui você organiza o nome, a finalidade e a conta padrão; a conexão com o banco fica no menu Integrações."
        acoes={<>
          {podeIntegrar ? <Link href="/integracoes/sicoob" className={btnPrimario}>Configurar Sicoob</Link> : null}
          <Link href="/financeiro" className={btnSecundario}>Voltar ao financeiro</Link>
        </>}
      />
      {sp.erro ? <div role="alert" className="mb-4 rounded-lg border border-erro/25 bg-erro/5 p-4 text-[13px] font-semibold text-erro">{sp.erro}</div> : null}
      {sp.ok ? <div role="status" className="mb-4 rounded-lg border border-oliva/25 bg-oliva/5 p-4 text-[13px] font-semibold text-oliva-escura">{sp.ok}</div> : null}
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Kpi rotulo="Contas cadastradas" valor={contas.length} detalhe="Cadastros disponíveis nesta operação" />
        <Kpi rotulo="Contas ativas" valor={ativas} detalhe={`${contas.length - ativas} inativa(s)`} />
        <Kpi rotulo="Conta padrão" valor={padrao?.apelido ?? "Não definida"} detalhe="Preferência para novas cobranças; não transfere saldo" />
      </div>
      <Card>
        <div className="flex flex-col gap-2 border-b border-contorno px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[15px] font-bold text-tinta">Contas da operação</h2>
            <p className="mt-1 text-[12px] text-tinta-suave">Dados do cadastro, sem misturar com certificado, convênio ou configurações da API.</p>
          </div>
          {!podeGerenciar ? <Selo nivel="neutro">modo consulta</Selo> : <Selo nivel="info">administrador</Selo>}
        </div>
        {contas.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="font-bold text-tinta">Nenhuma conta disponível</p>
            <p className="mt-1 text-[12px] text-tinta-suave">Verifique os cadastros e a lixeira com o administrador antes de importar novamente.</p>
          </div>
        ) : (
          <div className="overflow-x-auto" role="region" aria-label="Contas bancárias e ações do cadastro" tabIndex={0}>
            <table className="tabela tabela--acoes w-full">
              <caption className="sr-only">Contas bancárias, finalidade e situação cadastral</caption>
              <thead><tr><th>Conta e finalidade</th><th>Banco / agência / número</th><th>Situação</th><th>Histórico de boletos</th><th className="text-right">Ações</th></tr></thead>
              <tbody>
                {contas.map((conta) => (
                  <tr key={conta.id}>
                    <td><span className="block font-semibold text-tinta">{conta.apelido}</span><span className="mt-1 block text-[11px] text-tinta-suave">{FINALIDADES[conta.finalidade ?? ""] ?? "Não definida"}</span></td>
                    <td><span className="block text-[12px]">{conta.codigoBanco} · {conta.nomeBanco}</span><span className="mt-1 block font-mono text-[11px]">Ag. <Sigilo>{conta.agencia}</Sigilo> · Conta <Sigilo>{conta.numero}</Sigilo></span></td>
                    <td><div className="flex flex-wrap gap-1.5"><Selo nivel={conta.ativa ? "otimo" : "neutro"}>{conta.ativa ? "ativa" : "inativa"}</Selo>{conta.padrao ? <Selo nivel="info">padrão</Selo> : null}</div></td>
                    <td className="font-mono"><Sigilo>{conta._count.boletos}</Sigilo></td>
                    <td className="text-right">
                      <div className="flex flex-col items-end gap-2">
                        {podeGerenciar ? <EditarCadastro conta={conta} /> : null}
                        {podeIntegrar && conta.codigoBanco === "756" ? <Link href={`/integracoes/sicoob#conta-${conta.id}`} className="text-[12px] font-semibold text-oliva-escura hover:underline">Configurar integração</Link> : null}
                        <ExcluirRegistroLink tipo="CONTA" origemId={conta.id} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-contorno px-5 py-3 text-[11px] leading-relaxed text-tinta-suave">
          A conta padrão não altera títulos já emitidos. A exclusão é uma ação local auditada: não encerra a conta no banco e não cancela boletos.
        </p>
      </Card>
    </div>
  );
}

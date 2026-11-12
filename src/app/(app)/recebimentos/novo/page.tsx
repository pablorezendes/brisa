import { randomUUID } from "node:crypto";
import Link from "next/link";
import { acessoAtual, exigirPaginaAcesso, exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { pode } from "@/lib/acesso/politica";
import { exigirPermissaoFinanceira } from "@/lib/autorizacao";
import { prisma } from "@/lib/db";
import { idsGovernadosInativos } from "@/lib/governanca/filtros";
import { hojeISO } from "@/lib/dominio/periodo";
import { FormularioLancamentoManual } from "@/components/formulario-lancamento-manual";
import { btnSecundario, Card, inputBase, PageHeader } from "@/components/ui";
import { salvarRecebimentoManual } from "./actions";

export const metadata = { title: "Nova conta a receber — Brisa" };

export default async function PaginaNovaContaReceber() {
  await exigirPaginaAcesso("/recebimentos/novo");
  await exigirPermissaoAcesso("recebimentos.editar", { global: true });
  await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  const permiteReceber = pode(await acessoAtual(), "caixa.editar");
  const [contratosInativos, unidadesInativas, empreendimentosInativos] = await Promise.all([
    idsGovernadosInativos(prisma, "CONTRATO"), idsGovernadosInativos(prisma, "UNIDADE"), idsGovernadosInativos(prisma, "EMPREENDIMENTO"),
  ]);
  const contratos = await prisma.contrato.findMany({
    where: {
      id: { notIn: contratosInativos }, status: { in: ["ativo", "acordo"] },
      unidade: { ativo: true, id: { notIn: unidadesInativas }, empreendimento: { ativo: true, id: { notIn: empreendimentosInativos } } },
    },
    select: { id: true, locatario: { select: { nome: true } }, unidade: { select: { identificacao: true, empreendimento: { select: { nome: true } } } } },
    orderBy: [{ unidade: { empreendimento: { nome: "asc" } } }, { unidade: { identificacao: "asc" } }],
  });
  const campo = `${inputBase} mt-1 w-full`;

  return (
    <>
      <PageHeader titulo="Nova conta a receber" descricao="Registre uma cobrança avulsa para um contrato do Brisa." />
      <Card className="max-w-3xl p-5">
        {contratos.length ? (
          <FormularioLancamentoManual acao={salvarRecebimentoManual.bind(null, randomUUID())} cancelar="/recebimentos">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold sm:col-span-2">Contrato
                <select className={campo} name="contratoId" required defaultValue="">
                  <option value="" disabled>Selecione o contrato</option>
                  {contratos.map(contrato => (
                    <option key={contrato.id} value={contrato.id}>
                      {contrato.unidade.empreendimento.nome} · {contrato.unidade.identificacao} · {contrato.locatario?.nome ?? "Sem inquilino"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold">Valor (R$)<input className={campo} name="valor" inputMode="decimal" placeholder="0,00" required /></label>
              <label className="text-sm font-semibold">Vencimento<input className={campo} type="date" name="vencimento" defaultValue={hojeISO()} required /></label>
              <label className="text-sm font-semibold sm:col-span-2">Descrição<input className={campo} name="descricao" required maxLength={500} /></label>
            </div>
            {permiteReceber && <details className="rounded-lg border border-contorno p-3">
              <summary className="cursor-pointer text-sm font-semibold">Já foi recebido</summary>
              <p className="mt-2 text-sm text-tinta-suave">Informe a data para registrar a entrada no caixa. Deixe o valor recebido vazio se a conta foi quitada.</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <label className="text-sm">Data do recebimento<input className={campo} type="date" name="dataPagamento" /></label>
                <label className="text-sm">Valor recebido (R$)<input className={campo} name="recebido" inputMode="decimal" placeholder="Valor integral" /></label>
                <label className="text-sm sm:col-span-2">Forma de recebimento
                  <select className={campo} name="via">
                    <option value="PIX">Pix</option>
                    <option value="BOLETO">Boleto</option>
                    <option value="DINHEIRO">Dinheiro</option>
                    <option value="TRANSFERENCIA">Transferência</option>
                  </select>
                </label>
              </div>
            </details>}
          </FormularioLancamentoManual>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-tinta-suave">Cadastre um contrato ativo no Brisa para criar uma conta a receber.</p>
            <Link href="/recebimentos" className={btnSecundario}>Voltar</Link>
          </div>
        )}
      </Card>
    </>
  );
}

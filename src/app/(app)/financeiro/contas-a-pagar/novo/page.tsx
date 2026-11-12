import { randomUUID } from "node:crypto";
import { exigirPaginaAcesso, exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { prisma } from "@/lib/db";
import { obterEditorDespesa } from "@/lib/despesas/servico";
import { hojeISO } from "@/lib/dominio/periodo";
import { FormularioLancamentoManual } from "@/components/formulario-lancamento-manual";
import { Card, inputBase, PageHeader } from "@/components/ui";
import { salvarDespesaManual } from "./actions";

const ROTA = "/financeiro/contas-a-pagar";

export const metadata = { title: "Nova conta a pagar — Brisa" };

export default async function PaginaNovaContaPagar() {
  await exigirPaginaAcesso("/financeiro/contas-a-pagar/novo");
  const acesso = await exigirPermissaoAcesso("despesas.editar", { global: true });
  const { categorias, empreendimentos, contas, permitePagamento } = await obterEditorDespesa(prisma, {}, { id: acesso.usuarioId });
  const campo = `${inputBase} mt-1 w-full`;

  return (
    <>
      <PageHeader titulo="Nova conta a pagar" descricao="Registre uma despesa criada no Brisa." />
      <Card className="max-w-3xl p-5">
        <FormularioLancamentoManual acao={salvarDespesaManual.bind(null, randomUUID())} cancelar={ROTA}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">Fornecedor<input className={campo} name="fornecedor" required maxLength={250} /></label>
            <label className="text-sm font-semibold">Categoria
              <select className={campo} name="categoria" required defaultValue="">
                <option value="" disabled>Selecione a categoria</option>
                {categorias.filter(categoria => categoria.ativa !== false).map(categoria => <option key={categoria.codigo} value={categoria.codigo}>{categoria.rotulo}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold">Valor (R$)<input className={campo} name="valor" inputMode="decimal" placeholder="0,00" required /></label>
            <label className="text-sm font-semibold">Vencimento<input className={campo} type="date" name="vencimento" defaultValue={hojeISO()} required /></label>
            <label className="text-sm font-semibold sm:col-span-2">Descrição<input className={campo} name="descricao" required maxLength={1000} /></label>
            <label className="text-sm font-semibold sm:col-span-2">Quem assume a despesa
              <select className={campo} name="empreendimentoId">
                <option value="">Administradora</option>
                {empreendimentos.map(empreendimento => <option key={empreendimento.id} value={empreendimento.id}>{empreendimento.nome}</option>)}
              </select>
            </label>
          </div>
          <details className="rounded-lg border border-contorno p-3">
            <summary className="cursor-pointer text-sm font-semibold">Dados do documento</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="text-sm">Tipo
                <select className={campo} name="tipoDocumento">
                  <option value="SEM_DOCUMENTO">Sem documento</option>
                  <option value="NOTA_FISCAL">Nota fiscal</option>
                  <option value="BOLETO">Boleto</option>
                  <option value="GUIA">Guia</option>
                  <option value="RECIBO">Recibo</option>
                  <option value="OUTRO">Outro</option>
                </select>
              </label>
              <label className="text-sm">Número do documento<input className={campo} name="numero" maxLength={100} /></label>
              <label className="text-sm">Data de emissão<input className={campo} type="date" name="emissao" /></label>
              <label className="text-sm">CPF ou CNPJ do fornecedor<input className={campo} name="fornecedorDocumento" maxLength={30} /></label>
            </div>
          </details>
          {permitePagamento && (
            <details className="rounded-lg border border-contorno p-3">
              <summary className="cursor-pointer text-sm font-semibold">Já foi pago</summary>
              <p className="mt-2 text-sm text-tinta-suave">Preencha o pagamento para registrar a saída no caixa.</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <label className="text-sm">Data do pagamento<input className={campo} type="date" name="dataPagamento" /></label>
                <label className="text-sm">Forma de pagamento
                  <select className={campo} name="via">
                    <option value="PIX">Pix</option>
                    <option value="BOLETO">Boleto</option>
                    <option value="DINHEIRO">Dinheiro</option>
                    <option value="TRANSFERENCIA">Transferência</option>
                    <option value="CARTAO_CREDITO">Cartão de crédito</option>
                    <option value="CARTAO_DEBITO">Cartão de débito</option>
                  </select>
                </label>
                <label className="text-sm sm:col-span-2">Conta bancária
                  <select className={campo} name="contaBancariaId">
                    <option value="">Selecione se aplicável</option>
                    {contas.map(conta => <option key={conta.id} value={conta.id}>{conta.apelido}</option>)}
                  </select>
                </label>
              </div>
            </details>
          )}
        </FormularioLancamentoManual>
      </Card>
    </>
  );
}

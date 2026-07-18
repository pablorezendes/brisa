import Link from "next/link";
import { Card, btnPrimario, btnSecundario, inputBase } from "@/components/ui";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { NOME_MES_COMPLETO } from "@/lib/dominio/normalizacao";
import {
  STATUS_CONTRATO,
  TIPOS_UNIDADE,
  type ContratoComRelacoes,
  type UnidadeComEmpreendimento,
} from "@/lib/consultas/locacao";
import type { Empreendimento, Locatario } from "@prisma/client";

const rotulo = "block text-xs font-medium text-slate-600";

/**
 * Formulário de contrato (criar/editar) — 100% server-side.
 * A "nova unidade" e o "novo locatário", quando preenchidos, têm prioridade
 * sobre os selects (regra aplicada na server action).
 */
export function FormularioContrato({
  action,
  contrato,
  unidades,
  empreendimentos,
  locatarios,
}: {
  action: (formData: FormData) => Promise<void>;
  contrato?: ContratoComRelacoes;
  unidades: UnidadeComEmpreendimento[];
  empreendimentos: Empreendimento[];
  locatarios: Locatario[];
}) {
  const gruposUnidades = new Map<string, UnidadeComEmpreendimento[]>();
  for (const u of unidades) {
    const nome = u.empreendimento.nome;
    const lista = gruposUnidades.get(nome) ?? [];
    lista.push(u);
    gruposUnidades.set(nome, lista);
  }

  return (
    <form action={action} className="max-w-3xl space-y-4">
      {contrato ? <input type="hidden" name="id" value={contrato.id} /> : null}

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-bold">Unidade</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className={rotulo}>
            Unidade existente
            <select
              name="unidadeId"
              defaultValue={contrato?.unidadeId ?? ""}
              className={`${inputBase} mt-1 block max-w-96`}
            >
              <option value="">— selecione —</option>
              {Array.from(gruposUnidades.entries()).map(([nome, lista]) => (
                <optgroup key={nome} label={nome}>
                  {lista.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.identificacao} ({u.tipo})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="mb-2 text-xs text-slate-500">
            … ou criar unidade nova (a identificação será normalizada; se
            preenchida, tem prioridade sobre o select acima):
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className={rotulo}>
              Empreendimento
              <select
                name="novaUnidadeEmpreendimentoId"
                defaultValue=""
                className={`${inputBase} mt-1 block`}
              >
                <option value="">— selecione —</option>
                {empreendimentos.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className={rotulo}>
              Identificação
              <input
                name="novaUnidadeIdentificacao"
                placeholder="ex.: PIO XII SALA 01"
                className={`${inputBase} mt-1 block w-56`}
              />
            </label>
            <label className={rotulo}>
              Tipo
              <select
                name="novaUnidadeTipo"
                defaultValue="residencial"
                className={`${inputBase} mt-1 block`}
              >
                {TIPOS_UNIDADE.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-bold">Locatário</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className={rotulo}>
            Locatário existente
            <select
              name="locatarioId"
              defaultValue={contrato?.locatarioId ?? ""}
              className={`${inputBase} mt-1 block max-w-96`}
            >
              <option value="">— Desocupado —</option>
              {locatarios.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                  {l.cpfCnpj ? ` (${l.cpfCnpj})` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="mb-2 text-xs text-slate-500">
            … ou cadastrar locatário novo (se o nome for preenchido, tem
            prioridade sobre o select acima):
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className={rotulo}>
              Nome
              <input
                name="novoLocatarioNome"
                className={`${inputBase} mt-1 block w-64`}
              />
            </label>
            <label className={rotulo}>
              CPF/CNPJ
              <input
                name="novoLocatarioCpfCnpj"
                className={`${inputBase} mt-1 block w-44`}
              />
            </label>
            <label className={rotulo}>
              Contato
              <input
                name="novoLocatarioContato"
                placeholder="telefone / e-mail"
                className={`${inputBase} mt-1 block w-56`}
              />
            </label>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-bold">Valores e condições</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className={rotulo}>
            Valor (aluguel)
            <input
              name="valorBase"
              defaultValue={contrato ? formatarBRL(contrato.valorBase) : ""}
              placeholder="1.234,56"
              className={`${inputBase} mt-1 block w-32`}
            />
          </label>
          <label className={rotulo}>
            IPTU (repasse)
            <input
              name="iptu"
              defaultValue={contrato ? formatarBRL(contrato.iptu) : ""}
              placeholder="0,00"
              className={`${inputBase} mt-1 block w-28`}
            />
          </label>
          <label className={rotulo}>
            Condomínio (repasse)
            <input
              name="condominio"
              defaultValue={contrato ? formatarBRL(contrato.condominio) : ""}
              placeholder="0,00"
              className={`${inputBase} mt-1 block w-28`}
            />
          </label>
          <label className={rotulo}>
            Dia venc.
            <input
              name="diaVencimento"
              type="number"
              min={1}
              max={31}
              defaultValue={contrato?.diaVencimento ?? ""}
              className={`${inputBase} mt-1 block w-20`}
            />
          </label>
          <label className={rotulo}>
            Mês de reajuste
            <select
              name="mesReajuste"
              defaultValue={contrato?.mesReajuste ?? ""}
              className={`${inputBase} mt-1 block`}
            >
              <option value="">—</option>
              {NOME_MES_COMPLETO.slice(1).map((nome, i) => (
                <option key={nome} value={i + 1}>
                  {nome}
                </option>
              ))}
            </select>
          </label>
          <label className={rotulo}>
            Índice
            <select
              name="indiceReajuste"
              defaultValue={contrato?.indiceReajuste ?? ""}
              className={`${inputBase} mt-1 block`}
            >
              <option value="">—</option>
              <option value="IGPM">IGPM</option>
              <option value="IPCA">IPCA</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className={rotulo}>
            Status
            <select
              name="status"
              defaultValue={contrato?.status ?? "ativo"}
              className={`${inputBase} mt-1 block`}
            >
              {STATUS_CONTRATO.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className={rotulo}>
            Início
            <input
              type="date"
              name="inicio"
              defaultValue={contrato?.inicio ?? ""}
              className={`${inputBase} mt-1 block`}
            />
          </label>
          <label className={rotulo}>
            Fim
            <input
              type="date"
              name="fim"
              defaultValue={contrato?.fim ?? ""}
              className={`${inputBase} mt-1 block`}
            />
          </label>
          <label className={`${rotulo} grow`}>
            Observação
            <input
              name="observacao"
              defaultValue={contrato?.observacao ?? ""}
              className={`${inputBase} mt-1 block w-full`}
            />
          </label>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          IPTU e condomínio são repasses: compõem o total devido, mas nunca
          entram na base de cálculo da comissão.
        </p>
      </Card>

      <div className="flex gap-2">
        <button type="submit" className={btnPrimario}>
          {contrato ? "Salvar alterações" : "Criar contrato"}
        </button>
        <Link
          href={contrato ? `/contratos/${contrato.id}` : "/contratos"}
          className={btnSecundario}
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}

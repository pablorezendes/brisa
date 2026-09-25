import Link from "next/link";
import { Badge, Card, inputBase } from "@/components/ui";
import { ROTA_FISCAL, STATUS_FISCAIS, type PayloadFiscal } from "@/lib/fiscal/dominio";
import { salvarRascunho } from "./actions";

export const botaoFiscal = "inline-flex items-center justify-center rounded-lg bg-oliva-escura px-4 py-2.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40";
export const botaoFiscalSecundario = "inline-flex items-center justify-center rounded-lg border border-contorno bg-carta px-4 py-2.5 text-xs font-semibold text-tinta hover:bg-fundo";

export function AbasFiscais({ atual }: { atual: "notas" | "configuracao" }) {
  return <nav aria-label="Navegação fiscal" className="mb-5 flex flex-wrap items-center gap-2">
    <Link className={atual === "notas" ? botaoFiscal : botaoFiscalSecundario} href={ROTA_FISCAL}>Notas e acompanhamento</Link>
    <Link className={atual === "configuracao" ? botaoFiscal : botaoFiscalSecundario} href={`${ROTA_FISCAL}/configuracao`}>Emitente e configuração</Link>
    <span className="ml-auto"><Badge cor="ambar">Restrito · administrador</Badge></span>
  </nav>;
}

export function AvisoFiscal({ erro, ok }: { erro?: string; ok?: string }) {
  return erro || ok ? <div role="status" className={`mb-4 rounded-lg border p-3 text-sm ${erro ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{(erro || ok)?.slice(0, 300)}</div> : null;
}

export function StatusFiscal({ status }: { status: string }) {
  return <Badge cor={status === "AUTORIZADA" ? "verde" : ["REJEITADA", "INCERTA"].includes(status) ? "vermelho" : ["PROCESSANDO", "TRANSMITINDO"].includes(status) ? "ambar" : "azul"}>{STATUS_FISCAIS[status] ?? "Situação a verificar"}</Badge>;
}

export function CampoFiscal({ titulo, nome, valor = "", tipo = "text", dica, obrigatorio = true, max, somenteLeitura = false }: { titulo: string; nome: string; valor?: string | number; tipo?: string; dica?: string; obrigatorio?: boolean; max?: number; somenteLeitura?: boolean }) {
  return <label className="block min-w-0 text-xs font-semibold text-tinta">{titulo}<input className={`${inputBase} mt-1.5 block w-full min-w-0`} name={nome} type={tipo} defaultValue={valor} required={obrigatorio} maxLength={max} readOnly={somenteLeitura} />{dica && <span className="mt-1 block text-[11px] font-normal leading-relaxed text-tinta-suave">{dica}</span>}</label>;
}

export function SelecaoFiscal({ titulo, nome, valor = "", opcoes, dica, obrigatorio = true }: { titulo: string; nome: string; valor?: string; opcoes: [string,string][]; dica?: string; obrigatorio?: boolean }) {
  return <label className="block min-w-0 text-xs font-semibold text-tinta">{titulo}<select className={`${inputBase} mt-1.5 block w-full min-w-0`} name={nome} defaultValue={valor} required={obrigatorio}><option value="">{obrigatorio ? "Selecione após conferência" : "Não se aplica / não informado"}</option>{opcoes.map(([id, texto]) => <option key={id} value={id}>{texto}</option>)}</select>{dica && <span className="mt-1 block text-[11px] font-normal text-tinta-suave">{dica}</span>}</label>;
}

export function FormularioRascunho({ nota }: { nota?: { id: string; origemChave: string | null; payloadHash: string; payload: string } }) {
  const p: PayloadFiscal = nota ? JSON.parse(nota.payload) : {};
  return <form action={salvarRascunho} className="space-y-4">
    {nota && <><input type="hidden" name="id" value={nota.id}/><input type="hidden" name="payloadHash" value={nota.payloadHash}/></>}
    <Card className="p-5 sm:p-6">
      <h2 className="text-sm font-bold text-tinta">1. Prestação de serviço</h2><p className="mt-1 text-xs leading-relaxed text-tinta-suave">O identificador da prestação é a trava contra duplicidade. Reutilize sempre o mesmo código de origem para o mesmo serviço.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CampoFiscal nome="origemChave" titulo="Identificador único da prestação" valor={nota?.origemChave ?? ""} max={140} somenteLeitura={Boolean(nota)} dica="Ex.: serviço-contrato-123-2026-09. Não use só o nome ou o valor." />
        <CampoFiscal nome="competencia" titulo="Data de competência" tipo="date" valor={String(p.data_competencia ?? "")} />
        <CampoFiscal nome="valorServico" titulo="Valor efetivo do serviço (R$)" valor={p.valor_servico === undefined ? "" : Number(p.valor_servico).toFixed(2)} max={20} dica="Sem separador de milhar. Não é o valor bruto do aluguel, IPTU ou condomínio." />
      </div>
      <label className="mt-4 block text-xs font-semibold text-tinta">Descrição completa do serviço<textarea name="descricao" required maxLength={1000} rows={3} defaultValue={String(p.descricao_servico ?? "")} className={`${inputBase} mt-1.5 w-full`} /></label>
    </Card>
    <Card className="p-5 sm:p-6">
      <h2 className="text-sm font-bold text-tinta">2. Tomador e endereço fiscal</h2><p className="mt-1 text-xs text-tinta-suave">Quem contratou o serviço, não necessariamente quem paga o aluguel.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CampoFiscal nome="tomadorNome" titulo="Nome / razão social" valor={p.razao_social_tomador} max={150}/>
        <CampoFiscal nome="tomadorDocumento" titulo="CPF / CNPJ" valor={p.cpf_tomador ?? p.cnpj_tomador} max={24}/>
        <CampoFiscal nome="municipioTomador" titulo="Código IBGE do município" valor={p.codigo_municipio_tomador} max={7}/>
        <CampoFiscal nome="cepTomador" titulo="CEP" valor={p.cep_tomador} max={9}/>
        <CampoFiscal nome="logradouroTomador" titulo="Logradouro" valor={p.logradouro_tomador} max={255}/>
        <CampoFiscal nome="numeroTomador" titulo="Número" valor={p.numero_tomador} max={60}/>
        <CampoFiscal nome="bairroTomador" titulo="Bairro" valor={p.bairro_tomador} max={60}/>
        <CampoFiscal nome="complementoTomador" titulo="Complemento" valor={p.complemento_tomador} obrigatorio={false} max={156}/>
        <SelecaoFiscal nome="consumidorFinal" titulo="Uso / consumo pessoal" valor={String(p.consumidor_final ?? "")} opcoes={[["0", "Não"],["1", "Sim"]]}/>
      </div>
    </Card>
    <Card className="p-5">
      <label className="flex items-start gap-3 text-xs leading-relaxed text-tinta"><input type="checkbox" name="escopoConfirmado" required className="mt-0.5"/><span>Revisei com o responsável fiscal: serviço tributável prestado em Goiânia, sem retenções, deduções, exportação, obra, regime especial ou outro tratamento não suportado. O valor informado é exclusivamente o serviço; tomador e enquadramento estão corretos.</span></label>
      <div className="mt-4 flex flex-wrap items-center gap-3"><button className={botaoFiscal}>Salvar rascunho · não emite</button><span className="text-xs text-tinta-suave">Aprovação e transmissão são etapas separadas.</span></div>
    </Card>
  </form>;
}

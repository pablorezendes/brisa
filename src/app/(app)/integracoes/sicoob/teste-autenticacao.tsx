"use client";

import { useActionState } from "react";
import { Selo, btnPrimario } from "@/components/ui";
import { testarAutenticacaoSicoob } from "./actions";
import type { EstadoTesteSicoob } from "./tipos";

export function TesteAutenticacaoSicoob({ ambiente }: { ambiente: "sandbox" | "producao" }) {
  const [estado, acao, pendente] = useActionState(testarAutenticacaoSicoob, {} as EstadoTesteSicoob);
  const resultado = estado.resultado;
  return <div>
    <form action={acao} className="space-y-4">
      <label className="flex items-start gap-3 text-[13px] leading-relaxed text-tinta">
        <input type="checkbox" name="confirmarTeste" required disabled={pendente} className="mt-1 h-4 w-4 shrink-0 accent-[#26776b]" />
        <span>Autorizo testar a autenticação no {ambiente === "producao" ? "Sicoob de produção" : "ambiente sandbox"} com as credenciais já instaladas. Este teste não emite, cancela ou consulta cobranças e não dá baixa.</span>
      </label>
      <button type="submit" disabled={pendente} className={`${btnPrimario} disabled:cursor-wait disabled:opacity-60`}>
        {pendente ? "Validando autenticação…" : "Testar autenticação sem emitir boleto"}
      </button>
    </form>
    <div aria-live="polite" aria-atomic="true" className="mt-4">
      {estado.erro && <p role="alert" className="rounded-lg border border-erro/25 bg-erro/5 p-3 text-[13px] text-erro">{estado.erro}</p>}
      {resultado && <div className="space-y-2 rounded-lg border border-contorno p-4">
        <Selo nivel={resultado.autenticacaoValidada ? "otimo" : "atencao"}>{resultado.autenticacaoValidada ? "Autenticação confirmada" : "Requer atenção"}</Selo>
        <p className="text-[13px] leading-relaxed text-tinta">{resultado.mensagem}</p>
        {resultado.pendencias.length > 0 && <ul className="list-inside list-disc space-y-1 break-words text-[12px] text-tinta-suave">{resultado.pendencias.map(item => <li key={item}>{item}</li>)}</ul>}
        <p className="text-[12px] text-tinta-suave">Teste em {new Date(resultado.verificadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Resultado desta sessão; refaça após alterar credenciais.</p>
        <p className="text-[12px] font-semibold text-tinta">Convênio e emissão não são homologados por este teste. Nenhuma conta foi habilitada ou marcada como pronta.</p>
      </div>}
    </div>
  </div>;
}

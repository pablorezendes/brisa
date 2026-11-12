"use client";

import { useActionState } from "react";
import { btnPrimario, inputBase } from "@/components/ui";
import { enviarCertificadoSicoob } from "./actions";
import type { EstadoCertificadoSicoob } from "./tipos";

export function CertificadoSicoob({ pedirClientId }: { pedirClientId: boolean }) {
  const [estado, enviar, pendente] = useActionState(enviarCertificadoSicoob, {} as EstadoCertificadoSicoob);
  return (
    <form action={enviar} className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-[13px] font-semibold text-tinta">
          Certificado A1
          <input className={`${inputBase} mt-1.5 w-full`} name="certificado" type="file" accept=".pfx,.p12" required />
        </label>
        <label className="block text-[13px] font-semibold text-tinta">
          Senha do certificado
          <input className={`${inputBase} mt-1.5 w-full`} name="senhaCertificado" type="password" autoComplete="new-password" maxLength={512} required />
        </label>
        {pedirClientId && <>
          <label className="block text-[13px] font-semibold text-tinta">
            Client ID da aplicação
            <input className={`${inputBase} mt-1.5 w-full`} name="clientId" autoComplete="off" maxLength={200} required />
          </label>
          <label className="block text-[13px] font-semibold text-tinta">
            Ambiente da aplicação
            <select className={`${inputBase} mt-1.5 w-full`} name="ambiente" defaultValue="producao" required>
              <option value="producao">Produção</option>
              <option value="sandbox">Testes</option>
            </select>
          </label>
        </>}
      </div>
      <button className={btnPrimario} type="submit" disabled={pendente}>
        {pendente ? "Validando com o Sicoob…" : "Validar e salvar certificado"}
      </button>
      <div aria-live="polite">
        {estado.erro && <p role="alert" className="text-[13px] text-erro">{estado.erro}</p>}
        {estado.sucesso && <p className="text-[13px] font-semibold text-oliva-escura">{estado.sucesso}</p>}
      </div>
    </form>
  );
}

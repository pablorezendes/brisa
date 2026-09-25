"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { digestSeguro } from "../lib/diagnostico-seguro";

export type ErroPaginaProps = {
  error: Error & { digest?: string };
  unstable_retry: () => void;
};

const botao: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 44,
  borderRadius: 9, padding: "10px 16px", border: "1px solid #dce4e6",
  font: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer", textDecoration: "none",
};

/** Independente do shell/CSS global para continuar funcionando em global-error. */
export function RecuperacaoPagina({ error, unstable_retry, global = false }: ErroPaginaProps & { global?: boolean }) {
  const [pendente, iniciarTransicao] = useTransition();
  const [avisoCopia, setAvisoCopia] = useState("");
  const digest = digestSeguro(error.digest);

  async function copiarCodigo() {
    if (!digest) return;
    try {
      await navigator.clipboard.writeText(digest);
      setAvisoCopia("Código copiado.");
    } catch {
      setAvisoCopia("Selecione o código abaixo para copiar manualmente.");
    }
  }

  return (
    <section aria-labelledby="titulo-recuperacao" style={{ boxSizing: "border-box", width: "100%", padding: global ? "clamp(20px, 6vw, 64px)" : "clamp(20px, 4vw, 48px)", fontFamily: "Arial, Helvetica, sans-serif", color: "#17282c" }}>
      <div style={{ boxSizing: "border-box", width: "100%", maxWidth: 650, margin: "24px auto", padding: "clamp(20px, 5vw, 40px)", background: "#fff", border: "1px solid #dce4e6", borderRadius: 16, boxShadow: "0 8px 28px rgba(16,35,38,.04)" }}>
        <div aria-hidden="true" style={{ display: "inline-flex", color: "#b67818", background: "#fff7e9", borderRadius: 12, padding: 12 }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M10.3 4.2a2 2 0 0 1 3.4 0l7.2 12.5a2 2 0 0 1-1.7 3H4.8a2 2 0 0 1-1.7-3L10.3 4.2Z" stroke="currentColor" strokeWidth="1.7"/><path d="M12 9v4m0 3h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        </div>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "#347c69", margin: "20px 0 8px" }}>Brisa · Recuperação de página</p>
        <h1 id="titulo-recuperacao" style={{ fontSize: "clamp(22px, 4vw, 28px)", lineHeight: 1.25, margin: "0 0 12px", letterSpacing: "-.025em" }}>Não foi possível carregar esta página</h1>
        <p style={{ margin: "0 0 14px", fontSize: 15, lineHeight: 1.65, color: "#53676b" }}>O sistema encontrou uma falha. Tente carregar novamente{global ? " ou volte à tela de acesso." : "; você também pode continuar pelo menu lateral."}</p>
        <p style={{ margin: "0 0 24px", fontSize: 13, lineHeight: 1.6, color: "#53676b" }}>Se a falha ocorreu depois de salvar, emitir ou enviar, confira o histórico antes de repetir a operação. Carregar a página não reenvia a ação.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button type="button" disabled={pendente} onClick={() => iniciarTransicao(() => unstable_retry())} style={{ ...botao, background: "#245f51", borderColor: "#245f51", color: "#fff", opacity: pendente ? .65 : 1, cursor: pendente ? "wait" : "pointer" }}>{pendente ? "Carregando…" : "Tentar carregar novamente"}</button>
          {/* Navegação completa deliberada: funciona mesmo se o roteador falhou. */}
          <a href={global ? "/login" : "/"} style={{ ...botao, background: "#fff", color: "#245f51" }}>{global ? "Voltar ao acesso" : "Ir para o início"}</a>
        </div>
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#53676b", minHeight: 20, margin: "12px 0 0" }}>{pendente ? "Consultando a página novamente…" : avisoCopia}</p>
        {digest ? <div style={{ borderTop: "1px solid #e5ebed", paddingTop: 18, marginTop: 8 }}>
          <label htmlFor="codigo-suporte" style={{ display: "block", fontSize: 12, color: "#53676b", marginBottom: 8 }}>Código para suporte</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <input id="codigo-suporte" readOnly value={digest} onFocus={e => e.currentTarget.select()} style={{ boxSizing: "border-box", minWidth: 0, maxWidth: "100%", flex: "1 1 160px", border: "1px solid #dce4e6", borderRadius: 8, padding: "10px 12px", background: "#f7f9fa", color: "#17282c", font: "14px monospace" }}/>
            <button type="button" onClick={copiarCodigo} style={{ ...botao, background: "#fff", color: "#245f51" }}>Copiar código</button>
          </div>
        </div> : <p style={{ fontSize: 12, lineHeight: 1.5, color: "#53676b", margin: "8px 0 0" }}>Se persistir, informe ao suporte a tela e o horário da falha, sem compartilhar dados de clientes ou credenciais.</p>}
      </div>
    </section>
  );
}

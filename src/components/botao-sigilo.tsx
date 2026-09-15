"use client";

import { useSyncExternalStore } from "react";

export const CHAVE_SIGILO = "brisa:valores-visiveis";
const EVENTO_SIGILO = "brisa:preferencia-sigilo";

type LeitorPreferencia = Pick<Storage, "getItem">;
type GravadorPreferencia = Pick<Storage, "setItem">;

export function lerPreferenciaSigilo(storage: LeitorPreferencia | null | undefined): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(CHAVE_SIGILO) === "true";
  } catch {
    return false;
  }
}

export function gravarPreferenciaSigilo(
  storage: GravadorPreferencia | null | undefined,
  visiveis: boolean
): void {
  if (!storage) return;
  try {
    storage.setItem(CHAVE_SIGILO, String(visiveis));
  } catch {
    // Navegação privada ou políticas corporativas podem bloquear o storage.
    // O estado ainda funciona na página atual pelo atributo do documento.
  }
}

function aplicarNoDocumento(visiveis: boolean): void {
  document.documentElement.dataset.valoresVisiveis = String(visiveis);
}

function storageDoNavegador(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function lerPreferenciaDoNavegador(): boolean | null {
  const storage = storageDoNavegador();
  if (!storage) return null;
  try {
    return storage.getItem(CHAVE_SIGILO) === "true";
  } catch {
    return null;
  }
}

let preferenciaAtual = false;
let preferenciaInicializada = false;
const assinantes = new Set<() => void>();

function snapshotPreferencia(): boolean {
  return preferenciaAtual;
}

function snapshotServidor(): boolean {
  return false;
}

function atualizarPreferencia(visiveis: boolean): void {
  aplicarNoDocumento(visiveis);
  if (preferenciaAtual === visiveis) return;
  preferenciaAtual = visiveis;
  assinantes.forEach((notificar) => notificar());
}

function assinarPreferencia(notificar: () => void): () => void {
  const primeiroAssinanteAtivo = assinantes.size === 0;
  assinantes.add(notificar);

  if (!preferenciaInicializada || primeiroAssinanteAtivo) {
    preferenciaInicializada = true;
    atualizarPreferencia(lerPreferenciaDoNavegador() ?? preferenciaAtual);
  } else {
    aplicarNoDocumento(preferenciaAtual);
  }

  const sincronizarNaPagina = (evento: Event) => {
    atualizarPreferencia((evento as CustomEvent<boolean>).detail);
  };
  const sincronizarEntreAbas = (evento: StorageEvent) => {
    if (evento.key !== CHAVE_SIGILO && evento.key !== null) return;
    const proximo =
      evento.key === null
        ? lerPreferenciaSigilo(storageDoNavegador())
        : evento.newValue === "true";
    atualizarPreferencia(proximo);
  };

  window.addEventListener(EVENTO_SIGILO, sincronizarNaPagina);
  window.addEventListener("storage", sincronizarEntreAbas);
  return () => {
    assinantes.delete(notificar);
    window.removeEventListener(EVENTO_SIGILO, sincronizarNaPagina);
    window.removeEventListener("storage", sincronizarEntreAbas);
  };
}

/**
 * Controle global de privacidade dos números.
 *
 * A preferência vive no navegador e é aplicada ao <html>, portanto sobrevive
 * às trocas de rota. Um evento próprio mantém múltiplos botões sincronizados
 * na mesma página; o evento `storage` faz o mesmo entre abas.
 */
export function BotaoSigilo() {
  const visiveis = useSyncExternalStore(
    assinarPreferencia,
    snapshotPreferencia,
    snapshotServidor
  );

  const alternar = () => {
    const proximo = !preferenciaAtual;
    atualizarPreferencia(proximo);
    gravarPreferenciaSigilo(storageDoNavegador(), proximo);
    window.dispatchEvent(new CustomEvent<boolean>(EVENTO_SIGILO, { detail: proximo }));
  };

  return (
    <button
      type="button"
      onClick={alternar}
      aria-label="Visualização dos valores"
      aria-pressed={visiveis}
      title={visiveis ? "Ocultar os valores em todas as páginas" : "Mostrar os valores em todas as páginas"}
      className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-contorno bg-carta px-3 text-[11px] font-semibold text-tinta-suave shadow-[0_1px_2px_rgba(16,35,38,0.03)] transition-all hover:border-[#aebabc] hover:bg-[#f8fafb] hover:text-tinta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oliva/30"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.8" />
        <path
          className="olho-velado"
          d="M3.5 3.5l17 17"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      <span className="olho-velado">Ver valores</span>
      <span className="olho-revelado">Ocultar valores</span>
    </button>
  );
}

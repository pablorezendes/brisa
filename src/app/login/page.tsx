import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { sessaoAtual } from "@/lib/auth";
import { btnPrimario, inputBase } from "@/components/ui";
import { criarPrimeiroUsuario, entrar } from "./actions";

export const dynamic = "force-dynamic";

const MENSAGENS: Record<string, string> = {
  credenciais: "Usuário ou senha incorretos.",
  vazio: "Preencha todos os campos.",
  senha_curta: "A senha precisa de pelo menos 8 caracteres.",
  senhas_diferentes: "As senhas digitadas não conferem.",
};

function CampoRotulo({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.09em] text-tinta-suave">
      {children}
    </span>
  );
}

function SimboloBrisa({ escuro = false }: { escuro?: boolean }) {
  return (
    <span className={`flex h-11 w-11 items-center justify-center rounded-xl border ${escuro ? "border-contorno bg-[#f6f9f9] text-oliva" : "border-white/15 bg-white/[0.07] text-[#72d3b4]"}`}>
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d="M8 6h9.5a5.5 5.5 0 0 1 0 11H8V6Z" stroke="currentColor" strokeWidth="2.4" />
        <path d="M8 17h11a5 5 0 0 1 0 10H8V17Z" stroke="currentColor" strokeWidth="2.4" />
        <path d="M3 10c2.2 0 3.1 1.2 5 1.2S10.8 10 13 10" stroke={escuro ? "#17282c" : "#fff"} strokeOpacity=".65" strokeWidth="1.6" />
      </svg>
    </span>
  );
}

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  if (await sessaoAtual()) redirect("/");

  const { erro } = await searchParams;
  const primeiroAcesso = (await prisma.usuario.count()) === 0;
  const hoje = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <main className="grid min-h-screen bg-white md:grid-cols-[minmax(340px,0.82fr)_minmax(480px,1.18fr)]">
      <section className="relative hidden min-h-screen overflow-hidden bg-[#102326] p-10 text-white md:flex md:flex-col lg:p-14">
        <div className="login-grid pointer-events-none absolute inset-0 opacity-35" aria-hidden="true" />
        <div className="absolute -bottom-32 -right-28 h-80 w-80 rounded-full border border-[#5bc5a3]/20" aria-hidden="true" />
        <div className="absolute -bottom-16 -right-12 h-52 w-52 rounded-full border border-[#5bc5a3]/25" aria-hidden="true" />

        <div className="relative flex items-center gap-3">
          <SimboloBrisa />
          <div>
            <div className="text-[22px] font-bold leading-none tracking-[-0.035em]">Brisa</div>
            <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.22em] text-[#8fa5a7]">Gestão de imóveis</div>
          </div>
        </div>

        <div className="relative my-auto max-w-lg py-16">
          <span className="mb-5 inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-[#9eb2b3]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#59c7a3]" />
            Controle financeiro centralizado
          </span>
          <h1 className="max-w-md text-[38px] font-bold leading-[1.12] tracking-[-0.045em] text-white lg:text-[46px]">
            Gestão imobiliária, sem ruído.
          </h1>
          <p className="mt-5 max-w-md text-[14px] leading-7 text-[#a9b9ba] lg:text-[15px]">
            Contratos, recebimentos, caixa e temporada em uma visão clara para decisões mais rápidas e seguras.
          </p>
        </div>

        <div className="relative grid grid-cols-3 gap-3 border-t border-white/[0.08] pt-6">
          {["Contratos", "Recebimentos", "Caixa"].map((item, indice) => (
            <div key={item}>
              <div className="mb-2 text-[10px] font-bold text-[#62caa8]">0{indice + 1}</div>
              <div className="text-[11px] font-semibold text-[#c7d2d3]">{item}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex min-h-screen items-center justify-center bg-[#f7f9fa] px-5 py-10 sm:px-10">
        <div className="w-full max-w-[420px]">
          <div className="mb-10 flex items-center gap-3 md:hidden">
            <SimboloBrisa escuro />
            <div>
              <div className="text-xl font-bold leading-none text-tinta">Brisa</div>
              <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.2em] text-tinta-suave">Gestão de imóveis</div>
            </div>
          </div>

          <p className="mb-2 text-[9px] font-bold uppercase tracking-[0.17em] text-oliva">Acesso seguro</p>
          <h2 className="text-[30px] font-bold leading-tight tracking-[-0.04em] text-tinta sm:text-[34px]">
            {primeiroAcesso ? "Configure seu acesso" : "Bem-vindo de volta"}
          </h2>
          <p className="mt-2 text-[13px] capitalize text-tinta-suave">{hoje}</p>

          <div className="mt-8 rounded-2xl border border-contorno bg-carta p-6 shadow-[0_12px_35px_rgba(16,35,38,0.07)] sm:p-8">
            {erro && MENSAGENS[erro] ? (
              <div className="mb-5 flex items-center gap-2 rounded-lg border border-[#edcbd0] bg-[#fff7f8] px-3 py-2.5 text-[12px] font-medium text-erro">
                <span className="inline-block h-2 w-2 rounded-full bg-erro" />
                {MENSAGENS[erro]}
              </div>
            ) : null}

            {primeiroAcesso ? (
              <>
                <p className="mb-5 text-[13px] leading-relaxed text-tinta-suave">
                  Crie a conta do administrador para começar a usar o sistema.
                </p>
                <form action={criarPrimeiroUsuario} className="space-y-4">
                  <label className="block">
                    <CampoRotulo>Seu nome</CampoRotulo>
                    <input name="nome" type="text" required autoFocus className={`${inputBase} w-full`} placeholder="Antonio Camargo" />
                  </label>
                  <label className="block">
                    <CampoRotulo>Usuário</CampoRotulo>
                    <input name="usuario" type="text" required autoCapitalize="none" className={`${inputBase} w-full`} placeholder="antonio" />
                  </label>
                  <label className="block">
                    <CampoRotulo>Senha (mín. 8 caracteres)</CampoRotulo>
                    <input name="senha" type="password" required minLength={8} className={`${inputBase} w-full`} />
                  </label>
                  <label className="block">
                    <CampoRotulo>Confirme a senha</CampoRotulo>
                    <input name="confirma" type="password" required className={`${inputBase} w-full`} />
                  </label>
                  <button type="submit" className={`${btnPrimario} mt-1 w-full justify-center`}>Criar conta e entrar</button>
                </form>
              </>
            ) : (
              <form action={entrar} className="space-y-5">
                <label className="block">
                  <CampoRotulo>Usuário</CampoRotulo>
                  <input name="usuario" type="text" required autoFocus autoCapitalize="none" autoComplete="username" className={`${inputBase} w-full`} placeholder="Digite seu usuário" />
                </label>
                <label className="block">
                  <CampoRotulo>Senha</CampoRotulo>
                  <input name="senha" type="password" required autoComplete="current-password" className={`${inputBase} w-full`} placeholder="••••••••" />
                </label>
                <label className="flex cursor-pointer items-center gap-2.5 text-[12px] text-tinta-suave">
                  <input name="lembrar" type="checkbox" className="h-4 w-4 rounded border-contorno accent-[#347c69]" />
                  Continuar conectado por 30 dias
                </label>
                <button type="submit" className={`${btnPrimario} w-full justify-center py-2.5`}>Entrar no sistema</button>
              </form>
            )}
          </div>

          <div className="mt-6 flex items-center justify-between text-[10px] text-[#8a999c]">
            <span>Grupo Brisa · A.Camargo</span>
            <span className="inline-flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" /><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" /></svg>
              Ambiente protegido
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}

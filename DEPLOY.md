# Deploy — brisa.tescod.com

Stack alvo: VPS Ubuntu com Docker + Traefik (padrão `/srv/stack/<app>`).
App: Next.js 16 + Prisma + SQLite num único container; banco no volume
`./dados`; Traefik faz o TLS. O controle de acesso é o **login do próprio
app** (`/login`) — sessão assinada em cookie httpOnly.

## 0) Pré-requisitos (uma vez)

1. **DNS**: registro `A` `brisa.tescod.com → 76.13.161.105`
   (ou um CNAME, se você usa wildcard no domínio).

   > **Cloudflare com proxy ligado (nuvem laranja):** veja a seção
   > "Cloudflare" no fim deste arquivo antes de subir — a nuvem laranja
   > atrapalha a emissão do certificado e pode gerar laço de redirecionamento.

2. **Descobrir os nomes do seu Traefik** (variam por instalação):
   ```bash
   docker network ls                                   # nome da rede (ex.: traefik, proxy, web)
   grep -ri "certresolver\|certificatesresolvers" /srv/stack/traefik | head
   ```
   Ajuste no `docker-compose.yml` deste repo:
   - `networks: traefik: external: true` → nome real da rede;
   - `tls.certresolver=letsencrypt` → nome real do resolver.

## 1) No servidor — clonar e configurar

```bash
cd /srv/stack/acamargo
git clone https://github.com/pablorezendes/brisa.git .
mkdir -p dados data

# segredo de assinatura das sessões de login (obrigatório)
printf "AUTH_SECRET=%s\n" "$(openssl rand -hex 32)" > .env
chmod 600 .env
```

> A autenticação agora é do próprio app: a primeira visita a
> https://brisa.tescod.com abre a tela de **Primeiro acesso**, onde
> você cria o usuário administrador. Usuários adicionais / redefinir senha:
> `docker compose exec brisa npm run usuario -- "Nome" login "senha"`.

## 2) Enviar o dataset (fora do git — contém dados reais)

Do Windows (PowerShell), na pasta do projeto local:

```powershell
scp "C:\Users\pablorezendes\Documents\ACAMARGO\sistema\data\dataset.json" root@76.13.161.105:/srv/stack/acamargo/data/dataset.json
```

## 3) Subir e semear (seed é RECARGA TOTAL — rodar só na implantação)

```bash
cd /srv/stack/acamargo
docker compose up -d --build
docker compose logs -f --tail 20 brisa     # aguarde "Ready"; Ctrl+C para sair

# primeira carga (APAGA e reimporta tudo — nunca rodar depois do corte
# com lançamentos feitos direto no sistema):
docker compose exec brisa npm run db:seed

# prova de paridade com as planilhas dentro do container:
docker compose exec brisa npm run reconciliar
```

Abra https://brisa.tescod.com — o app pede o login criado no primeiro acesso.

## 4) Atualizações futuras

### Categorias de despesas e fornecedores (26/10/2026)

Em **Financeiro → Contas a pagar → Categorias**, o administrador pode criar,
renomear, inativar e reativar classificações. As categorias iniciais continuam
disponíveis; não é necessário executar seed. Uma categoria inativa deixa de ser
oferecida em novas despesas, mas permanece nos lançamentos que já a usam.
Renomear a categoria não altera a classificação histórica nem o pagamento.
Categorias de comissão são reservadas ao administrador; essa proteção também
se aplica às despesas que já utilizam uma categoria marcada como restrita.

Em **Cadastros → Fornecedores**, consulte os fornecedores importados e cadastre
os novos. Uma pessoa existente pode ganhar o papel de fornecedor sem ser
duplicada. O sistema confere CPF/CNPJ e oferece o cadastro já localizado para
vinculação explícita. As alterações de cadastro exigem a permissão de edição
de cadastros; consulta e seleção exigem acesso aos dados pessoais e carteira
global autorizada.

Em **Contas a pagar → Nova despesa**, selecione o fornecedor e a categoria.
É possível cadastrar ambos durante o preenchimento sem perder a despesa.
Fornecedor, categoria e rateio não criam pagamentos: a seção de pagamento
continua decidindo entre manter em aberto, vincular uma saída existente ou
registrar uma única saída. Cadastros novos não reimportam dados do Widesys.

Esta versão adiciona o catálogo persistente e vínculos opcionais na despesa.
Atualize com backup consistente; não execute seed nem reimportação:

```bash
set -e
cd /srv/stack/acamargo
git pull --ff-only origin main
docker compose build brisa
docker compose stop brisa
umask 077
backup="/srv/backups/brisa-cadastros-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
cp -a dados "$backup/"
docker compose up -d --no-deps brisa
docker compose logs --tail 80 brisa
curl --retry 12 --retry-delay 5 --retry-all-errors -fsSI https://brisa.tescod.com/login
```

### Nota única com rateio manual de despesas (23/10/2026)

Em **Financeiro → Contas a pagar**, use **Nova despesa com rateio**, ou
**Ratear despesa** na linha de um título existente. Informe os valores de cada
empreendimento manualmente. Um imóvel é opcional e precisa pertencer ao
empreendimento escolhido. Salve como rascunho enquanto houver saldo a distribuir;
**Conferir rateio** exige que a soma corresponda exatamente à nota.

Há uma nota e um pagamento, independentemente do número de parcelas. Para um
PIX já importado, escolha **Vincular saída existente** e confira sua data, caixa
e descrição. Não registre outra saída. Registrar pagamento novo é uma ação
explícita, exige permissão de caixa e não faz transferência bancária. Títulos do
Widesys recebem somente o rateio complementar, preservando valor, origem e
pagamento. Se a fonte mudar, o rateio exige nova conferência.

**Custos por empreendimento** mostra somente parcelas conferidas de notas
operacionais válidas, por competência. Não some esses custos novamente à nota
ou ao caixa. Em **Minha carteira → Custos rateados**, cada usuário vê somente
sua parcela autorizada, sem nota integral, anexos ou valores de outras carteiras.
Comissões continuam restritas. O rateio é gerencial e não emite documentos
fiscais nem cria reembolsos automáticos entre CNPJs.

O administrador tem acesso completo. Demais operadores precisam das permissões
**Consultar notas de despesas e rateios completos** e **Cadastrar despesas e
conferir rateios manuais**, com carteira global; registrar ou vincular pagamento
exige também **Alterar movimentações de caixa**. Anexos PDF/JPEG/PNG ficam no
banco privado, limitados a 5 MB por arquivo e dez arquivos por nota.

Esta atualização **adiciona tabelas**. Faça backup consistente com o aplicativo
parado. A inicialização sincroniza o schema sem apagar dados. Não execute seed,
não reimporte planilhas e não use `--accept-data-loss`:

```bash
set -e
cd /srv/stack/acamargo
git pull --ff-only origin main
docker compose build brisa
docker compose stop brisa
umask 077
backup="/srv/backups/brisa-rateio-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
cp -a dados "$backup/"
docker compose up -d --no-deps brisa
docker compose logs --tail 100 brisa
curl --retry 12 --retry-delay 5 --retry-all-errors -fsSI https://brisa.tescod.com/login
```

Se o Git encontrar divergências ou a sincronização do schema falhar, pare e
revise o erro; não force. O exemplo de nota informado no chat não é cadastrado
automaticamente. A implantação preserva os dados atuais e não envia pagamentos,
mensagens ou documentos fiscais a terceiros.

### Exclusão em lote e desempenho das contas (22/10/2026)

Em **Financeiro → Contas a pagar / Contas a receber**, administradores
autorizados podem marcar os lançamentos e usar **Excluir selecionados**.
A seleção vale somente para a página atual; **Por página** permite 25, 50 ou
100 registros. Trocar página ou filtros limpa a seleção. A exclusão individual
também abre a confirmação na própria tela, sem recarregar a lista.

O popup confere apenas os registros selecionados. Após informar o motivo e
confirmar, o lote é processado em uma única transação: se um registro mudou,
nenhum novo item do lote é excluído e a prévia deve ser atualizada. A lixeira
permite restaurar. A exclusão retira os títulos das listas e dos totais atuais,
mas preserva a origem, os vínculos e a auditoria; não cancela boletos no banco,
não estorna pagamentos e não modifica fechamentos concluídos.

As listas financeiras agora consultam somente seu domínio e as dependências
necessárias. A comparação de correspondências usa um índice por regras,
preservando candidatos, decisões e valores. Não há cache financeiro entre
usuários ou requisições. Testes sintéticos de 7.202 fontes obtiveram 27 consultas
na leitura completa, 15 na lista a receber e 11 na lista a pagar; os tempos
dependem do servidor e não representam garantia de desempenho em produção.

Não há alteração de schema nesta atualização. Não execute seed, reimportação
nem recaptura para instalá-la:

```bash
set -e
cd /srv/stack/acamargo
git pull --ff-only origin main
docker compose build brisa
docker compose up -d --no-deps brisa
docker compose ps
docker compose logs --tail 80 brisa
curl --retry 12 --retry-delay 5 --retry-all-errors -fsSI https://brisa.tescod.com/login
```

Após atualizar, recarregue a página. Confira um pequeno lote conhecido antes
de selecionar 100 itens. O código não exclui lançamentos automaticamente.

### Troca de empreendimento de imóveis com contratos (22/10/2026)

Em **Cadastros → Imóveis e unidades → Editar**, agora é possível escolher
outro empreendimento mesmo quando o imóvel já possui contratos. Não é
necessário criar outro cadastro nem registrar um histórico de transferência.
A operação mantém os mesmos IDs e, em uma única transação, atualiza o
empreendimento do imóvel e de todos os recebimentos vinculados aos seus
contratos, inclusive anteriores. Valores, taxas, pagamentos e boletos não
são alterados. A identificação precisa continuar única no destino.

O acesso por carteira passa a seguir o empreendimento escolhido; permissões
específicas por imóvel continuam válidas. Fechamentos concluídos permanecem
como estavam. Correspondências manuais da unificação podem pedir nova
conferência quando a mudança altera os dados usados na conciliação.

Esta atualização não move nenhum imóvel automaticamente, não modifica o
schema e não exige seed ou reimportação. Para publicar:

```bash
cd /srv/stack/acamargo
set -e
git pull --ff-only origin main
docker compose build brisa
docker compose up -d brisa
docker compose ps
curl --fail --retry 12 --retry-delay 5 --retry-all-errors -I https://brisa.tescod.com/login
```

Se o Git apontar divergência ou alterações locais, pare e revise antes de
continuar; não force a atualização. Não substitua o banco do servidor pelo
banco local.

### Menu Integrações e preparação Sicoob (21/10/2026)

O novo menu **Integrações** (`/integracoes`) reúne conexões externas em uma
área administrativa própria. **Integrações → Sicoob** (`/integracoes/sicoob`)
concentra instalação das credenciais, diagnóstico de autenticação, convênio,
regras dos novos boletos e preparação dos retornos. **Financeiro → Contas
bancárias** continua sendo o cadastro simples das contas; a operação de
boletos e a conferência dos pagamentos permanecem no Financeiro.

Esta entrega não requer migração de schema nova, seed, recaptura ou
reimportação. Não copie o banco local sobre o banco da produção. Atualize o
código e a imagem sem redefinir os dados:

```bash
cd /srv/stack/acamargo
set -e
git pull --ff-only origin main
docker compose build brisa
docker compose up -d brisa
docker compose ps
curl --fail --retry 12 --retry-delay 5 --retry-all-errors -I https://brisa.tescod.com/login
```

Se o Git informar alterações locais ou divergência, pare e revise: não use
`reset --hard` nem force o pull. Os passos de seed e migrações históricas
documentados abaixo não fazem parte desta atualização.

#### Instalação privada antes de ativar

O responsável informou que já possui o certificado e o Client ID, mas ainda
precisa instalá-los no Brisa. A presença do layout Widesys no cadastro não
substitui essa instalação, nem comprova conexão homologada.

1. No servidor, prepare `/srv/stack/acamargo/auth/sicoob` com permissão `700`.
   Envie o PFX original por SFTP/SSH para `auth/sicoob/client.pfx`, com
   permissão `600`. O Compose monta essa pasta somente para leitura em
   `/run/secrets/sicoob`.
2. Edite o `.env` existente no próprio servidor, mantendo permissão `600`.
   Preserve `AUTH_SECRET` e as demais chaves existentes; não sobrescreva o
   arquivo nem duplique variáveis. Use `.env.sicoob.example` apenas como
   referência de nomes, nunca como fonte de credenciais reais.
3. Configure `SICOOB_CLIENT_ID`, `SICOOB_PFX_PATH` e
   `SICOOB_PFX_PASSPHRASE` privadamente. Em produção, deixe
   `SICOOB_ACCESS_TOKEN` vazio; ao usar PFX, deixe vazias as alternativas PEM
   (`SICOOB_CERT_PATH`, `SICOOB_KEY_PATH`, `SICOOB_CERT_PASSPHRASE`).
   Use Client Secret somente se a aplicação autorizada pelo banco exigir.
   Valores com `$` ou `#` exigem cuidado com as aspas do arquivo; se houver
   aspas dentro da senha, solicite apoio técnico para preservar o valor exato.
4. Recrie o serviço após editar o ambiente:
   `docker compose up -d --force-recreate brisa`. Não basta atualizar a
   página para que um container antigo receba novas variáveis.
5. Entre como administrador em **Integrações → Sicoob**, confira a instalação
   e use **Testar autenticação sem emitir boleto**, com a confirmação explícita
   do ambiente. O resultado não habilita a conta automaticamente.

Nunca envie PFX, senha, Client ID, token, conteúdo do `.env` ou logs de
autenticação ao Git, chat ou ticket. Não publique a saída de
`docker compose config`, pois ela pode expandir segredos.

#### O que o teste confirma — e o que ainda falta

Abrir a tela não faz chamadas bancárias. O diagnóstico autorizado verifica a
configuração local e, no modo OAuth, solicita somente um token ao Sicoob. Não
consulta cobranças, não emite/cancela boleto, não baixa pagamentos e não
altera o convênio. O resultado vale para o instante do teste; repita-o após
alterar as credenciais. Autenticação bem-sucedida não homologa a emissão.

Confira com a cooperativa o cliente Sisbr, a conta API, a espécie e a
**modalidade do convênio**. A modalidade estava vazia na referência Widesys:
**carteira 1 não comprova modalidade 1**. Não transforme um campo no outro
por suposição. Este release mantém um único perfil de credenciais; somente
a conta autorizada pelo banco pode ser integrada nesse perfil.

Os destinos de autenticação e API passam por uma lista explícita de
endereços oficiais permitidos:

| Uso | Endereço permitido |
| --- | --- |
| API de produção | `https://api.sicoob.com.br/cobranca-bancaria/v3` |
| API sandbox | `https://sandbox.sicoob.com.br/sicoob/sandbox/cobranca-bancaria/v3` |
| OAuth | `https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token` |

Não configure proxy, host alternativo ou URL fornecida por terceiros nesses
campos: a aplicação recusa destinos fora dessa lista para não encaminhar
certificado ou token a outro serviço.

O retorno financeiro continua sendo o arquivo **tipo 5 / LIQUI**; o webhook
**tipo 7** é apenas um aviso opcional. Esta atualização **não instala cron,
não cadastra webhook e não comprova que já estejam funcionando**. Após
validar acesso e convênio, confira primeiro o retorno manual no Financeiro;
o responsável pela infraestrutura deve instalar e acompanhar o agendamento
protegido descrito na seção Sicoob abaixo. Ter `SICOOB_SYNC_SECRET` preenchido
não prova a execução do agendador.

Não substitua o callback do Widesys sem planejar a virada de operação e
preservar o acompanhamento dos boletos antigos. Registrar um webhook é uma
alteração no banco, separada do teste OAuth, e exige os escopos próprios.

### Financeiro simplificado (10/10/2026)

O menu destaca seis tarefas diárias: Resumo financeiro, Conferir dados,
Contas a receber, Contas a pagar, Entradas e saídas e Cobranças.
Banco e serviços e Importações e histórico ficam em grupos recolhíveis.
Comissões continuam separadas, com as mesmas permissões.

**Conferir dados** é o ponto de partida para duplicatas possíveis, decisões a
revisar e inconsistências. As listas financeiras mostram filtros essenciais
primeiro; filtros extras e ferramentas ficam recolhidos. Contas a pagar e a
receber mantêm a conferência em janela na própria lista. Dados de origem,
histórico, critérios de consolidação e cálculos não foram alterados.
A abertura pela tabela usa um GET da própria lista, preservando os filtros
na URL e evitando a transição que apresentou travamento em listas extensas.
O documento é recarregado nessa abertura; a posição anterior de rolagem não
é preservada. Comparações e fechamento continuam dentro do fluxo contextual.

```bash
cd /srv/stack/acamargo
set -e
git pull --ff-only origin main
docker compose build brisa
docker compose up -d brisa
docker compose logs --tail 60 brisa
curl --fail --retry 12 --retry-delay 5 --retry-all-errors -I https://brisa.tescod.com/login
```

Sem alteração de schema. Não execute seed nem refaça importações.

### Conferência financeira na própria tela (08/10/2026)

Contas a pagar e contas a receber abrem detalhes, comparação e exclusão em uma
janela na própria lista. Filtros, paginação e posição são mantidos; as decisões
continuam exigindo as mesmas permissões, justificativas e verificações de
concorrência. Fechar um formulário não salvo pede confirmação. A exclusão é
lógica, restaurável e não cancela operações externas.

As tabelas ajustam texto e espaçamento ao espaço disponível. Nas listas
financeiras menores, devido, pago e aberto ficam juntos na coluna **Valores**,
com rótulos individuais. Tabelas mais largas mantêm rolagem interna acessível.
Esta atualização não altera schema, não importa dados e não executa exclusões.

```bash
cd /srv/stack/acamargo
set -e
git pull --ff-only origin main
docker compose build brisa
docker compose up -d brisa
docker compose logs --tail 60 brisa
curl --fail --retry 12 --retry-delay 5 --retry-all-errors -I https://brisa.tescod.com/login
```

Não execute seed nem refaça as importações para aplicar esta atualização.

### Exclusão administrativa da plataforma (07/10/2026)

As listas de cadastros, contratos, títulos, movimentos, cobrança, boletos,
contas, NFS-e e temporada oferecem **Excluir da plataforma** ao administrador.
A confirmação exige motivo e ciência do efeito local. É possível retirar
registros pagos, conciliados, inconsistentes ou de meses fechados. A decisão é
uma exclusão lógica em `RecursoGovernado`, com trilha de auditoria e restauração
em **Organizar dados → Ver lixeira**. Nenhum schema ou seed novo é necessário.

A exclusão não apaga fatos originais, não estorna pagamentos, não cancela boletos
no Sicoob nem notas fiscais no município/provedor. Não libera a chave de
idempotência para emitir novamente. Excluir um cadastro/contrato não exclui suas
cobranças em cascata. Baixas são detalhes de pagamento: a ação nessas linhas
identifica explicitamente o **título vinculado**, não um estorno isolado.

As consultas operacionais respeitam exclusões atuais também em mês fechado;
o snapshot do fechamento permanece intacto e pode divergir da visão corrente.
Novas execuções/emissões de recursos excluídos são impedidas. Retornos bancários
continuam preservados para auditoria; uma liquidação nova de boleto/título
excluído fica para revisão, sem recriar o lançamento ou aplicar nova baixa.
Reimportar/atualizar a mesma identidade não remove sua exclusão.

Históricos de importação, eventos bancários/fiscais e auditoria não são uma
segunda operação financeira e continuam preservados. A lixeira não tem ação
de apagar definitivamente. Nenhuma exclusão é executada na atualização do app.

### Organizar dados e diagnosticar Widesys (07/10/2026)

`Financeiro → Organizar dados` separa origem (Excel/Widesys/Brisa sem prova de
arquivo) de situação (incluído, pendente, inconsistente ou cópia vinculada).
Não classifica registros antigos como manuais por suposição. As contagens são
do banco no qual a aplicação está rodando: não são uma consulta ao legado ao vivo.
Os indicadores do Executivo/locações/livro original preservam a apuração nativa,
identificada nas telas, e não devem ser somados à visão unificada.

Importações parciais e análises automáticas não significam conciliação financeira
concluída. Linhas Excel pendentes não participam do caixa; sua aprovação individual
ainda não está implementada. Exclusões de registros operacionais continuam com
histórico e motivo; a exclusão administrativa acima permite revisar também pagos
e meses fechados. Nenhuma carga ou exclusão
é executada ao abrir a central.

Após atualizar o código e reconstruir o container, pode testar a conexão do próprio
servidor sem importar, emitir cobranças ou gravar dados pessoais. Não coloque a
senha diretamente no comando/histórico:

```bash
read -r -p "Usuário Widesys: " WIDESYS_USUARIO
read -r -s -p "Senha Widesys: " WIDESYS_SENHA
printf '\n'
export WIDESYS_USUARIO WIDESYS_SENHA
docker compose exec -e WIDESYS_USUARIO -e WIDESYS_SENHA brisa \
  npm run diagnosticar:widesys || true
unset WIDESYS_USUARIO WIDESYS_SENHA
```

O JSON separa API, login e cada tela financeira. `OK` confirma somente aquela
consulta no instante do teste. Totais das telas refletem os filtros padrão do
legado, não totais globais. O script limita amostras, tempo e tamanho das respostas,
não imprime senha, cookies ou documentos e não grava banco/arquivos.
O aplicativo não agenda sincronização Widesys contínua: a conexão disponível
não é prova de dados atualizados. Captura e importação continuam sendo etapas
separadas, com deduplicação e conferência antes de uso operacional.

### Atualização 2026-10-07: usuários, carteiras e governança

Esta versão adiciona **Configurações → Usuários e permissões**, a consulta
**Minha carteira** e **Cadastros → Revisar e corrigir cadastros**. O administrador
mantém acesso integral, inclusive às comissões. Demais usuários começam sem
abrangência liberada; revise função, permissões e carteira após atualizar.
Sócios, contabilidade e consulta usam exclusivamente a carteira de leitura,
mesmo quando a abrangência inclui todos os cadastros. Financeiro/operador com
carteira limitada também consultam por essa área; ações operacionais existentes
exigem carteira global e capacidade explícita. As telas globais antigas não
implementam edição financeira por carteira limitada.

O boot executa `scripts/migrar-rbac.mjs --aplicar` antes de sincronizar o schema.
A atualização versionada é `prisma/updates/20261007_rbac_governanca.sql`.
Ela cria backup consistente em `dados/backups-rbac`, verifica os dados de todas
as tabelas anteriores e desfaz a transação se houver divergência. Não use
`prisma migrate deploy` nesta instalação histórica baseada em `db push`.

```bash
cd /srv/stack/acamargo
set -e
git pull --ff-only origin main
docker compose build brisa
docker compose stop brisa
docker compose run --rm --no-deps brisa npm run db:migrar-rbac -- --aplicar
# Só prossiga se a migração terminar sem erro.
docker compose up -d brisa
docker compose logs --tail 80 brisa
curl -I https://brisa.tescod.com/login
```

Não execute seed nem `--accept-data-loss`. Se a migração falhar, preserve o
backup e os logs e mantenha a aplicação parada para revisão. O rollback da
transação preserva o banco anterior; não tente desfazer o schema manualmente.
Mudanças de função, carteira, status e senha revogam sessões; os usuários
afetados deverão entrar novamente. Bloqueios explícitos prevalecem. Mesclagens
com regras de acesso envolvidas exigem revisão antes de executar.

Referências funcionais: [Widesys — portais por relacionamento](https://www.widesys.com.br/software-para-imobiliaria),
[Superlógica — permissões financeiras granulares](https://imobiliarias.superlogica.com/hc/pt-br/articles/41496210645015-Mais-seguran%C3%A7a-e-controle-chegaram-as-novas-permiss%C3%B5es-granulares-no-sistema),
[OWASP — autorização por recurso e negação por padrão](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).
São referências de desenho, não cópia de uma matriz interna do Widesys.

### Atualizações posteriores

```bash
cd /srv/stack/acamargo
git pull --ff-only origin main
docker compose up -d --build
```

O banco persiste no volume `dados/brisa.db`. Alterações de schema exigem
backup e revisão; não autorize perda de dados para contornar um erro de deploy.

### Integração Sicoob (configuração inicial)

O cadastro idempotente cria as cinco contas do Bancoob/Sicoob (banco 756,
agência 3299) sem habilitar a API:

| Conta | Apelido | Finalidade inicial |
| --- | --- | --- |
| 1180-0 | Sicoob Brisa Azul | operacional e padrão, se ainda não existir outra padrão |
| 11801 | Aplicação | aplicação |
| 126764 | AC | outra |
| 466395 | Sicoob IPTU | IPTU |
| 67407 | Paolla | outra |

As credenciais da API formam **um único perfil global** neste release. Por
segurança, o sistema impede que mais de uma conta tenha a integração ativa ao
mesmo tempo. Em **Integrações → Sicoob** (`/integracoes/sicoob`), habilite somente a conta
explicitamente autorizada no aplicativo Sicoob e confirme com o banco o número
de cliente Sisbr, a conta do convênio, a modalidade, o contrato (quando houver)
e a espécie documental. As outras quatro contas permanecem cadastradas para a
operação financeira, mas sem emissão nesse perfil.

#### Autenticação por ambiente

- **Sandbox com token estático:** informe `SICOOB_CLIENT_ID` e o
  `SICOOB_ACCESS_TOKEN` temporário fornecido pelo portal. Esse modo não exige
  certificado mTLS; deixe `SICOOB_PFX_PATH` vazio.
- **Sandbox com OAuth:** sem token estático, configure a URL de token e o
  certificado mTLS, da mesma forma que o cliente OAuth exigir.
- **Produção:** use `client_credentials` com a URL oficial de token e
  certificado A1/mTLS. Deixe `SICOOB_ACCESS_TOKEN` vazio. O `client_id` é
  informado por `SICOOB_CLIENT_ID`; não o grave no código ou no banco. O PFX e
  sua senha nunca devem entrar no Git, na imagem Docker nem no SQLite.

O layout Widesys continha somente os três escopos de boletos, que também são o
padrão seguro do Brisa: `boletos_inclusao`, `boletos_consulta` e
`boletos_alteracao`. Mantenha `SICOOB_SCOPES` exatamente assim para evitar
`invalid_scope` enquanto a aplicação do Portal Sicoob não tiver permissões
adicionais.

O webhook tipo 7 é opcional. Para habilitá-lo, solicite ao banco e confirme no
Portal Sicoob os três escopos `webhooks_inclusao`, `webhooks_consulta` e
`webhooks_alteracao`; só então acrescente **os três juntos** a
`SICOOB_SCOPES`. O Brisa não mostra nem executa o cadastro do webhook com um
conjunto parcial. Sem webhook, a sincronização do arquivo tipo 5 / LIQUI
continua sendo o caminho oficial de confirmação de pagamento.

Crie no servidor o diretório restrito que será montado como somente leitura no
container:

```bash
cd /srv/stack/acamargo
install -d -m 700 auth auth/sicoob
```

Na estação que contém o certificado, copie-o diretamente para esse diretório
(ajuste apenas o caminho local). O PFX fica fora do repositório e não entra no
contexto da imagem:

```powershell
scp "C:\caminho-seguro\client.pfx" root@76.13.161.105:/srv/stack/acamargo/auth/sicoob/client.pfx
```

De volta ao servidor, restrinja a leitura e confirme apenas existência e
permissões — não imprima nem converta o conteúdo do certificado em logs:

```bash
cd /srv/stack/acamargo
chmod 600 auth/sicoob/client.pfx
test -r auth/sicoob/client.pfx
```

Edite **no próprio servidor** o `.env` com permissão `600` e acrescente as
chaves documentadas em `.env.sicoob.example`. Digite a senha do certificado
somente em `SICOOB_PFX_PASSPHRASE` nesse arquivo; não a passe na linha de
comando, não a envie por chat e não a copie para nenhum arquivo versionado.
O carregador acusa separadamente PFX ausente/ilegível e senha não preenchida,
sem incluir o caminho ou a senha no diagnóstico. `SICOOB_SYNC_SECRET` aceita
somente Base64URL/hex forte com **43 a 128 caracteres**. O mesmo vale para
`SICOOB_WEBHOOK_SECRET`, mas ele só é necessário quando o webhook opcional for
habilitado. Gere um valor para a sincronização e, nesse caso, um segundo valor
diferente para o webhook (a saída hexadecimal tem 64 caracteres válidos):

```bash
openssl rand -hex 32
```

Exemplo mínimo de produção:

```dotenv
APP_PUBLIC_URL=https://brisa.tescod.com
SICOOB_AMBIENTE=producao
SICOOB_TOKEN_URL=https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token
SICOOB_CLIENT_ID=IDENTIFICADOR_DO_APLICATIVO
SICOOB_ACCESS_TOKEN=
SICOOB_SCOPES="boletos_inclusao boletos_consulta boletos_alteracao"
SICOOB_PFX_PATH=/run/secrets/sicoob/client.pfx
SICOOB_PFX_PASSPHRASE=
SICOOB_WEBHOOK_SECRET=
SICOOB_SYNC_SECRET=OUTRO_SEGREDO_DE_64_CARACTERES_HEX
SICOOB_WEBHOOK_EMAIL=
```

Antes de reconstruir o container, preencha no `.env` do servidor o
`SICOOB_CLIENT_ID` liberado pelo banco e o campo
`SICOOB_PFX_PASSPHRASE`, que está vazio no exemplo. O bloco acima omite a senha
de propósito para que ela nunca seja copiada da documentação.

Depois, reconstrua o container e confira as contas em **Integrações → Sicoob**.
Cadastre o webhook nessa tela somente se os três escopos opcionais tiverem sido autorizados e
incluídos explicitamente em `SICOOB_SCOPES`:

```bash
docker compose up -d --build
docker compose exec brisa npm run db:contas-sicoob
docker compose ps
docker compose logs --tail 100 brisa
```

#### Confirmação de pagamento e cron

O webhook de movimento **tipo 7** é somente um aviso operacional de intenção
de pagamento (ou cancelamento). Ele é gravado de forma idempotente, mas
**nunca dá baixa no recebimento**. A confirmação financeira vem do arquivo de
movimentações **tipo 5 / LIQUI**, no qual o app valida conta, convênio, título,
data e valor antes de conciliar.

A mesma rota protegida de sincronização consulta a carteira e executa o fluxo
assíncrono do LIQUI (solicitar, consultar disponibilidade e baixar/processar).
Depois de validar a conexão e o convênio, o responsável pelo servidor pode
agendá-la a cada 15 minutos; podem ser necessárias execuções sucessivas até o
arquivo solicitado ficar disponível:

```bash
crontab -e
# O segredo já está no ambiente do container; não carregue o .env no shell do host.
*/15 * * * * cd /srv/stack/acamargo && docker compose exec -T brisa node -e 'fetch("http://127.0.0.1:3000/api/integracoes/sicoob/sincronizar",{method:"POST",headers:{authorization:"Bearer "+process.env.SICOOB_SYNC_SECRET},signal:AbortSignal.timeout(55000)}).then(r=>{if(!r.ok)throw new Error("HTTP "+r.status)}).catch(e=>{console.error(e.message);process.exit(1)})'
```

`SICOOB_WEBHOOK_SECRET` faz parte do caminho da URL de callback. Configure o
Traefik e qualquer coletor/APM para **não registrar nem exportar a URL completa
dessa rota**, restrinja acesso e retenção dos access logs e nunca cole a URL em
ticket, chat ou captura de tela. Se ela aparecer em um log, rotacione o segredo
e recadastre o webhook.

#### Atualização segura no servidor atual

Antes de atualizar, pare brevemente o app para obter uma cópia consistente do
SQLite. O comando abaixo preserva a base atual, atualiza somente por fast-forward
e deixa o bootstrap aplicar o schema e o cadastro idempotente das contas:

```bash
set -e
cd /srv/stack/acamargo
mkdir -p /root/backups
docker compose stop brisa
if [ -f dados/brisa.db ]; then
  cp --archive dados/brisa.db "/root/backups/brisa-pre-sicoob-$(date +%F-%H%M%S).db"
fi
git pull --ff-only origin main
docker compose up -d --build
docker compose exec brisa npm run db:contas-sicoob
docker compose ps
docker compose logs --tail 100 brisa
```

## 5) Backup

Todo o estado é um arquivo: `/srv/stack/acamargo/dados/brisa.db`.

```bash
# exemplo: cópia diária às 3h (crontab -e)
0 3 * * * cp /srv/stack/acamargo/dados/brisa.db /root/backups/brisa-$(date +\%F).db
```

## 6) Importar cadastros do Widesys

As capturas são somente de leitura no legado. Os arquivos resultantes ficam em
`data/legacy-widesys/`, fora do Git, e os importadores validam manifestos,
contagens e hashes antes de abrir a transação. O volume `./data:/app/data` do
Compose torna esse mesmo diretório visível no container.

Na captura de catálogos, a paginação varia conforme o componente do Joomla:
`com_widesys` usa `limit=200`; `com_categories` usa `list[limit]=200`. Não altere
esses parâmetros manualmente nem reutilize a URL de um componente no outro.

Escolha **uma** das opções abaixo: capturar no próprio servidor ou transferir
um lote completo já validado na estação local. Nunca use Git, ticket, chat ou
armazenamento público para transportar esses artefatos.

### Opção A — capturar no próprio servidor

Esta opção evita copiar dados pessoais entre máquinas.

Use variáveis temporárias e silencie a senha no terminal. Não acrescente essas
credenciais ao `.env`, ao histórico do shell ou ao `docker-compose.yml`:

```bash
cd /srv/stack/acamargo
read -r -p "Usuário Widesys: " WIDESYS_USUARIO
read -r -s -p "Senha Widesys: " WIDESYS_SENHA; printf '\n'
export WIDESYS_USUARIO WIDESYS_SENHA

docker compose exec \
  -e WIDESYS_USUARIO \
  -e WIDESYS_SENHA \
  brisa npm run legacy:capture-api

docker compose exec \
  -e WIDESYS_USUARIO \
  -e WIDESYS_SENHA \
  brisa npm run legacy:scrape -- --refresh

docker compose exec \
  -e WIDESYS_USUARIO \
  -e WIDESYS_SENHA \
  brisa npm run legacy:capture-catalogos -- --refresh \
    --irrf-from-year=2025 --irrf-to-year=2026

# Captura operacional para reconciliação; ainda não altera o SQLite.
docker compose exec \
  -e WIDESYS_USUARIO \
  -e WIDESYS_SENHA \
  brisa npm run legacy:capture-operation -- --refresh \
    --from=2025-01 --to=2026-09 --titles-to=2100-12-31

unset WIDESYS_SENHA WIDESYS_USUARIO
```

### Opção B — transferir a captura local por SSH

Antes do envio, execute localmente os três `dry-run` e só prossiga se os
manifestos estiverem completos, sem erro de contagem/ID duplicado e com as
quarentenas revisadas. No PowerShell, empacote apenas o diretório ignorado pelo
Git, envie-o por SSH e apague a cópia temporária local:

```powershell
$arquivo = Join-Path $env:TEMP "legacy-widesys-transfer.tar.gz"
tar -czf $arquivo -C "C:\Users\pablorezendes\Documents\ACAMARGO\sistema\data" legacy-widesys
scp $arquivo root@76.13.161.105:/root/legacy-widesys-transfer.tar.gz
Remove-Item -LiteralPath $arquivo
```

No servidor, extraia para um diretório temporário com permissão restrita,
confira os três manifestos e só então troque o lote ativo. O lote anterior é
preservado com data/hora para permitir retorno:

```bash
set -e
cd /srv/stack/acamargo
umask 077
chmod 600 /root/legacy-widesys-transfer.tar.gz
incoming="$(mktemp -d /srv/stack/acamargo/data/.legacy-widesys-incoming.XXXXXX)"
tar -xzf /root/legacy-widesys-transfer.tar.gz -C "$incoming"
test -f "$incoming/legacy-widesys/manifest.json"
test -f "$incoming/legacy-widesys/catalogos/manifest.json"
test -f "$incoming/legacy-widesys/operacao/manifest.json"

stamp="$(date +%F-%H%M%S)"
mkdir -p /root/backups
if [ -e data/legacy-widesys ]; then
  mv data/legacy-widesys "/root/backups/legacy-widesys-pre-$stamp"
fi
mv "$incoming/legacy-widesys" data/legacy-widesys
rmdir "$incoming"
chmod -R go-rwx data/legacy-widesys
rm -f /root/legacy-widesys-transfer.tar.gz
```

Não mantenha indefinidamente a cópia `/root/backups/legacy-widesys-pre-*`:
depois que a reconciliação e a aplicação terminarem com sucesso, aplique a
política de retenção do cofre. A captura anterior nunca deve ser movida para
outro nome dentro do repositório, pois contém dados pessoais e financeiros.

### Validação e importação comuns às duas opções

Faça backup consistente de `dados/brisa.db` antes da primeira aplicação. Em
seguida rode cada `dry-run`, revise contagens, somas e quarentenas, e só então
execute o importador correspondente:

```bash
docker compose exec brisa npm run importar:cadastros-widesys:dry-run
docker compose exec brisa npm run importar:cadastros-widesys
docker compose exec brisa npm run importar:catalogos-widesys:dry-run
# aplique somente depois de conferir o manifesto e as quarentenas
docker compose exec brisa npm run importar:catalogos-widesys
docker compose exec brisa npm run importar:operacao-widesys:dry-run
# aplique somente depois de reconciliar contagens, somas e itens em quarentena
docker compose exec brisa npm run importar:operacao-widesys
```

O `dry-run` deve ser analisado antes da aplicação. Além das criações,
atualizações e quarentenas, ele consulta o staging em modo somente leitura e
antecipa quantos itens receberiam o estado `AUSENTE_NA_FONTE`. A aplicação é
idempotente e nunca apaga esses registros; uma captura completa apenas os marca
para conferência humana. Baixas só podem receber essa marca quando todo o escopo
de títulos comprova que a enumeração das liquidações foi completa. Não use
`npm run db:seed` neste fluxo: ele serve somente à primeira carga e agora recusa
bases com dados operacionais, bancários ou importados. Não há exclusão ou reset.
O modo `--refresh` refaz todas as telas e evita misturar a API atual com detalhes
de uma execução anterior. Reserve `--resume` exclusivamente para continuar a
mesma captura interrompida.

Antes de qualquer futura importação de contratos ou financeiro, confira
`data/legacy-widesys/operacao/manifest.json`: `complete` precisa ser `true`, os
arquivos de escopo precisam bater com seus hashes e não pode haver erro de
contagem/ID duplicado. A janela futura de títulos usa `2100-12-31` apenas como
sentinela de consulta; reduza com `--titles-to=AAAA-MM-DD` somente se houver um
horizonte operacional formalmente definido. Não copie esses artefatos para o
Git, tickets ou chats, pois contêm dados pessoais e financeiros.

Os três importadores escrevem somente nas tabelas de staging, quarentena e
auditoria de suas respectivas áreas. Em especial, o importador operacional não
cria contratos, recebimentos ou lançamentos de caixa atuais. O lote é
idempotente por origem + `captureId`; cada registro também é idempotente por
origem + escopo + ID legado. Um lote com quarentenas é terminal e pode ser
reprocessado somente por uma nova captura, preservando a trilha anterior.
Depois da aplicação, confira `/financeiro/migracao-widesys`: a página distingue
os totais operacionais do Brisa dos totais do Widesys e não expõe snapshots,
URLs de origem, documentos pessoais ou dados bancários.

### Atualização completa com backup e migração dos cadastros

Para aplicar esta versão no servidor atual, pare brevemente a aplicação para
obter uma cópia consistente do SQLite. O bootstrap do container aplica o novo
schema antes da captura e da importação:

```bash
set -e
cd /srv/stack/acamargo
mkdir -p /root/backups
docker compose stop brisa
if [ -f dados/brisa.db ]; then
  cp --archive dados/brisa.db "/root/backups/brisa-pre-cadastros-$(date +%F-%H%M%S).db"
fi
git pull --ff-only origin main
docker compose up -d --build

read -r -p "Usuário Widesys: " WIDESYS_USUARIO
read -r -s -p "Senha Widesys: " WIDESYS_SENHA; printf '\n'
export WIDESYS_USUARIO WIDESYS_SENHA
docker compose exec -e WIDESYS_USUARIO -e WIDESYS_SENHA brisa npm run legacy:capture-api
docker compose exec -e WIDESYS_USUARIO -e WIDESYS_SENHA brisa npm run legacy:scrape -- --refresh
docker compose exec -e WIDESYS_USUARIO -e WIDESYS_SENHA brisa npm run legacy:capture-catalogos -- --refresh --irrf-from-year=2025 --irrf-to-year=2026
docker compose exec -e WIDESYS_USUARIO -e WIDESYS_SENHA brisa npm run legacy:capture-operation -- --refresh --from=2025-01 --to=2026-09 --titles-to=2100-12-31
unset WIDESYS_SENHA WIDESYS_USUARIO

docker compose exec brisa npm run importar:cadastros-widesys:dry-run
docker compose exec brisa npm run importar:cadastros-widesys
docker compose exec brisa npm run importar:catalogos-widesys:dry-run
# depois da conferência do relatório de catálogos:
docker compose exec brisa npm run importar:catalogos-widesys
docker compose exec brisa npm run importar:operacao-widesys:dry-run
# depois da conferência do relatório:
docker compose exec brisa npm run importar:operacao-widesys
docker compose ps
docker compose logs --tail 100 brisa
curl -fsSI https://brisa.tescod.com/login | head -n 1
```

## Unificação dos dados já importados (sem recapturar nem duplicar)

Esta atualização acrescenta decisões e consultas operacionais comuns ao Brisa,
às planilhas e ao Widesys. Não requer repetir o scraping, não reexecuta o seed,
não apaga as fontes e não emite boletos. Aplique sobre o banco existente no
servidor — o banco local e arquivos com dados pessoais não são enviados ao Git.

```bash
set -e
cd /srv/stack/acamargo
git pull --ff-only origin main
# Construa antes de parar a aplicação para reduzir a indisponibilidade.
docker compose build brisa
mkdir -p /root/backups
docker compose stop brisa
# Copia também WAL/SHM, caso existam, com a aplicação parada.
cp -a dados "/root/backups/brisa-pre-unificacao-$(date +%F-%H%M%S)"
docker compose run --rm --no-deps brisa npx prisma db push --skip-generate
docker compose run --rm --no-deps brisa npm run unificar:operacao:dry-run
docker compose run --rm --no-deps brisa npm run unificar:operacao
# Deve informar criados: 0 e atualizados: 0 se nada mudou desde a execução.
docker compose run --rm --no-deps brisa npm run unificar:operacao:dry-run
docker compose up -d brisa
docker compose ps
curl --retry 12 --retry-delay 5 --retry-all-errors -fsSI https://brisa.tescod.com/login | head -n 1
```

O bootstrap aplica as duas tabelas novas (`UnificacaoRegistro` e
`UnificacaoDecisao`) e o campo de exclusões congeladas no fechamento mensal.
A análise registra as decisões, mas não soma títulos,
baixas e movimentos entre si. Os totais consolidados deixam correspondências
pendentes e inconsistências de fora; os montantes pendentes permanecem visíveis.
As contagens refletem a captura do servidor, que pode diferir da base local.

Após o comando, confira `/financeiro`, `/recebimentos`,
`/financeiro/contas-a-pagar`, `/caixa`, `/contratos` e `/cadastros/pessoas`.
Em `/unificacao`, compare cada pendência: **Vincular** quando for a mesma
ocorrência; **Confirmar registro distinto** quando houver evidência de que são
fatos diferentes. Justificativa e versões são auditadas; decisões podem ser
reabertas. Nomes e valores parecidos nunca confirmam identidade sozinhos.

As visões de comissão, temporada e fechamento continuam usando a composição
verificada das locações/planilhas. Títulos Widesys sem separação de aluguel,
IPTU, condomínio e taxa não recebem comissão presumida. Movimentos e baixas
históricas não disparam pagamento, reemissão ou contato com o banco.

## Despesas administrativas e documento opcional (26/10/2026)

Em **Financeiro → Contas a pagar → Nova despesa**, escolha categoria,
favorecido, descrição, valor e competência. O responsável pelo custo pode ser
a administradora, um empreendimento ou vários empreendimentos com rateio manual.
Documento fiscal/guia/recibo/boleto e comprovantes ficam em seções opcionais.

As categorias administrativas vêm do catálogo operacional. Os IDs comprovados
do Widesys sugerem a classificação ao organizar um título já importado; não
criam outro título. O grupo legado “Administração BRISA” não é tratado como
comissão. A categoria Administração/comissão continua exclusiva do administrador.
A classificação salva no Brisa aparece junto do plano original nas listas e
detalhes, sem modificar a fonte financeira nem suas decisões de reconciliação.

O pagamento pode ficar em aberto, ser vinculado a uma saída existente ou ser
registrado uma única vez quando já ocorreu e ainda está ausente do caixa.
Informar um pagamento aqui não envia PIX nem executa transação bancária.
Despesas da administradora não entram nos custos dos empreendimentos.

O schema acrescenta quatro campos em `DespesaDocumento`, com valores padrão
compatíveis com os documentos existentes. O bootstrap sincroniza o schema.
Não é necessário executar seed nem reimportar dados.

```bash
set -e
cd /srv/stack/acamargo
git pull --ff-only origin main
docker compose build brisa
docker compose stop brisa
umask 077
backup="/srv/backups/brisa-despesas-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
cp -a dados "$backup/"
docker compose up -d --no-deps brisa
docker compose logs --tail 100 brisa
curl --retry 12 --retry-delay 5 --retry-all-errors -fsSI https://brisa.tescod.com/login
```

## Cloudflare — a nuvem laranja e o certificado

O registro `brisa.tescod.com` está no Cloudflare **com proxy** (nuvem
laranja). Isso muda quem termina o TLS, e há duas armadilhas conhecidas:

1. **A emissão do certificado pode falhar.** O desafio padrão do Traefik é o
   TLS-ALPN-01, que acontece na porta 443 — mas com a nuvem laranja quem
   atende o 443 é o Cloudflare, não o Traefik, e o desafio nunca chega. (Com
   desafio HTTP-01 costuma passar, porque o Cloudflare encaminha
   `/.well-known/acme-challenge`.) Para saber qual o seu Traefik usa:

   ```bash
   grep -A4 "certificatesresolvers" /srv/stack/traefik/traefik.yml
   ```

2. **Laço de redirecionamento.** Se o modo SSL/TLS do domínio estiver em
   **Flexible**, o Cloudflare fala HTTP com a origem, o Traefik devolve
   redirecionamento para HTTPS, o Cloudflare segue e volta em HTTP — e o
   navegador mostra `ERR_TOO_MANY_REDIRECTS`.

**Caminho seguro (recomendado):** deixe a nuvem **cinza** (DNS only) para
subir e emitir o certificado; depois de confirmar que o HTTPS abre direto na
origem, religue a laranja com SSL/TLS em **Full (strict)**.

```bash
# a origem responde com certificado válido? (ignora o Cloudflare)
curl -sIv --resolve brisa.tescod.com:443:76.13.161.105 \
  https://brisa.tescod.com 2>&1 | grep -E "subject:|issuer:|HTTP/"
```

Com a laranja ligada, o modo SSL/TLS **precisa** ser `Full (strict)` —
Flexible causa o laço do item 2. Nada no app depende do IP do visitante, mas
lembre que com proxy os logs do Traefik passam a mostrar IPs do Cloudflare.

## Segurança — leia antes de divulgar a URL

### NFS-e e central de comunicação (setembro/2026)

O deploy acrescenta tabelas de rascunhos fiscais, configurações, autorização de
contatos, fila, retornos e auditoria. Não altera valores da operação existente.
Faça backup consistente antes do bootstrap (sem seed):

```bash
cd /srv/stack/acamargo
git pull --ff-only origin main
docker compose build brisa
docker compose stop brisa
mkdir -p backups
cp -a dados "backups/dados-pre-fiscal-$(date +%Y%m%d-%H%M%S)"
docker compose up -d brisa
docker compose logs --tail 80 brisa
curl --retry 12 --retry-delay 5 --retry-all-errors -fsSI https://brisa.tescod.com/login
```

Não rode `db:seed`, reimportação ou emissão para aplicar essa atualização.
O banco local de desenvolvimento não deve ser copiado sobre o banco do servidor.
Os módulos novos estão restritos a administradores. Envios e emissão em produção
ficam desabilitados por padrão e dependem de configuração e homologação.

Consulte [comunicação e cron](docs/comunicacoes-cobranca.md) e
[NFS-e de Goiânia](docs/fiscal-goiania.md) para configuração. As variáveis novas
constam em `docker-compose.yml`; apenas defini-las não autoriza disparos.

### Acesso e dados privados

- O repo GitHub está **público**: o histórico publicado foi sanitizado (sem
  `dev.db`/`dataset.json`), mas o ideal é torná-lo **privado**
  (Settings → General → Danger Zone → Change visibility).
- A barreira de acesso é o **login do app** (/login): senhas com scrypt,
  sessão assinada (HMAC + AUTH_SECRET) em cookie httpOnly, bloqueio no proxy
  e no layout. Guarde o AUTH_SECRET: trocá-lo derruba todas as sessões.
- O banco (`dados/brisa.db`) guarda também os usuários — o backup diário
  cobre tudo.

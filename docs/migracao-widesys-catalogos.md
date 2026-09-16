# Migração de catálogos Widesys para staging

O pipeline de catálogos possui três etapas implementadas: captura somente
leitura do Widesys, validação/reconciliação em `dry-run` e aplicação idempotente
nas tabelas de staging e auditoria do Brisa. Nenhuma dessas etapas promove
registros para as tabelas operacionais.

## Escopo fechado

- matriz e filiais, contas bancárias, layouts bancários, calendário, IRRF,
  índices de reajuste e serviços de locação;
- tipos de recebimento, plano de contas, marcações de contratos/pessoas,
  garantias e categorias de imóveis;
- tipos, fases e status de empreendimentos;
- modelos de documentos do menu administrativo;
- origens de clientes, nacionalidades, estados, cidades, bairros e países.

As rotas ficam em uma whitelist versionada em
`scripts/widesys-catalogos-core.ts`. O capturador não aceita um módulo
arbitrário. Uma referência de detalhe encontrada em `href` ou `onclick` serve
apenas como evidência: o JavaScript nunca é executado e a requisição é
reconstruída como uma URL canônica com `view`, `layout=edit` e o ID legado
esperado.

## Garantias de segurança e integridade

- a origem é fixada em `https://brisaazul.app2.widesys.com.br` e o pathname
  administrativo deve ser exatamente `/administrator/index.php`;
- credenciais são lidas somente de `WIDESYS_USUARIO` e `WIDESYS_SENHA`;
- somente o login Joomla usa POST; a captura posterior usa GET e valida todos
  os saltos de redirecionamento;
- rotas de detalhe acessadas não aceitam `task=*.edit`, nem troca do ID legado
  durante um redirecionamento;
- listagens `com_widesys` usam `limit=200`; listagens `com_categories` usam
  `list[limit]=200`. A paginação é limitada e a contagem é reconciliada de
  forma exata;
- senhas, tokens, segredos, certificados e parâmetros CSRF do Joomla são
  removidos dos campos e URLs persistidos;
- scripts e event handlers são removidos do HTML salvo;
- cada HTML/JSON recebe SHA-256 e o manifesto possui um `contentHash`
  canônico, recalculado também pelo importador;
- cada módulo selecionado precisa ter ao menos um par verificável de artefatos
  `list-html`/`list-json`; um catálogo realmente vazio continua válido, mas só
  depois dessa verificação;
- a saída `data/legacy-widesys/catalogos/` é ignorada pelo Git e não deve ser
  versionada.

## Fluxo operacional

Os comandos abaixo são os scripts reais de `package.json`.

### 1. Validar a configuração da captura

Este comando não usa credenciais, rede ou arquivos:

```powershell
npm run legacy:capture-catalogos:dry-run
```

### 2. Gerar um lote de captura

Execute somente em ambiente autorizado. Informe explicitamente o intervalo
histórico do IRRF necessário para a migração:

```powershell
$env:WIDESYS_USUARIO = "<usuario>"
$env:WIDESYS_SENHA = "<senha>"
npm run legacy:capture-catalogos -- --refresh --irrf-from-year=2024 --irrf-to-year=2026
Remove-Item Env:WIDESYS_USUARIO
Remove-Item Env:WIDESYS_SENHA
```

Sem as flags de ano, o ano civil corrente é calculado em
`America/Sao_Paulo`. O intervalo aceita no máximo 50 anos.

Para limitar o lote, passe os slugs na ordem desejada:

```powershell
npm run legacy:capture-catalogos -- --refresh --modules=contas,boletolayouts
```

### 3. Validar e reconciliar sem escrever no banco

```powershell
npm run importar:catalogos-widesys:dry-run
```

O `dry-run` valida o manifesto completo, todos os hashes e artefatos, a janela
temporal da captura e as contagens por módulo. Em seguida, exibe a reconciliação
incluindo módulos válidos com zero registros e itens destinados à quarentena.

Para revisar outro diretório de captura:

```powershell
npm run importar:catalogos-widesys:dry-run -- --diretorio C:\caminho\para\catalogos
```

### 4. Aplicar o lote no staging

Depois de revisar o `dry-run`:

```powershell
npm run importar:catalogos-widesys
```

A aplicação escreve somente nos modelos:

- `CatalogoLegadoCaptura`, para identidade, integridade e andamento do lote;
- `CatalogoLegadoItem`, para a decisão auditável de cada item;
- `CatalogoLegadoRegistro`, para o snapshot canônico mais recente em staging
  ou quarentena.

Não há escrita automática nas tabelas operacionais. A carga é idempotente por
`origem + módulo + ID legado`, compara o hash semântico do snapshot e preserva
os metadados voláteis apenas para auditoria. O UUID original da captura é
mantido; reutilizar o mesmo UUID com outro hash de manifesto é rejeitado.

## Manifesto e modos de captura

O manifesto fica em:

```text
data/legacy-widesys/catalogos/manifest.json
```

Ele registra schema e versão, origem, UUID e janela temporal da captura,
opções imutáveis, lista ordenada de módulos, anos do IRRF, estados dos módulos,
erros, artefatos e hashes. O `contentHash` cobre o conteúdo persistido do lote,
exceto o próprio `contentHash` e `updatedAt`.

- `--refresh` inicia um lote coerente com novo UUID e não tenta interpretar um
  manifesto anterior, mesmo se o arquivo existente estiver truncado;
- `--no-resume` inicia somente quando ainda não existe manifesto;
- `--resume` aceita apenas uma captura interrompida, íntegra e iniciada há no
  máximo 24 horas; uma captura concluída deve ser refeita com `--refresh`;
- no `--resume`, módulos e ordem, anos IRRF, delay, limite e `max-pages` devem
  coincidir exatamente com o manifesto;
- as listas são lidas novamente e um detalhe só é reutilizado quando ID, alvo
  canônico, evidência da linha, entrada do manifesto e hashes HTML/JSON ainda
  coincidem;
- se a lista mudou desde a interrupção, o registro é buscado novamente;
- uma captura incompleta mantém os artefatos para diagnóstico e termina com
  código de saída `2`, permitindo que pipelines com `set -e` parem antes da
  importação.

Exemplo de retomada com exatamente as mesmas opções:

```powershell
npm run legacy:capture-catalogos -- --resume --modules=irrf --irrf-from-year=2024 --irrf-to-year=2026
```

## Revisão antes da aplicação

Cada módulo possui `pages/` e `records/`, com HTML sanitizado e JSON derivado.
Antes de aplicar, revise no mínimo:

1. `completed`, `pagesFetched` e `detailErrors` de todos os módulos;
2. `reportedTotal`, `recordsDiscovered` e `recordsSaved`;
3. `contentHash` e os hashes individuais dos artefatos;
4. a janela `startedAt`/`completedAt` e os `fetchedAt` dos registros;
5. a presença de `[REDACTED]` em configurações sensíveis;
6. a ausência de certificados, credenciais, cookies e tokens;
7. a reconciliação e a quarentena emitidas pelo `dry-run`.

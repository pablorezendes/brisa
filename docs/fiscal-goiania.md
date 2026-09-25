# NFS-e de serviços · Goiânia/GO

Implementação revisada em 25/09/2026. Módulo exclusivo de **ADMINISTRADOR** em `/financeiro/notas-fiscais`, com rechecagem do perfil no banco em páginas e operações. Não emite NF-e de mercadorias e não divulga valores em páginas gerais, relatórios de cobrança ou mensagens.

## Integração escolhida e limites

Foi implementado um **adaptador opcional Focus NFe**. Não houve contratação, cadastro de conta, envio de documentos nem teste em serviços fiscais externos. Para operar, a empresa precisa contratar/autorizar esse provedor ou solicitar outro adaptador. O motor, o armazenamento e o fluxo de revisão ficam no Brisa; assinatura e transmissão municipal ficam a cargo da Focus.

A documentação atual de Goiânia no provedor orienta usar **layout nacional via `/v2/nfsen`, com autorizador municipal ISSNet**. Não confundir com o ambiente público nacional. O FAQ municipal de março/2026 que menciona ABRASF 2.04 não é base suficiente para uma integração em setembro/2026: o manual atual da NotaControl é o modelo nacional 1.01, revisado em agosto.

Escopo inicial suportado: emitente pessoa jurídica com CNPJ numérico, prestação em Goiânia, tomador brasileiro identificado, serviço tributável sem retenções/deduções, regime normal, tomador igual ao destinatário. Códigos de tributação, NBS, IBS/CBS e tributos aproximados são informados expressamente com a contabilidade, nunca presumidos. MEI, CNPJ alfanumérico, exportação, obras, retenções, regimes especiais, substituição e cancelamento por API **não estão implementados**. Essas situações exigem evolução e homologação específica; não devem ser enquadradas artificialmente no fluxo disponível.

A alíquota ISS (`pAliq`) não é arbitrada pelo Brisa. O manual municipal NotaControl, página 7, orienta sua parametrização pelo município, exceto incidência fora dele ou Simples com retenção. Esses dois casos ficam fora do escopo inicial; a regra genérica de APIs do ambiente público nacional não deve substituir a regra do autorizador municipal.

**Homologação fiscal real ainda pendente.** Testes automatizados locais usam dados fictícios e transporte simulado, não provam que o cadastro/serviço do contribuinte está liberado pelo município. A transmissão em produção exige uma nota de homologação autorizada com o mesmo hash de configuração, revisão do administrador, token de produção e liberação explícita do servidor.

## Configuração

1. Confirmar com a contabilidade qual serviço é faturado, seu tomador, valor efetivo, tributação e canal emissor aplicável ao enquadramento. Não converter aluguel bruto, IPTU, condomínio, repasses ou títulos Widesys em serviços por inferência.
2. Contratar/autorizar a conta Focus, cadastrar o emitente e o certificado diretamente no provedor, com seus procedimentos seguros. Não enviar certificado, senha ou token por chat e não versionar segredos.
3. Seguir o guia de Goiânia: liberação de webservice em produção e faixa DPS/RPS no portal/provedor. Confirmar série e próximo número livre; outros emissores não podem usar a mesma faixa sem coordenação.
4. No servidor, configurar o token correspondente à empresa e ao ambiente:

   ```dotenv
   FOCUS_NFSE_TOKEN_HOMOLOGACAO=
   FOCUS_NFSE_TOKEN_PRODUCAO=
   FISCAL_EMISSAO_PRODUCAO=0
   ```

   Manter `FISCAL_EMISSAO_PRODUCAO=0` até terminar a homologação. O formulário mostra somente presença das variáveis, nunca o segredo. Certificado/senha não são armazenados no banco Brisa.
5. Abrir **Financeiro → Notas fiscais → Emitente e configuração**, completar todos os campos e salvar inicialmente sem transmissão. Ativar homologação somente quando o token estiver instalado e o operador estiver autorizado a enviar dados de teste.
6. Criar um rascunho de teste, revisar, aprovar e confirmar a transmissão. Consultar a mesma referência até autorização e validar o documento com a contabilidade. Só então marcar a homologação validada e liberar produção, caso desejado.

## Operação segura

`RASCUNHO → APROVADA → TRANSMITINDO → PROCESSANDO → AUTORIZADA`

Rejeição definitiva permite corrigir **o mesmo rascunho**, com nova revisão. Referência e DPS são mantidas. Documento negado/duplicidade de DPS, timeout, erro 5xx, resposta incompatível ou identidade divergente geram **INCERTA**, sem liberação para nova emissão. A recuperação ocorre por consulta GET da referência original. Um 404 isolado não prova que não houve emissão.

- Identificador obrigatório da prestação normalizado + CNPJ + ambiente formam uma chave única persistente. Não criar identificador novo só para contornar documento pendente.
- Série/número DPS reservados atomicamente ao salvar, sem reutilização. O número não pode retroceder; CNPJ e série ficam travados depois da primeira reserva.
- Duas confirmações concorrentes disputam a mesma transição; apenas uma chama o POST.
- Versão do conteúdo e configuração fiscal são verificadas antes de aprovar/transmitir. Sequencial DPS não invalida outras revisões; mudança tributária invalida.
- Tokens e hosts não vêm do formulário; hosts são fixos, HTTPS, sem redirecionamento. Token no Basic Auth com senha vazia, corpo e segredos nunca são registrados em logs.
- Resposta só autoriza com referência e CNPJ correspondentes e número da nota. URLs de documentos precisam ser HTTPS em hosts fiscais permitidos.
- Recuperação de processo interrompido após dois minutos: consultar, nunca repetir cegamente. Autorizações e cancelamentos confirmados não são apagados por respostas inconclusivas posteriores.
- Eventos registram aprovação, reserva, correção, transmissão e consulta. Não há envio de notas ao cliente nem emissão automática em cron nesta etapa.
- Emitir/autorizar uma NFS-e **não cria outra receita nem baixa uma cobrança**. O módulo fiscal não duplica os valores da operação financeira.
- Cancelamento/substituição: procedimento municipal/provedor fora do módulo; atualizar o status pela consulta quando o provedor o disponibilizar.

## Evoluções não incluídas

Envio direto SOAP/XML com certificado A1, emissão em lote automático, cron de consultas, webhook fiscal, captura/armazenamento local de XML/PDF, mais de um perfil emitente, operações especiais, documentos fiscais de entrada e distribuição eletrônica aos tomadores. O PDF é aberto em link validado do autorizador/provedor, sem copiar documento privado para canais de cobrança.

## Fontes primárias consultadas

- [Prefeitura: FAQ municipal de março/2026](https://www.goiania.go.gov.br/wp-content/uploads/2026/03/FAQ_FINAL_V3.pdf) — contexto da migração, não usado como layout atual.
- [NotaControl: manual modelo nacional 1.01](https://www.notacontrol.com.br/download/nfse/Manual_integracao_v101.pdf) — revisão de 03/08/2026, substituição do modelo anterior.
- [Focus: guia técnico atual de Goiânia](https://focusnfe.com.br/guides/nfse/municipios-integrados/goiania-go/) — endpoint nacional com autorizador municipal, liberação e limites.
- [Focus: emissão DPS](https://doc.focusnfe.com.br/reference/emitir_dps_nacional), [consulta](https://doc.focusnfe.com.br/reference/consultar_nfse_nacional), [campos](https://campos.focusnfe.com.br/nfse_nacional/EmissaoDPSXml.html), [referência](https://doc.focusnfe.com.br/reference/referencia), [ambientes](https://doc.focusnfe.com.br/reference/ambiente) e [autenticação](https://doc.focusnfe.com.br/reference/autenticacao).

As regras fiscais e a migração de ambiente podem mudar. Revalidar fontes e homologar o enquadramento da empresa antes de cada alteração relevante de layout/tributação.

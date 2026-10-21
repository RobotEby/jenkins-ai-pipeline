# Revisão por IA local

[README](../../README-pt-BR.md) · [English](../ai-review.md) · Português (Brasil)

O [script de revisão](../../scripts/review.js) envia trechos de código versionado ao Ollama e salva sugestões para avaliação humana. Ele não aplica patches, cria commits ou aprova implantações. Os [testes e verificações de implantação da esteira](architecture.md#resultado-do-build-e-condições-para-implantar) determinam se a aplicação pode ser publicada.

## Modelo e inferência

O modelo padrão é `qwen2.5-coder:1.5b`, compartilhado entre a API e o script de revisão. O Ollama executa localmente com recursos de nuvem desabilitados, uma inferência por vez e um modelo carregado. Tanto o Ollama quanto o cliente usam contexto de 8.192 tokens.

Antes da revisão, `npm run model:prepare` consulta `/api/tags`, com até 30 tentativas de disponibilidade, e baixa um modelo ausente por `/api/pull`. Os builds seguintes reutilizam o modelo baixado. Veja os comandos manuais em [consulta e preparação do modelo](operations.md#consulta-e-preparação-do-modelo).

O [cliente Ollama](../../src/ollama.js) solicita temperatura `0` e saída sem streaming, com até 1.200 tokens gerados para revisão ou 256 para chat. Os limites de tempo de execução estão no [guia de operação](operations.md#limites-de-tempo).

## Seleção do código

O coletor revisa o diff de `GIT_PREVIOUS_SUCCESSFUL_COMMIT` até `HEAD` quando a base é um ancestral válido. Caso contrário, lê um snapshot de `HEAD`. O modo diff inclui arquivos alterados e excluídos, com prioridade para caminhos em `src/`. Alterações sem commit e arquivos não versionados ficam fora dessa entrada.

São aceitos arquivos JavaScript, JSON, YAML, Groovy, Dockerfiles, Jenkinsfiles e listas de plugins. O coletor exclui variantes de `.env`, caminhos com nomes de segredos ou credenciais, nomes de chaves privadas, diretórios gerados e lockfiles de pacotes. A documentação Markdown também fica fora do filtro. Chaves privadas, URLs de webhook do Discord e alguns padrões de tokens reconhecidos são removidos antes da inferência.

A entrada é limitada a 12.000 caracteres de string JavaScript, incluindo os rótulos dos arquivos. O truncamento registra `partial: true` no relatório. Quando não há entrada relevante, a revisão fica como `skipped`, sem consultar o modelo.

## Resultados da revisão

O script solicita JSON estruturado e valida um resumo não vazio, até cinco sugestões, caminhos de arquivos enviados e gravidades `baixa`, `media` ou `alta`. O resumo e cada sugestão são cortados em 300 caracteres para caber no limite de 1.200 tokens; sugestões com arquivo ou gravidade desconhecidos são descartadas. Respostas válidas resultam em `completed`; respostas inválidas ou indisponíveis, em `unavailable`.

O prompt pede português, e os relatórios gerados usam rótulos em português. Os resultados são salvos em `reports/review.json` e `reports/review.md`. Quando a coleta de código termina com sucesso, o JSON também registra modelo, arquivos selecionados, modo de revisão, commit base e truncamento. Esses relatórios fazem parte dos [artefatos do build](operations.md#artefatos-do-build).

## Limitações práticas

A revisão cobre apenas o snapshot selecionado ou o contexto do diff, e o modelo pode deixar passar problemas ou sugerir alterações incorretas. Avalie as sugestões com base no código e nos testes. A saída estruturada valida o formato da resposta, não a qualidade da análise.

Revisão, verificações de implantação e requisições de chat compartilham a capacidade de inferência. Um modelo ocupado ou lento pode exceder o timeout de uma requisição. Erros comuns de preparação ou revisão deixam o build `UNSTABLE`; as verificações posteriores de implantação ainda exigem um modelo funcional.

A remoção de segredos reconhece padrões específicos, por isso mantenha as credenciais fora do código e armazene-as no Jenkins. A inferência é local, enquanto o Discord recebe o resumo da revisão e até três sugestões. Veja em [segurança e confiança no ambiente local](setup.md#limites-de-confiança-do-ambiente-local) como o acesso é organizado.

Continue em [arquitetura da esteira](architecture.md) ou [configuração e operação](operations.md).

# Pipeline Jenkins com revisão por IA local

[English](README.md) · Português (Brasil)

Este projeto de CI/CD local para uma API Node.js reúne testes no Jenkins, revisão consultiva com Ollama, implantação em Docker e notificações de build no Discord. Mostra como incorporar sugestões de IA mantendo a decisão de implantar nas verificações automatizadas.

A aplicação é pequena de propósito: um endpoint de saúde identifica o commit em execução, e o chat consulta o modelo local. A esteira valida o código implantado e a conexão com o Ollama. Aplicação e scripts usam APIs nativas do Node.js 24, sem dependências npm de execução.

## Como funciona

O Jenkins consulta a branch Git configurada a cada cinco minutos. Após o checkout, executa os testes, prepara o modelo e solicita uma revisão de código. Se os testes passarem, constrói uma imagem identificada pelo commit e pelo número do build. Um contêiner temporário precisa passar nas verificações de saúde, commit e inferência real antes da substituição da aplicação. As mesmas verificações são repetidas após a implantação; se falharem, a esteira tenta restaurar a imagem anterior.

As sugestões da IA nunca alteram o código nem aprovam a implantação. Falhas comuns na revisão deixam o build como `UNSTABLE`, mas permitem continuar as demais verificações. O Ollama também é uma dependência da aplicação: se ela não conseguir concluir uma inferência, a validação da implantação falhará. Limites de tempo do Jenkins e cancelamentos manuais podem interromper a esteira.

Jenkins e Ollama são serviços do Compose, e o Jenkins controla os contêineres pelo socket Docker do host. Os relatórios ficam no Jenkins; o Discord recebe um resumo. O acesso ao socket dá ao Jenkins amplo controle sobre o host, por isso a esteira deve executar apenas código confiável.

## Limitações

O ambiente é um laboratório em um único host. Revisão, validação da implantação e chat compartilham a capacidade de inferência; substituir a aplicação pode interromper requisições brevemente. Mensagens da aplicação e dos scripts, erros da API e resultados da revisão por IA são em português, independentemente do idioma escolhido para a documentação.

## Início rápido

Use Linux ou WSL2 com Docker Engine, Docker Compose e permissão de acesso ao Docker. O Node.js 24 só é necessário no host para desenvolver e testar fora dos contêineres. O Jenkins precisa acessar seu repositório Git; para receber notificações, é necessário um webhook de canal do Discord.

1. Na raiz do repositório, crie a configuração local caso ela ainda não exista:

   ```sh
   test -f .env || cp .env.example .env
   stat -c '%g' /var/run/docker.sock
   ```

   Preencha `DOCKER_GID` no `.env` com o número retornado. O Git ignora esse arquivo de configuração local; mantenha as credenciais no Jenkins.

2. Inicie Jenkins e Ollama e consulte a senha inicial do Jenkins:

   ```sh
   docker compose up -d --build jenkins ollama
   docker compose exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
   ```

3. Abra o [Jenkins](http://localhost:8080), conclua a inicialização e siga o [guia de configuração](docs/pt-BR/setup.md#configurar-o-jenkins) para definir um executor, criar um job Pipeline com o `Jenkinsfile` e cadastrar a credencial `discord-webhook-url`. Execute **Construir agora** uma vez para iniciar a esteira e registrar a consulta periódica ao Git. O primeiro build baixa o modelo, se necessário.

Após uma implantação bem-sucedida, experimente a API na porta padrão:

```sh
curl http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Explique integração contínua em uma frase."}'
```

A resposta contém `reply` e `model`. O Jenkins só publica a aplicação depois de validá-la; iniciar a infraestrutura não inicia a API.

## Estrutura do projeto

```text
src/          API HTTP e cliente Ollama
scripts/      Revisão, implantação, relatórios e notificações
test/         Testes automatizados
jenkins/      Imagem Jenkins e lista de plugins
docs/         Guias em inglês e português brasileiro
Jenkinsfile   Etapas da esteira e tratamento dos builds
compose.yaml  Serviços, rede e volumes
Dockerfile    Imagem da aplicação
```

## Documentação

- [Configuração](docs/pt-BR/setup.md): preparação do ambiente, Jenkins, acesso ao repositório e credenciais do Discord.
- [Segurança e confiança no ambiente local](docs/pt-BR/setup.md#limites-de-confiança-do-ambiente-local): acesso ao socket Docker e limites de confiança do ambiente.
- [Arquitetura](docs/pt-BR/architecture.md): comunicação entre serviços, fluxo da esteira e decisões de implantação.
- [Revisão por IA](docs/pt-BR/ai-review.md): configuração do modelo, seleção de código, resultados da revisão e limitações.
- [Operação](docs/pt-BR/operations.md): configuração de variáveis, referência da API, testes, implantação, recuperação e diagnóstico.

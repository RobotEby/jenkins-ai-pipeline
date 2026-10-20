# Jenkins pipeline with local AI review

English · [Português (Brasil)](README-pt-BR.md)

A local CI/CD project for a Node.js API that combines Jenkins tests, advisory code review through Ollama, Docker deployment, and Discord build notifications. It demonstrates how to add model feedback to a pipeline while keeping deployment decisions tied to executable checks.

The application is deliberately small: a health endpoint identifies the running commit, and a chat endpoint calls the local model. This lets the pipeline validate both the deployed code and its connection to Ollama. The application and automation use Node.js 24 built-in APIs, with no npm runtime dependencies.

## How it works

Jenkins polls the configured Git branch for changes every five minutes. After checkout, it runs the tests, prepares the model, and requests a code review. Passing tests allow it to build an image tagged with the commit and build number. A temporary container must pass health, commit, and real-inference checks before Jenkins replaces the running application. The same checks run after deployment; a failure triggers an attempt to restore the previous image.

AI suggestions never edit code or approve deployment. Ordinary review failures make the build `UNSTABLE` without preventing the remaining checks. Ollama is still a runtime dependency: an application that cannot complete an inference will fail deployment validation. Jenkins timeouts and manual aborts can stop the pipeline.

Jenkins and Ollama run as Compose services; Jenkins controls containers through the host Docker socket. Build reports stay in Jenkins, and Discord receives a summary. Docker socket access gives Jenkins extensive control over the host, so the pipeline must run trusted source code.

## Limitations

This is a single-host laboratory setup. Review, deployment checks, and chat requests share the same inference capacity, and replacing the application can briefly interrupt requests. Application and script messages, API errors, and AI review output are currently in Portuguese; the documentation language switch does not change runtime output.

## Quick start

Use Linux or WSL2 with Docker Engine, Docker Compose, and permission to access Docker. Node.js 24 is needed only for development and tests outside the containers. Jenkins needs access to your Git repository; Discord delivery requires a channel webhook.

1. From the repository root, create the local configuration if it does not already exist:

   ```sh
   test -f .env || cp .env.example .env
   stat -c '%g' /var/run/docker.sock
   ```

   Set `DOCKER_GID` in `.env` to the returned group ID. Git ignores this local configuration file; keep credentials in Jenkins.

2. Start Jenkins and Ollama, then retrieve the Jenkins setup password:

   ```sh
   docker compose up -d --build jenkins ollama
   docker compose exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
   ```

3. Open [Jenkins](http://localhost:8080), complete initialization, and follow the [setup guide](docs/setup.md#configure-jenkins) to configure one executor, a Pipeline job using `Jenkinsfile`, and the `discord-webhook-url` credential. Run **Build Now** once to start the pipeline and register its polling schedule. The first build downloads the model if necessary.

After a successful deployment, try the API at the default port:

```sh
curl http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Explain continuous integration in one sentence."}'
```

The response contains `reply` and `model`. Jenkins publishes only the application that passes validation; starting the infrastructure alone does not start the API.

## Project structure

```text
src/          HTTP API and Ollama client
scripts/      Review, deployment, reports, and notifications
test/         Automated tests
jenkins/      Jenkins image and plugin list
docs/         English and Brazilian Portuguese guides
Jenkinsfile   Pipeline stages and build handling
compose.yaml  Services, networking, and volumes
Dockerfile    Application image
```

## Documentation

- [Setup](docs/setup.md): environment preparation, Jenkins, repository access, and Discord credentials.
- [Security and local trust](docs/setup.md#local-trust-boundary): Docker socket access and the local environment's trust boundaries.
- [Architecture](docs/architecture.md): service communication, pipeline flow, and deployment decisions.
- [AI review](docs/ai-review.md): model configuration, code selection, review results, and limitations.
- [Operations](docs/operations.md): configuration, API reference, tests, deployment, recovery, and troubleshooting.

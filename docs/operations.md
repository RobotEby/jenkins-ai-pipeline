# Configuration, testing, and operations

[README](../README.md) · English · [Português (Brasil)](pt-BR/operations.md)

Run these commands from the repository root. Complete [setup](setup.md) before procedures that use containers. The [architecture guide](architecture.md) explains how build status, AI feedback, and deployment decisions relate.

## Configuration

Compose reads `.env` in the project directory. Node scripts do not load it automatically; use exported variables or Node's `--env-file` option when invoking them directly. Existing shell variables take precedence over values in `.env`.

| Variable               | Default and scope                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOCKER_GID`           | Compose defaults to `0`; set it to the host Docker socket's group before starting Jenkins.                                                                          |
| `OLLAMA_MODEL`         | `qwen2.5-coder:1.5b`; Compose passes it to Jenkins and the application. Review and API use the same model.                                                          |
| `APP_PORT`             | `3000`; changes the host port bound to `127.0.0.1`. The application always listens on port `3000` inside its container.                                             |
| `COMPOSE_PROJECT_NAME` | `jenkins-ai-pipeline`; the deployment script expects this project's `<project>_default` network. Use the same name for infrastructure and deployment.               |
| `OLLAMA_URL`           | `http://ollama:11434`; fixed in Compose for Jenkins and the application, and the default in Node scripts. Editing `.env` alone does not override the Compose value. |
| `APP_IMAGE`            | Set by Jenkins for each build. Compose falls back to `jenkins-ai-pipeline:local`, which must already exist if used manually.                                        |
| `APP_COMMIT`           | Embedded by the Docker build argument; defaults to `development` for an image built without it. Returned by `/health`.                                              |
| `DISCORD_WEBHOOK_URL`  | No default; supplied by Jenkins credential `discord-webhook-url` during notification.                                                                               |

Jenkins also supplies `GIT_COMMIT`, `GIT_PREVIOUS_SUCCESSFUL_COMMIT`, `BUILD_NUMBER`, and `BUILD_URL`. The pipeline derives `TEST_EXIT`, `TEST_SUMMARY`, and `BUILD_RESULT`. Deployment passes `EXPECTED_COMMIT` to the smoke check; these values are execution metadata, not settings to copy into `.env`.

After changing `OLLAMA_MODEL` or `APP_PORT` in `.env`, update the Jenkins container and run a new build:

```sh
docker compose up -d jenkins
```

The application receives the new values during deployment. Keep the project name consistent; changing it targets a different Compose stack and network. Model settings and shared inference capacity are described in [AI review](ai-review.md#model-and-inference).

### Execution timeouts

The pipeline has a 45-minute overall timeout. Individual operations have these limits:

| Operation         | Script or client limit     | Jenkins limit                          |
| ----------------- | -------------------------- | -------------------------------------- |
| Model preparation | 20 minutes for download    | 25 minutes, including readiness checks |
| AI review         | Five minutes per inference | Six minutes                            |
| API inference     | 120 seconds                | —                                      |
| Notification      | Ten seconds per request    | Two minutes                            |

Script-level preparation and review failures are handled as `UNSTABLE`. Jenkins timeouts and manual aborts propagate through `catchInterruptions: false` and interrupt execution. See [Jenkins error handling](https://www.jenkins.io/doc/pipeline/steps/workflow-basic-steps/#catcherror-catch-error-and-set-build-result-to-failure).

## API

The following examples use the default host port. Implementation lives in [the HTTP server](../src/server.js) and [Ollama client](../src/ollama.js).

```sh
curl http://localhost:3000/health
# {"status":"ok","commit":"<full-commit-sha>"}

curl http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Explain continuous integration in one sentence."}'
# {"reply":"...","model":"qwen2.5-coder:1.5b"}
```

`GET /health` checks the HTTP process and reports its configured commit. It does not contact Ollama. `POST /chat` accepts a JSON object with a nonempty string `message`, sends one user message to Ollama, and returns `reply` and `model`. Requests are independent, with no stored conversation history and no streaming response.

Application errors use `{"error":"..."}`, with messages currently in Portuguese.

| HTTP status | Condition                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `400`       | Invalid JSON, invalid or empty `message`, or an interrupted request body.                       |
| `404`       | Unknown route.                                                                                  |
| `405`       | Unsupported method on `/health` or `/chat`; `Allow` indicates the accepted method.              |
| `413`       | Body exceeds 16,384 bytes, measured in bytes rather than text characters.                       |
| `415`       | Content type is not `application/json`.                                                         |
| `500`       | Unexpected application error.                                                                   |
| `502`       | Invalid, incomplete, or empty model response.                                                   |
| `503`       | Ollama is unreachable or returns an unsuccessful HTTP response, including an unavailable model. |
| `504`       | Inference exceeds the 120-second client timeout.                                                |

`npm start` runs the API directly on `0.0.0.0:3000`. For host execution, `OLLAMA_URL` must point to an Ollama instance reachable from that host; the Compose hostname `ollama` and its unpublished port are not a host connection. The Compose deployment avoids that mismatch by running the API on the shared network.

## Automated tests

With Node.js 24 and Git available, the tests need no running Docker service, Ollama model, Discord credential, or external network access:

```sh
npm test
npm run test:ci
docker compose config --quiet
docker compose --profile app config --quiet
```

Both test commands run the same suite. `test:ci` also produces `reports/tests.xml` and `reports/tests.json`. Tests use local HTTP servers, temporary Git repositories, and simulated Docker commands. They cover API validation and upstream errors, model preparation, review selection and truncation, structured-output validation, notification limits and retries, and deployment recovery.

No dependency installation is required to run the application or tests. Prettier is the only development dependency. If you need it locally, `npm ci` installs the locked development tooling; `npm run format` rewrites the whole repository, so target individual files for documentation-only work.

Passing these tests does not verify a Jenkins installation, Docker image build, real model response, or Discord delivery. An integration check requires running the configured job, inspecting the deployed API and archived reports, and confirming receipt in the channel.

## Model inspection and preparation

Inspect the models visible to Jenkins:

```sh
docker compose exec jenkins node -e 'fetch("http://ollama:11434/api/tags").then(r=>r.json()).then(console.log)'
```

To download the default model manually:

```sh
docker compose exec ollama ollama pull qwen2.5-coder:1.5b
```

If `OLLAMA_MODEL` differs, use that model name instead. The pipeline normally prepares it automatically. The Ollama volume preserves downloaded models; changing the selected model does not delete old ones.

## Deployment and recovery

[The deployment script](../scripts/deploy.js) records the current application's image ID and embedded commit when a running application is found. If it cannot identify that commit, it stops before replacing the application. It then runs a candidate on the existing Compose network and invokes [the smoke check](../scripts/smoke.js) inside it.

The smoke check retries `/health` up to 30 times and requires both `status: "ok"` and the expected commit. It then makes one real `/chat` call and requires a nonempty reply and the configured model name. The prompt asks for `OK`, but the check does not require that exact text or assess answer quality.

Only a passing candidate reaches application replacement. Compose updates `app` with `--no-deps --wait --wait-timeout 60`, then the script repeats the smoke check against the deployed container. The image's Docker health check only checks HTTP success from `/health`; it is weaker than this full deployment check.

| `deployment.json` status | Meaning                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `checking_candidate`     | Candidate validation is about to run; this can remain after an interruption.                           |
| `candidate_failed`       | Candidate startup or validation failed before application replacement.                                 |
| `deploying`              | Application replacement is about to run; final outcome has not been recorded.                          |
| `deployed`               | The deployed application passed the complete smoke check.                                              |
| `rolled_back`            | Deployment failed and the previous image passed recovery checks. The script still exits with an error. |
| `rollback_failed`        | Deployment and recovery failed; manual intervention is needed.                                         |
| `failed_first_deploy`    | There was no previous running application; removal of the failed application was attempted.            |

The script attempts to remove the candidate after validation. Cleanup failures are logged, so a leftover candidate is possible. Early configuration or inspection errors can occur before any deployment report is written.

Recovery restores the previous image ID with the current Compose configuration; it does not restore older environment values or the Ollama volume. A model or configuration problem can therefore affect both versions. A forced interruption may leave the last report incomplete and require manual recovery.

### Deploy manually

Use this only after Jenkins and Ollama are running and the selected model is available. Use committed source matching `HEAD`: Docker builds the working tree, so a dirty checkout can falsely label different code with that commit. Avoid overlapping this procedure with a Jenkins deployment.

The subshell keeps temporary build variables out of your shell and stops on failure:

```sh
(
  set -e
  export GIT_COMMIT="$(git rev-parse HEAD)"
  export APP_IMAGE="jenkins-ai-pipeline:manual-$GIT_COMMIT"
  npm test
  docker build --build-arg APP_COMMIT="$GIT_COMMIT" --tag "$APP_IMAGE" .
  node --env-file=.env scripts/deploy.js
)
```

Loading `.env` explicitly keeps the candidate's model and project name aligned with Compose. This runs the test, build, and deployment path; it does not perform the Jenkins review, archive reports in Jenkins, or notify Discord.

### Restore an image manually

For `rollback_failed`, find `previousImage` in the affected build's `deployment.json`. If it is `null`, there is no recorded image to restore. Replace the placeholder below with the full recorded image ID, and use the same Compose project and model configuration:

```sh
APP_IMAGE='sha256:<previous-image-id>' docker compose up -d --no-deps --wait --wait-timeout 60 app
docker compose exec app node scripts/smoke.js
docker compose logs --tail=100 app ollama
```

The manual smoke check uses the restored image's embedded `APP_COMMIT`. Compare `/health` with the intended previous commit as well. If inference fails, investigate Ollama and the active configuration before treating recovery as complete.

## Build artifacts

Reports are written to `reports/` in the working directory. Jenkins clears its workspace at checkout and archives available reports in post-processing; local commands leave their reports in your local directory.

| Artifact                   | Contents                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `tests.xml`, `tests.json`  | JUnit test results and the test runner's status and exit code.                                                                      |
| `model.json`               | `ready` with model and download information, or `unavailable`.                                                                      |
| `review.json`, `review.md` | Review outcome, summary, and findings; JSON also records model, files, mode, base commit, and truncation when collection succeeded. |
| `deployment.json`          | Requested image, commit, previous image ID, and most recently recorded deployment status.                                           |
| `notification.json`        | `sent` or `failed` when the notification script reached report writing.                                                             |

Use the build console alongside artifacts to identify where execution stopped if reports are incomplete.

### Notification delivery

The [notification script](../scripts/notify.js) sends to Discord with `wait=true` and at most three attempts. Network errors, HTTP 429, and server errors can be retried; other client errors stop delivery immediately. The script uses a one-second retry delay, or Discord's `retry_after` for HTTP 429, and stops if the requested wait exceeds 30 seconds. Request and stage limits are listed under [execution timeouts](#execution-timeouts).

If checkout did not provide the script, Jenkins attempts a minimal message with one ten-second request. This fallback does not create `notification.json`; a missing Jenkins credential also prevents the normal script from starting. Aborted post-processing can leave reports or delivery incomplete.

Discord reports the build status at notification time; Jenkins shows the final result.

## Troubleshooting and maintenance

**Jenkins cannot access Docker.** Compare the socket's group ID with `DOCKER_GID`, then recreate Jenkins with `docker compose up -d jenkins`. Check access from the container with `docker compose exec jenkins docker version`. Avoid making the socket writable by every user.

**Health succeeds but chat or deployment fails.** Check Ollama logs and the model list, confirm `OLLAMA_MODEL`, and distinguish a missing model from a timeout. The Jenkins console shows the cause of a failed check, including the API's HTTP status and error message (`Modelo não encontrado.` for a missing model, `Tempo limite do modelo excedido.` for a timeout). Review and user requests share the same inference capacity. `/health` cannot diagnose that dependency.

**Build is unstable after deployment.** Inspect model, review, and notification reports and the Jenkins console. Invalid review output or missing Discord credentials can explain this result without requiring recovery. **No notification** can also mean a network failure, rejected webhook, rate limit, or interrupted post-processing; the full webhook URL should remain in Jenkins credentials.

Inspect recent service logs with:

```sh
docker compose logs --tail=100 jenkins ollama app
```

Images remain available for recovery until removed. Jenkins build retention does not clean them up; inspect running containers and recovery needs before deleting older images. The Ollama image is pinned by digest, while the Jenkins LTS, Node.js 24, and Docker CLI 29 base images follow their tags. Rebuild and validate after changing or refreshing these images.

Stop and remove this project's containers and network while retaining its named volumes:

```sh
docker compose --profile app down
```

Do not add `--volumes` if you need to preserve Jenkins data and downloaded models. Any candidate left behind by an interrupted deployment was created outside Compose and may require separate cleanup after inspection.

Return to [setup](setup.md), [architecture](architecture.md), or [AI review](ai-review.md).

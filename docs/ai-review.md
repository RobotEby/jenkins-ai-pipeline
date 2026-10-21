# Local AI review

[README](../README.md) · English · [Português (Brasil)](pt-BR/ai-review.md)

The [review script](../scripts/review.js) sends selected committed code to Ollama and saves suggestions for human review. It does not apply patches, create commits, or approve deployments. The [pipeline's test and deployment checks](architecture.md#build-results-and-deployment-gates) determine whether the application can be released.

## Model and inference

The default model is `qwen2.5-coder:1.5b`, shared by the API and review script. Ollama runs locally with cloud features disabled, one parallel inference, and one loaded model. Both Ollama and the client use an 8,192-token context.

Before review, `npm run model:prepare` checks `/api/tags`, with up to 30 readiness attempts, and downloads an absent model through `/api/pull`. Subsequent builds reuse the downloaded model. See [model inspection and preparation](operations.md#model-inspection-and-preparation) for manual commands.

The [Ollama client](../src/ollama.js) requests temperature `0` and non-streaming output, with up to 1,200 generated tokens for review or 256 for chat. Execution timeouts are listed in [operations](operations.md#execution-timeouts).

## Code selection

The collector reviews the diff from `GIT_PREVIOUS_SUCCESSFUL_COMMIT` to `HEAD` when the base is a valid ancestor. Otherwise, it reads a snapshot from `HEAD`. Diff mode includes changed and deleted files, with `src/` paths prioritized. Uncommitted changes and untracked files are outside this input.

Eligible files are JavaScript, JSON, YAML, Groovy, Dockerfiles, Jenkinsfiles, and plugin lists. The collector excludes `.env` variants, paths with secret or credential names, private-key names, generated directories, and package lockfiles. Markdown documentation is also outside the filter. Recognized private keys, Discord webhook URLs, and selected token patterns are redacted before inference.

Input is capped at 12,000 JavaScript string characters, including file labels. Truncation sets `partial: true` in the report. If no relevant input exists, the review is `skipped` without calling the model.

## Review results

The script requests structured JSON and validates a nonempty summary, up to five findings, submitted file paths, and severities `baixa`, `media`, or `alta`. Summaries and individual suggestions are cut to 300 characters to fit the 1,200-token budget; findings with an unknown file or severity are dropped. Each finding must also quote, in `evidence`, a line that appears in the code sent for that file (whitespace is ignored); findings without a matching quote are dropped, and if the model returned findings but none survive, the summary is replaced with a notice that they were discarded. Valid responses produce `completed`; invalid or unavailable responses produce `unavailable`.

The prompt requests Portuguese, and generated reports use Portuguese labels. Results are saved as `reports/review.json` and `reports/review.md`. When code collection succeeds, the JSON also records the model, selected files, review mode, base commit, and truncation. These reports appear among the [build artifacts](operations.md#build-artifacts).

## Practical limitations

A review covers only the selected snapshot or diff context, and the model can miss problems or suggest incorrect changes. Evaluate findings against the code and tests. Structured output validates the response format, not the quality of the analysis.

Review, deployment checks, and chat requests share the same inference capacity. A busy or slow model can exceed a request's timeout. Ordinary preparation or review errors mark the build `UNSTABLE`; later deployment checks still require a working model.

Redaction recognizes selected patterns, so keep credentials out of source and store them in Jenkins. Inference stays local, while Discord receives the review summary and up to three findings. See [security and local trust](setup.md#local-trust-boundary) for the surrounding access model.

Continue with [pipeline architecture](architecture.md) or [configuration and operations](operations.md).

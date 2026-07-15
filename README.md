# Workflow M0

Workflow M0 is a local, Pi Agent-based workflow platform for one fixed executable path:

```text
input.prompt -> process.agent -> output.markdown
```

It imports immutable JSON Workflow Definitions, creates Runs asynchronously, executes the Agent node in a separate worker, persists history and Markdown in PostgreSQL, and exposes a temporary read-only Web shell.

## Quick start

Prerequisites: Node.js 22, Docker with Compose, GNU Make, and a local checkout of this repository.

```bash
make setup
make doctor
make up
```

Open <http://localhost:3000>. The seeded Workflow is ready to use with the deterministic Fake Provider. To import another Definition, choose **Import workflow** on the Workflow List. Open a Workflow Detail page, choose **Run workflow**, and enter the Prompt in the right-side **Run Sheet**. Run Detail polls the persisted projection and History reopens the original Run and Definition Version.

Stop the stack when finished:

```bash
make down
```

## Provider Bindings

There is no global Provider. Every `process.agent` node stores its own immutable `agentVersionRef` and `providerBindingRef`; the worker resolves that alias from a server-side JSON file. Definitions never contain a Provider URL, credential, model override, or runtime parameters.

The committed Fake Provider example is deterministic and is the configuration used by CI:

```json
{
  "bindings": {
    "fake-default": {
      "provider": "openai-compatible",
      "baseUrl": "http://fake-provider:4010/v1",
      "apiKeyEnv": "FAKE_PROVIDER_API_KEY",
      "model": "fake-m0",
      "parameters": {
        "temperature": 0
      }
    }
  }
}
```

For an HTTPS OpenAI-compatible endpoint, copy `config/provider-bindings.example.json` to an untracked local file such as `config/provider-bindings.local.json`, replace its contents with only the allowlisted fields below, and do not stage that file:

```json
{
  "bindings": {
    "primary-model": {
      "provider": "openai-compatible",
      "baseUrl": "https://api.example.com/v1",
      "apiKeyEnv": "MODEL_PROVIDER_API_KEY",
      "model": "provider-model",
      "parameters": {
        "temperature": 0
      }
    }
  }
}
```

Set `PROVIDER_BINDINGS_FILE=config/provider-bindings.local.json` in the ignored `.env` file. Keep `WORKFLOW_ENV_FILE=.env`, and add the credential there using this placeholder until replacing it on your own machine:

```bash
MODEL_PROVIDER_API_KEY=<your-provider-api-key>
```

Provider credentials are resolved from the worker's `WORKFLOW_ENV_FILE`. Compose passes no provider credential to the app container, and the browser, Definition, Run projection, database snapshots, ordinary logs, and evidence bundles retain no credential value, `apiKeyEnv`, or Provider Base URL. Never commit the local binding or environment files.

The M0 blocking suite always uses the Fake Provider. A dedicated `ModelProvider` interface, a DeepSeek adapter, and opt-in live-model evaluation are follow-up work after `m0-v0.1.0`; live calls will remain separate from deterministic CI.

## Commands and operations

```bash
make setup          # pin/install dependencies and create .env from the fake fixture
make doctor         # validate local tools, database settings, binding, and credential presence
make up             # build and start app, worker, PostgreSQL, migration, and Fake Provider
make down           # stop the stack
make logs           # follow service logs
make smoke-test     # check the running readiness endpoint
make support-bundle # create a redacted diagnostic bundle under artifacts/acceptance/M0
make verify-m0      # run all 13 blocking M0 cases and seal acceptance evidence
```

`make support-bundle` and `make verify-m0` write to a fresh `EVIDENCE_DIR`; they refuse to overwrite owned evidence. A complete acceptance bundle contains human- and machine-readable reports, the runtime requirement matrix, versions, container identities/digests, test results, logs, screenshots/traces, support diagnostics, `MANIFEST`, and `SHA256SUMS`.

## Web experience

The Web shell provides Workflow List, JSON Import, a neutral read-only three-node Board, the right-side Run Sheet, status-text History, Run Detail, Markdown Output, and failure explanations. Each Agent card displays its own Provider Binding and configured model; Run Detail adds the effective model captured at execution. The interface uses an Apple-like minimal light treatment, system dark-mode tokens, and a narrow responsive layout.

`Run again` pre-fills the original Prompt and creates a new Run pinned to the original Definition Version. It is not Retry. Provider failures and worker loss show the affected Agent, the skipped downstream Output, the safe error code, and the next operator action.

## M0 limits and security

M0 deliberately excludes Builder editing, Retry/Cancel, SSE, Replay/Compare, Feishu, Human Interaction, Logic/Loop, Tool Gateway, Memory, product-level Subagents, arbitrary code, multi-user/RBAC, Temporal, and a product Evidence/Artifact browser.

Each Run has one Attempt per executed node. A worker loss before dispatch becomes `worker_lost`; an uncertain post-dispatch outcome becomes `outcome_unknown`. Neither condition automatically repeats a model call. Secrets remain worker-only and acceptance scans API, DOM, database/event exports, logs, browser evidence, and nested support artifacts before a bundle can pass.

The authoritative M0 contracts and closeout records are under [`docs/plans/M0`](docs/plans/M0), while the thirteen v0.4 source artifacts remain byte-for-byte preserved under [`docs/source/v0.4`](docs/source/v0.4).

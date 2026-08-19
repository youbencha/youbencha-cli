# Phase 3 implementation plan: safe scale and extension ecosystem

**Status:** Proposed  
**Target duration:** 8–12+ weeks  
**Depends on:** Stable Phase 2 experiment and result contracts  
**Primary outcome:** Teams can add integrations without changing youBencha core
and can run the same experiment under an explicit host or container execution
profile.

> **2026-07-26 update:** E2B remote execution and the model/harness regression
> workflow are now explicitly proposed in
> [`specs/005-e2b-regression-execution`](../specs/005-e2b-regression-execution/spec.md).
> That proposal uses the execution-provider seam described here, but stages E2B
> through the existing `SingleRunExecutor` before generalizing the provider API.
> The E2B-specific security, lifecycle, scale, and baseline requirements in that
> specification supersede this plan's earlier decision to defer all cloud VM
> providers.

## 1. Scope

In scope:

- versioned registries for adapters, evaluators, pre-execution hooks,
  post-evaluation hooks, reporters, and execution providers;
- locally installed npm package plugins with declarative manifests;
- config-schema discovery and CLI help for plugin components;
- explicit host and container execution profiles;
- network, mount, environment, secret, and resource controls;
- private-repository credentials supplied through secret references;
- optional result-storage and notification plugins;
- documented schema migration, compatibility, and deprecation policy.

Out of scope:

- a remote plugin marketplace;
- automatically downloading or executing plugins from configuration;
- running untrusted plugins inside the main CLI process;
- building a general-purpose container orchestrator;
- cloud VM providers other than the separately staged E2B proposal in
  `specs/005-e2b-regression-execution`;
- storing long-lived repository credentials in youBencha configuration.

## 2. Guiding security decisions

1. Plugins are executable code and must be explicitly installed and enabled.
2. Configuration never triggers package installation.
3. Plugin resolution uses exact package names and versions from the local
   project or an explicit user plugin directory.
4. Secrets are referenced by name, resolved only at execution time, never
   serialized into effective config or results, and redacted from logs.
5. `host-trusted` accurately states that agent, repository, hook, and plugin
   code executes on the host.
6. `container` applies to the complete mutable execution lifecycle where
   practical, not only the agent subprocess.
7. Result provenance records plugin versions, execution profile, image digest,
   controls, and any policy degradation.
8. Unsupported isolation controls fail closed unless the user explicitly opts
   into a documented degraded mode.

## 3. Public extension API

### Registry model

Replace hard-coded factories in `core/orchestrator.ts` with typed registries:

```ts
interface ComponentRegistration<TConfig, TInstance> {
  kind: string;
  apiVersion: string;
  configSchema: ZodType<TConfig>;
  create(context: ComponentFactoryContext, config: TConfig): TInstance;
  capabilities?: ComponentCapabilities;
}
```

Provide separate registries:

- `AgentAdapterRegistry`
- `EvaluatorRegistry`
- `PreExecutionRegistry`
- `PostEvaluationRegistry`
- `ReporterRegistry`
- `ExecutionProviderRegistry`

Built-ins register through the same public API used by plugins. Registration
rejects duplicate kinds and incompatible API versions. Core code asks a
registry for a component; it does not import every implementation.

### API packages

Prefer a small public entry point before splitting npm packages:

```text
youbencha/plugin-api
```

It exports only:

- stable component interfaces;
- context and result types;
- schema helpers;
- error and cancellation contracts;
- logger and artifact-writer interfaces;
- API-version negotiation helpers;
- conformance-test utilities.

Do not expose internal workspace managers, storage implementations, Commander
objects, or concrete built-in classes.

### Plugin manifest

```json
{
  "name": "@example/youbencha-plugin",
  "version": "1.2.0",
  "youbencha": {
    "apiVersion": "^1.0.0",
    "entry": "./dist/plugin.js",
    "components": [
      {
        "type": "evaluator",
        "kind": "example/security-scan"
      }
    ],
    "capabilities": {
      "network": false,
      "process": true,
      "secrets": []
    }
  }
}
```

The package's `exports` map must expose the declared entry. The runtime verifies
the installed package manifest before importing it.

### Plugin configuration

```yaml
plugins:
  enabled:
    - package: "@example/youbencha-plugin"
      version: "1.2.0"

evaluators:
  - name: example/security-scan
    config:
      severity: high
```

Require an exact installed version in the effective configuration or lock
metadata. A semver range may describe compatibility in the package manifest,
but experiment provenance records the exact loaded version and entry hash.

## 4. Plugin loading and trust

### Initial loading model

The first release may load explicitly trusted plugins in process, but it must:

- resolve from approved roots using Node package resolution;
- reject paths escaping those roots;
- reject duplicate or undeclared components;
- validate config before component construction;
- pass a minimal capability-oriented context;
- apply cancellation and timeout contracts;
- label the trust model prominently in `doctor`, `validate`, and results.

Add:

```text
yb plugin list
yb plugin inspect <package>
yb plugin verify <package>
```

Installation remains the user's responsibility through npm. `yb plugin`
commands must not install packages during Phase 3.

### Future isolation seam

Design registration so evaluators/reporters can later run through a worker
process using a JSON-RPC-style protocol. Do not delay the local plugin release
until process isolation is complete, but avoid APIs that require sharing
mutable core objects.

## 5. Execution-provider architecture

Extract workspace execution from agent-specific adapters:

```text
experiment scheduler
  -> execution provider
       -> prepare source/workspace
       -> run pre-execution
       -> execute adapter
       -> run evaluators
       -> collect declared artifacts
       -> teardown
```

An `ExecutionProvider` should expose lifecycle methods and a capability report.
The first two providers are:

- `host-trusted`: current behavior, named honestly;
- `container`: local OCI-compatible runtime.

Adapters continue to define agent commands and output parsing. Providers define
where and under which controls those commands execute.

Suggested source layout:

```text
src/
  registry/
    component-registry.ts
    builtins.ts
    api-version.ts
  plugins/
    manifest.ts
    resolver.ts
    loader.ts
    provenance.ts
  execution/
    base.ts
    host-trusted.ts
    container.ts
    policies.ts
    secrets.ts
  schemas/
    plugin.schema.ts
    execution-profile.schema.ts
```

## 6. Container execution profile

### Configuration

```yaml
execution_profile:
  type: container
  image: ghcr.io/example/youbencha-runner@sha256:...
  network:
    mode: none
  mounts:
    source: read-only
    workspace: read-write
  environment:
    allow:
      - CI
  secrets:
    - name: agent-token
      source:
        env: AGENT_TOKEN
      expose_as:
        env: AGENT_TOKEN
  resources:
    cpus: 2
    memory_mb: 4096
    pids: 256
  timeout_ms: 900000
```

### Required behavior

- require immutable image digests for CI/reproducible mode;
- default network to `none`;
- mount source read-only and a dedicated workspace read-write;
- never mount the Docker socket;
- use a minimal environment allowlist;
- enforce overall timeout and best-effort CPU, memory, and process limits;
- capture runtime name/version and effective controls;
- clean up stopped containers without deleting retained result artifacts;
- reject unsupported controls or record explicit, user-approved degradation.

Container runtime selection should be capability based. Start with one
well-tested runtime; add alternatives only after the provider contract is
stable.

## 7. Private repository authentication

Support secret references, not credentials in repository URLs:

```yaml
repository:
  url: https://github.com/example/private-repo.git
  auth:
    type: token
    secret: github-token
```

Requirements:

- credentials are injected through a temporary credential helper or equivalent
  argument-safe mechanism;
- authenticated URLs are never logged or stored;
- temporary credential material has restrictive permissions and is deleted;
- redirects to disallowed hosts are rejected;
- host allowlists and SSRF controls remain enforced;
- container profiles receive only the specific declared credential;
- `doctor` can report presence, not value or validity unless an explicit
  network check is requested.

SSH support should follow later with explicit known-host verification and
agent/socket handling. Do not default to disabling host-key checks.

## 8. Schema evolution and compatibility

Before publishing extension API `1.0`:

- define semantic-versioning rules for config schemas, result schemas, and the
  plugin API separately;
- publish a support window for the current and previous major result versions;
- add migration-aware readers and fixtures for every supported version;
- define deprecation warnings with replacement and removal release;
- include `apiVersion`, component version, config schema version, and result
  schema version in provenance;
- prohibit plugins from writing arbitrary undeclared fields into core results;
- provide namespaced extension data with size limits.

An incompatible plugin must fail during validation, before cloning or agent
execution.

## 9. Work breakdown

### Milestone 3.1 — Internal registries

Deliver:

- generic component registry and API-version checks;
- built-in adapter/evaluator/hook/reporter registrations;
- orchestrator dependency injection for registries;
- removal of hard-coded component switches;
- conformance tests for each component family.

Acceptance:

- all built-ins work through registries with unchanged CLI behavior;
- duplicate and unknown kinds fail with actionable errors;
- tests can supply an isolated registry without global mutation;
- no experiment result changes solely because of registry extraction.

### Milestone 3.2 — Public plugin API and local loading

Deliver:

- public plugin API entry point;
- manifest schema, resolver, loader, and provenance;
- explicit enablement configuration;
- plugin list/inspect/verify commands;
- example evaluator and reporter plugins in test fixtures;
- plugin author guide and conformance kit.

Acceptance:

- a fixture npm package adds an evaluator and help text without core edits;
- incompatible API versions fail in validation;
- packages outside approved roots and undeclared entry points are rejected;
- exact package/component versions appear in results;
- published package exports support plugin authors on Node 20 and 22.

### Milestone 3.3 — Execution-provider seam

Deliver:

- provider interface and capability model;
- `host-trusted` implementation wrapping current behavior;
- execution-profile schema and provenance;
- scheduler/orchestrator integration without adapter command leakage.

Acceptance:

- existing tests pass through `host-trusted`;
- profile name and effective controls appear in every result;
- unsupported requested controls fail before execution;
- providers receive redacted config and scoped artifact APIs.

### Milestone 3.4 — Container provider

Deliver:

- one OCI runtime implementation;
- immutable-image, mount, network, environment, secret, and resource policy;
- cancellation, timeout, cleanup, and artifact extraction;
- local Git fixture integration suite;
- security threat model and operator guide.

Acceptance:

- the same offline experiment passes under host and container profiles;
- default container execution has no network and no host credential leakage;
- timeout/SIGINT stops the container and leaves resumable experiment state;
- path traversal, symlink escape, oversized artifact, and secret-redaction tests
  pass;
- runtime absence produces actionable `doctor` and validation output.

### Milestone 3.5 — Private repositories and integration plugins

Deliver:

- secret-reference abstraction;
- HTTPS token authentication with redaction and cleanup;
- reference result-storage and notification plugins;
- retry/idempotency contracts for external writes.

Acceptance:

- a private-repository fixture can authenticate without credentials in config,
  process arguments, logs, or results;
- notification retries do not duplicate confirmed sends when an idempotency
  key is supported;
- storage failures are represented separately from evaluation outcomes;
- integrations remain optional and do not affect offline default tests.

### Milestone 3.6 — Compatibility freeze and 1.0 readiness

Deliver:

- versioning/deprecation policy;
- supported schema matrix and migration fixtures;
- API reference and plugin security guidance;
- release and compatibility gates;
- Phase 3 beta feedback resolution.

Acceptance:

- compatibility tests cover the supported version window;
- a third-party component can be developed using only public exports/docs;
- breaking-change detection is part of release review;
- deprecated APIs warn once with actionable migration guidance.

## 10. Verification and security review

### Automated tests

- registry isolation, conflicts, and API negotiation;
- malicious/invalid manifests and package path escapes;
- schema discovery and config error attribution;
- plugin timeout, cancellation, excessive output, and artifact limits;
- container network, mount, environment, secret, resource, and cleanup policy;
- private-repository redaction and redirect handling;
- old result/config/plugin fixtures across supported versions.

### Manual release checks

- threat-model review for plugin loading and container boundaries;
- test on Windows, macOS, and Linux where the selected runtime is supported;
- inspect process lists, logs, results, and artifacts for secret exposure;
- run a real third-party plugin built only against published API exports;
- verify package contents and import paths from a packed tarball.

External runtime and private-service tests should be opt-in, with deterministic
offline contract coverage in the default suite.

## 11. Rollout

1. Extract internal registries without exposing plugins.
2. Publish the plugin API as beta and support only explicitly trusted local
   packages.
3. Introduce `host-trusted` as the explicit default profile with no behavior
   change.
4. Release the container provider as opt-in beta with one supported runtime.
5. Add secret references and private HTTPS repositories after redaction and
   isolation tests pass.
6. Freeze API `1.0` only after at least one external evaluator, reporter, and
   storage integration have exercised the contracts.

Do not market in-process plugins as sandboxed. Do not claim container execution
protects against hostile kernels, privileged runtimes, or misconfigured host
mounts.

## 12. Definition of done

- Built-ins and third-party components use the same versioned registries.
- A third party adds an evaluator and config help without editing core.
- Plugin installation and enablement are explicit and provenance is complete.
- The same experiment runs under `host-trusted` and `container`.
- Container defaults deny network and minimize mounts, environment, and secrets.
- Private repository credentials never enter config artifacts or logs.
- Result and extension APIs have published compatibility and deprecation rules.
- Offline tests, lint, build, package dry run, supported Node/OS CI, and security
  regression suites pass.

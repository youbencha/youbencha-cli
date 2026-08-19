# Secure E2B execution

E2B is an opt-in execution provider for version 2 regression suites. The local
youBencha process remains the trusted control plane: it validates and plans the
suite, owns the E2B API credential, schedules attempts, persists state,
validates downloaded artifacts, compares baselines, and writes reports.

There is no silent fallback. If `e2b` is selected and its policy or template
cannot be enforced, the run fails rather than executing on the host.

## Required setup

1. Build an E2B template containing Linux, Node, Git, the youBencha runner, and
   every target or judge harness required by a cell.
2. Pin the harness versions and disable auto-update where supported.
3. Publish `/opt/youbencha/manifest.json` with the runner protocol,
   immutable build identity, installed harnesses, resources, and artifact
   limits.
4. Set `E2B_API_KEY` only in the local or CI control-plane environment.
5. Declare target/component/phase-scoped model or source secrets in the suite.

Version 2 currently accepts credential-free public HTTPS repositories. URL
credentials, plain HTTP, loopback, link-local, and private literal addresses
are rejected. Private repository checkout remains a production-hardening
milestone; do not embed a token in `repo`.

The [template contract example](../examples/e2b/README.md) includes the
required manifest and fixed runner wrapper.

`E2B_API_KEY` is rejected as either a secret source or in-sandbox environment
name. It is used only by the local SDK.

Each attempt gets one fresh sandbox. The controller invokes only these fixed
commands:

```text
/opt/youbencha/bin/run-cell prepare /work/input/cell.json
/opt/youbencha/bin/run-cell agent /work/input/cell.json
/opt/youbencha/bin/run-cell evaluate /work/input/cell.json
/opt/youbencha/bin/run-cell post-evaluate /work/input/cell.json
/opt/youbencha/bin/run-cell package /work/input/cell.json
```

User-controlled values are written to the validated cell manifest and are not
concatenated into those commands. Residual phase processes are terminated
before the next secret scope is entered.

`yb regress ... --plan` does not require `E2B_API_KEY`. It validates the local
policy and prints every cell's template reference, expected immutable build,
resources, complete target/judge harness capability set, and effective network
allowlist. The resolved template manifest is then checked inside the newly
created sandbox before the agent phase begins.

## Credential boundary

Command-scoped environment values limit accidental exposure but are not a
confidentiality boundary inside the guest. Repository code or a harness in the
same process tree may read them. Use short-lived, least-privilege credentials,
inject only the selected target/component/phase values, and constrain outbound
network access.

The effective egress policy is the fail-closed union of the task source/setup,
target model endpoint, and evaluator requirements. Strict reproducibility
rejects unrestricted egress, a moving template build, harness mismatch, and
runtime package installation. Secured sandbox-controller access and private
inbound traffic are required.

## Lifecycle and recovery

The scheduler persists `creating` before the provider call and the sandbox ID
before mutable work. On restart, matching metadata has deterministic behavior:
zero matches creates, one match adopts, and multiple matches are killed and
reported as an ownership error. Creation rate is bounded independently from
active concurrency.

Sandboxes are killed in a `finally` path after success, evaluation failure,
timeout, cancellation, or collection failure. Pause-on-failure is explicit,
requires a reason and intended expiry, and needs `yb sandbox reap` because
paused E2B sandboxes do not have an automatic retention TTL.

`budget.max_sandbox_runtime_minutes` is a cumulative scheduling budget,
separate from experiment wall time and model cost. Reports expose sandbox
runtime and label sandbox cost `unavailable` unless a future provider surface
supplies an authoritative measurement.

```bash
yb sandbox list [--experiment <id>]
yb sandbox reap [--experiment <id>]
yb sandbox kill <sandbox-id>
```

Cleanup commands filter on youBencha ownership metadata and never bulk-delete
unmanaged sandboxes.

The default test suite uses fake clients. To run the bounded live
create/verify/kill smoke test, set `E2B_LIVE_TESTS=1`, `E2B_API_KEY`, and
`E2B_LIVE_TEMPLATE_ID`, then run:

```bash
npm test -- tests/integration/e2b-live.test.ts --runInBand
```

## Artifacts and snapshots

The sandbox packages a bounded manifest and archive. The control plane rejects
undeclared files, absolute/traversing/case-colliding paths, links, ownership
mismatches, size-limit violations, hash mismatches, and an invalid result
schema before materializing files below the attempt directory.

Artifact hashes prove transfer completeness, not that an untrusted sandbox
reported truthfully.

The library contains fail-closed eligibility and cache-identity rules for
future fixture snapshots. The CLI does not yet create or reuse snapshots:
`fixture_cache.mode: snapshot` is rejected during planning. Use `mode: none`;
every attempt then starts from the declared immutable template. This avoids
claiming setup reuse before secret-free setup, residual-process attestation,
snapshot reconciliation, and deletion are implemented together.

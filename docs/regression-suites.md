# Regression suites

Version 2 suites separate the work to perform from the model and coding harness
being tested. A task owns the repository, prompt, setup, and evaluators. A
target owns the agent adapter, requested model, exact harness version, and
remote runtime policy. This makes a model retirement a target change instead
of a rewrite of every test case.

Start with
[the regression suite example](../examples/regression/suite.yaml):

```bash
# Inspect one case × one target without executing anything
yb regress examples/regression/suite.yaml --profile smoke --plan

# Run the smoke profile
yb regress examples/regression/suite.yaml --profile smoke

# Narrow a larger profile; --target and --case are repeatable
yb regress examples/regression/suite.yaml \
  --profile overlap \
  --target candidate \
  --case fix-auth \
  --repetitions 1

# Resume only when the suite, profile, filters, provider, and repetitions match
yb regress examples/regression/suite.yaml --profile nightly \
  --resume <experiment-id>
```

CLI filters can narrow a profile but cannot broaden it. Profile, filter,
provider, and repetition selections are part of the definition hash, so a
different selection cannot silently reuse a prior run.

For E2B suites, `--plan` also prints the cell-to-template/build mapping,
expected resources, complete target and judge harness capabilities, and the
effective outbound network policy without contacting E2B.

## Swap a model or harness

Add or edit one target:

```yaml
targets:
  - id: candidate
    agent:
      type: codex-cli
      model: replacement-model
      config:
        reasoning_effort: high
    harness:
      exact_version: '1.2.3'
```

Task files do not contain the system-under-test agent. When planning, youBencha
constructs a fresh adapter configuration from the selected task and target. It
does not merge adapter-specific options from another harness.

For a retirement, run an overlap profile containing both the incumbent and
candidate before the old model disappears. Targets are interleaved
deterministically. Regression comparisons can map the differently named
candidate to the incumbent from that current run or from a persisted baseline.
Only target and testcase-target aggregates are compared; experiment-wide
aggregates are intentionally excluded.

Rules must declare `minimum_samples`. Insufficient samples are `partial` by
default and can be configured as `fail`. Use a smoke profile with no
multi-sample rule when one quick execution is intended.

Version 2 task repositories must be credential-free public HTTPS URLs.
Private-repository credentials must not be embedded in a task definition.

## Promote a replacement

Every promotion creates an immutable, content-addressed snapshot and advances
an audited local channel:

```bash
yb baseline promote <experiment-id> \
  --channel production \
  --target candidate

yb baseline show production
```

In CI, use `--expect <current-digest>` as a compare-and-swap precondition. A
concurrent promotion then fails instead of overwriting the winner. Channel
history records the prior and new digest/target, timestamp, source experiment,
mapping, and optional actor/context.

The local store is under `results/baselines/`. CI jobs must restore or download
that directory before comparison and publish the updated objects/channel
records after an approved promotion. Local hash chains detect corruption; they
are not a substitute for trusted artifact storage or signatures.

## Exit codes

The regression command uses the existing experiment codes:

| Code | Meaning |
| ---: | --- |
| 0 | execution and selected regression rules passed |
| 1 | configuration, provider, or infrastructure failure |
| 2 | evaluator or regression rule failed |
| 3 | incomplete/partial result, including insufficient comparison data |

See [Secure E2B execution](./e2b-execution.md) for remote provider setup and
the precise credential boundary.

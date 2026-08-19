# E2B runner template inputs

These files illustrate the contract expected by the E2B execution provider.
They are not a prebuilt universal template: each production template must pin
the coding harnesses it advertises.

The image must:

1. install Node.js, Git, `tar` with zstd support, youBencha, and the exact
   target/judge harness versions;
2. copy `run-cell` to `/opt/youbencha/bin/run-cell` and make it executable;
3. copy a completed `manifest.json` to `/opt/youbencha/manifest.json`;
4. run as an unprivileged user;
5. expose no public service and contain no credentials; and
6. disable harness auto-update and runtime package installation.

The manifest's template/build IDs, resources, runner protocol, artifact
limits, harness versions, and adapter schema versions are validated before any
agent phase starts. A friendly tag may select a template, but strict mode also
requires and records its immutable build ID.

# Publishing Guide

This guide describes how maintainers release youBencha to NPM. The recommended
path is a GitHub release followed by the automated, protected publish workflow.
The interactive scripts remain available as a manual fallback.

## Recommended Release Flow

```text
Pull request -> required CI checks -> merge to main
             -> version bump -> GitHub release
             -> protected GitHub Actions job -> NPM
```

The CI workflow tests supported Node.js versions on Windows, Linux, and macOS.
When a GitHub release is published, the NPM workflow:

1. Checks out the release tag.
2. Verifies that the tagged commit belongs to `main`.
3. Verifies that the tag is exactly `v<package.json version>`;
4. Installs locked dependencies;
5. Runs lint, tests, build, and a package dry run;
6. Refuses to overwrite an existing NPM version;
7. Selects `latest` for stable versions and an appropriate prerelease tag;
8. Publishes through NPM Trusted Publishing with provenance.

## One-Time Repository Setup

### Configure NPM Trusted Publishing

The `youbencha` package must already exist on NPM before a trusted publisher can
be configured.

1. Open the `youbencha` package on
   [npmjs.com](https://www.npmjs.com/package/youbencha).
2. Open **Settings** and find **Trusted Publisher**.
3. Select **GitHub Actions** and enter:
   - Organization or user: `youbencha`
   - Repository: `youbencha-cli`
   - Workflow filename: `publish.yml`
   - Environment: `npm`
   - Allowed action: `npm publish`
4. Save the trusted publisher.
5. After a successful OIDC publish, revoke the old NPM automation token and
   remove the repository secret named `NPM_TOKEN`, if either exists.

The field values are case-sensitive. The workflow uses a GitHub-hosted runner,
Node.js 24, and `id-token: write`, as required for OIDC publishing. Trusted
Publishing creates provenance automatically for public packages published from
public repositories.

### Create the GitHub Environment

In the GitHub repository, open **Settings**, **Environments**, and create an
environment named `npm`.

Recommended protection rules:

- require a maintainer to approve deployments;
- prevent self-review when the project has multiple maintainers;
- restrict deployment tags to `v*`;
- disallow administrators from bypassing protection when practical.

The environment name must exactly match both `publish.yml` and the trusted
publisher configuration on NPM.

### Protect `main`

Configure a GitHub ruleset or branch protection rule for `main` that:

- requires pull requests;
- requires the relevant CI jobs from `.github/workflows/test.yml`;
- requires at least one approval;
- blocks force pushes and branch deletion;
- prevents direct release commits from bypassing CI.

No publishing secret is required. `GITHUB_TOKEN` is provided automatically by
GitHub, and `CODECOV_TOKEN` remains optional for coverage uploads.

## Publishing a Release

### 1. Choose a Unique Version

Check both NPM and Git before choosing a version:

```bash
npm view youbencha versions --json
git tag --list "v*"
```

Versions already published to NPM cannot be reused. Existing Git tags also must
not be moved or overwritten.

### 2. Update the Version

For a stable release:

```bash
npm version patch --no-git-tag-version
```

For a prerelease:

```bash
npm version 0.2.0-beta.1 --no-git-tag-version
```

Commit both `package.json` and `package-lock.json` through a pull request. Update
public documentation and examples when behavior changes.

### 3. Publish the GitHub Release

1. Wait for the version pull request to pass CI and merge to `main`.
2. Draft a GitHub release from the merged commit.
3. Create a tag exactly matching `v<package version>`, for example
   `v0.2.0-beta.1`.
4. Mark beta, alpha, or release-candidate versions as prereleases.
5. Review the release notes and publish the GitHub release.
6. Approve the `npm` environment deployment when GitHub requests approval.

Publishing the GitHub release automatically starts `.github/workflows/publish.yml`.
There is intentionally no arbitrary branch or manual-dispatch publish path.

## NPM Distribution Tags

Stable versions publish under `latest`. Recognized prerelease identifiers map to
matching NPM distribution tags:

| Package version       | NPM tag  |
| --------------------- | -------- |
| `1.0.0`               | `latest` |
| `1.1.0-alpha.1`       | `alpha`  |
| `1.1.0-beta.1`        | `beta`   |
| `1.1.0-rc.1`          | `rc`     |
| `1.1.0-next.1`        | `next`   |
| other prerelease form | `next`   |

This prevents an unstable release from replacing the version installed by
`npm install youbencha` without an explicit tag.

## Release Gates

The workflow runs:

```bash
npm ci
npm run verify:release
```

`verify:release` runs lint, the test suite, the build, and `npm pack --dry-run`.
The package build must include
`dist/evaluators/prompts/agentic-judge.template.md`.

Before publishing a release, maintainers can run the same checks locally:

```bash
npm run verify:release
```

To inspect and smoke-test the exact package:

```bash
npm pack
npm install -g ./youbencha-<version>.tgz
yb --version
```

Do not commit the generated tarball.

## Post-Publication Verification

After the workflow succeeds:

```bash
npm view youbencha@<version> version
npm view youbencha dist-tags
npm install -g youbencha@<version>
yb --version
```

Also confirm that:

- the package page shows provenance;
- the intended NPM distribution tag points to the new version;
- the GitHub release links to the correct immutable tag;
- the CLI starts successfully from a clean installation.

## Manual Fallback

The scripts under `scripts/` perform an interactive local publish. They require
an authenticated NPM maintainer, a clean `main` branch, and explicit
confirmation:

```bash
./scripts/publish.sh
```

Use the fallback only when the GitHub Actions route is unavailable. It does not
receive the protected GitHub environment or short-lived OIDC credentials.

## Troubleshooting

### `ENEEDAUTH` during the GitHub workflow

Confirm that all trusted-publisher values match exactly:

- organization `youbencha`;
- repository `youbencha-cli`;
- workflow filename `publish.yml`;
- environment `npm`;
- allowed action `npm publish`.

Also confirm that the job has `id-token: write` and uses a GitHub-hosted runner.

### Release tag does not match package version

The release tag must include the `v` prefix and otherwise exactly match
`package.json`. For version `0.2.0-beta.1`, use `v0.2.0-beta.1`.

Do not move the incorrect tag. Delete an unpublished draft release and create a
new unique tag from the intended commit.

### Version already exists

Choose a new version, update both package files, pass CI, and create a new
release. NPM package versions are immutable.

### Release gates fail

Do not bypass them. Reproduce the failure from the tagged commit with:

```bash
npm ci
npm run verify:release
```

Fix the issue through a pull request and publish a new release tag.

## References

- [NPM Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [NPM publish](https://docs.npmjs.com/cli/publish/)
- [NPM distribution tags](https://docs.npmjs.com/adding-dist-tags-to-packages/)
- [GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [GitHub Actions for Node.js](https://docs.github.com/en/actions/automating-builds-and-tests/building-and-testing-nodejs)

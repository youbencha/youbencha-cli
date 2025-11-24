# Publishing Scripts

This directory contains scripts to help with the release and publishing process for youBencha.

## publish.sh

Interactive script to publish new versions of youBencha to NPM.

### Prerequisites

Before running the publish script, ensure:

1. You are on the `main` branch
2. Your working directory is clean (no uncommitted changes)
3. You are logged in to NPM: `npm login`
4. You have push access to the GitHub repository
5. All tests pass: `npm test`

### Usage

```bash
./scripts/publish.sh
```

The script will:

1. ✅ Verify you're on the main branch
2. ✅ Check your working directory is clean
3. ✅ Pull the latest changes
4. ✅ Verify NPM authentication
5. ✅ Prompt for version bump type (patch/minor/major/custom)
6. ✅ Run tests and linting
7. ✅ Build the project
8. ✅ Show package contents preview
9. ✅ Bump the version in package.json
10. ✅ Ask for final confirmation
11. ✅ Publish to NPM with provenance
12. ✅ Create and push git tag
13. ✅ Push changes to GitHub

### Version Bumping

- **Patch** (0.1.0 → 0.1.1): Bug fixes, no new features
- **Minor** (0.1.0 → 0.2.0): New features, backward compatible
- **Major** (0.1.0 → 1.0.0): Breaking changes
- **Custom**: Specify any version (e.g., 1.0.0-beta.1)

### Safety Features

- Pre-flight checks ensure clean working state
- Tests and linting must pass before publishing
- Final confirmation required before publishing
- Instructions provided to rollback if cancelled

### Canceling

If you cancel after version bump but before publishing:

```bash
# Undo the version bump
git reset --hard HEAD~1
git tag -d v<VERSION>
```

## Automated Publishing via GitHub Actions

For automated releases, use the GitHub Actions workflow instead of the manual script:

1. Create a new release on GitHub
2. The workflow will automatically publish to NPM

See `.github/workflows/publish.yml` for details.

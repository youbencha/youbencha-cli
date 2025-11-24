# Publishing Guide

This guide describes how to publish new versions of youBencha to NPM.

## Quick Start

There are two ways to publish youBencha:

1. **Manual**: Using the interactive publish script (recommended for maintainers)
2. **Automated**: Via GitHub Actions when creating releases

## Method 1: Manual Publishing (Recommended)

### Prerequisites

1. **NPM Account**: Ensure you have an NPM account with publish access
2. **NPM Authentication**: Login to NPM
   ```bash
   npm login
   ```
3. **Repository Access**: You must have push access to the repository
4. **Clean State**: Ensure your working directory is clean and on `main` branch

### Steps

1. **Run the publish script:**
   ```bash
   ./scripts/publish.sh
   ```

2. **Follow the prompts:**
   - Choose version bump type (patch/minor/major/custom)
   - Review package contents
   - Confirm final publish

The script will:
- ✅ Verify prerequisites
- ✅ Run all tests and linting
- ✅ Build the project
- ✅ Bump version and create git tag
- ✅ Publish to NPM with provenance
- ✅ Push to GitHub

### Version Strategy

Follow [Semantic Versioning](https://semver.org/):

- **Patch** (0.1.0 → 0.1.1): Bug fixes only
  - Example: Fix crash in git-diff evaluator
- **Minor** (0.1.0 → 0.2.0): New features, backward compatible
  - Example: Add new evaluator type
- **Major** (0.1.0 → 1.0.0): Breaking changes
  - Example: Change CLI command structure

### Pre-release Versions

For beta/alpha releases, use custom version:

```bash
# When prompted, select "custom version"
# Enter: 1.0.0-beta.1
```

## Method 2: Automated Publishing via GitHub Actions

### Setup (One-time)

1. **Create NPM Access Token:**
   - Go to [npmjs.com](https://www.npmjs.com/) → Account Settings → Access Tokens
   - Create new token with "Automation" type
   - Copy the token

2. **Add Token to GitHub:**
   - Go to Repository Settings → Secrets and variables → Actions
   - Create new secret named `NPM_TOKEN`
   - Paste your NPM access token

### Publishing a Release

#### Option A: Create a Release (Automatic Publish)

1. Go to GitHub repository → Releases → "Draft a new release"
2. Create a new tag (e.g., `v0.2.0`)
3. Add release title and description
4. Click "Publish release"

The GitHub Action will:
- ✅ Automatically run tests and build
- ✅ Publish to NPM with provenance
- ✅ Create release notes

#### Option B: Manual Workflow Trigger

1. Go to Actions → "Publish to NPM"
2. Click "Run workflow"
3. Select branch and optionally specify version
4. Click "Run workflow"

## Post-Publication Checklist

After publishing, verify:

- [ ] Package appears on NPM: https://www.npmjs.com/package/youbencha
- [ ] Installation works: `npm install -g youbencha@<version>`
- [ ] CLI commands work: `yb --version`
- [ ] GitHub release created with correct tag
- [ ] Documentation is up-to-date

## Package Contents

The published package includes:

- ✅ `dist/` - Compiled JavaScript and type definitions
- ✅ `examples/` - Example configurations
- ✅ `README.md` - Main documentation
- ✅ `GETTING-STARTED.md` - Getting started guide
- ✅ `LICENSE` - MIT license

Excluded from package:

- ❌ Source TypeScript files (`src/`)
- ❌ Tests (`tests/`)
- ❌ Development configuration files
- ❌ Internal documentation
- ❌ GitHub workflows and templates

## Troubleshooting

### "Not logged in to NPM"

```bash
npm login
# Enter your NPM credentials
```

### "Version already exists"

If you've already published a version:

```bash
# Bump to next version
npm version patch  # or minor, or major
# Then try publishing again
```

### "Working directory not clean"

Commit or stash your changes:

```bash
git status
git add .
git commit -m "Your message"
# Or
git stash
```

### "Tests failing"

Fix the tests before publishing:

```bash
npm test
# Fix any failing tests
# Commit fixes
```

### Rollback a Published Version

**⚠️ Warning**: You cannot unpublish versions that are older than 72 hours.

Within 72 hours:

```bash
npm unpublish youbencha@<version>
```

After 72 hours, you must publish a new fixed version:

```bash
npm version patch
./scripts/publish.sh
```

## CI/CD Configuration

### Workflows

Two GitHub Actions workflows are configured:

1. **`.github/workflows/test.yml`** - CI testing
   - Runs on: Push to `main`, Pull Requests
   - Tests: Multiple Node versions (20.x, 22.x)
   - Platforms: Ubuntu, macOS, Windows
   - Checks: Tests, Linting, Build, Package contents

2. **`.github/workflows/publish.yml`** - NPM publishing
   - Runs on: Release creation, Manual trigger
   - Publishes with provenance (supply chain security)
   - Creates GitHub releases automatically
   - Checks for duplicate versions

### Required Secrets

- `NPM_TOKEN` - NPM automation token for publishing
- `GITHUB_TOKEN` - Automatically provided by GitHub Actions
- `CODECOV_TOKEN` (Optional) - For uploading code coverage reports to Codecov

## Best Practices

1. **Always run tests before publishing**
   ```bash
   npm test
   npm run lint
   npm run build
   ```

2. **Review package contents**
   ```bash
   npm pack --dry-run
   ```

3. **Test installation locally**
   ```bash
   npm pack
   npm install -g ./youbencha-<version>.tgz
   yb --version
   ```

4. **Update documentation** before publishing
   - Update README if APIs changed
   - Update GETTING-STARTED if workflow changed
   - Update CHANGELOG (if maintaining one)

5. **Use conventional commits** for better release notes
   ```bash
   git commit -m "feat: add new evaluator"
   git commit -m "fix: resolve git-diff issue"
   git commit -m "docs: update README"
   ```

6. **Publish during low-usage hours** to minimize impact if issues arise

## Security

### Provenance

Published packages include provenance attestation, providing:

- 🔐 Cryptographic proof of package origin
- 🔐 Tamper detection
- 🔐 Build environment transparency

Verify provenance:

```bash
npm view youbencha@<version> --json
```

### Supply Chain Security

- All dependencies are locked in `package-lock.json`
- Tests run in isolated environments
- No secrets exposed in logs
- Minimal permissions for GitHub Actions

## Support

For issues with publishing:

1. Check GitHub Actions logs for error details
2. Review [NPM Publishing Documentation](https://docs.npmjs.com/cli/v10/commands/npm-publish)
3. Open an issue in the repository

## References

- [Semantic Versioning](https://semver.org/)
- [NPM Publishing Guide](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages)
- [GitHub Actions for Node.js](https://docs.github.com/en/actions/automating-builds-and-tests/building-and-testing-nodejs)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements)

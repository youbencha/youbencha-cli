#!/usr/bin/env pwsh
#Requires -Version 7.0

param(
    [switch]$Help
)

if ($Help) {
    Write-Host "youBencha NPM Publishing Script"
    Write-Host "Usage: .\publish.ps1"
    exit 0
}

# Set error action preference
$ErrorActionPreference = "Stop"

# Colors for output
function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    Write-Host $Message -ForegroundColor $Color
}

Write-ColorOutput "youBencha NPM Publishing Script" "Green"
Write-Host "=================================="
Write-Host ""

# Check if we're on main branch
Write-ColorOutput "Checking Git branch..." "Yellow"
$branch = git rev-parse --abbrev-ref HEAD
if ($branch -ne "main") {
    Write-ColorOutput "Error: You must be on the main branch to publish" "Red"
    Write-Host "Current branch: $branch"
    exit 1
}

# Check if working directory is clean
Write-ColorOutput "Checking working directory..." "Yellow"
$status = git status --porcelain
if ($status) {
    Write-ColorOutput "Error: Working directory is not clean" "Red"
    Write-Host "Please commit or stash your changes before publishing"
    git status --short
    exit 1
}

# Pull latest changes
Write-ColorOutput "Pulling latest changes..." "Yellow"
git pull origin main

# Check NPM authentication
Write-ColorOutput "Checking NPM authentication..." "Yellow"
$npmUser = $null
try {
    $npmUser = npm whoami 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Not authenticated"
    }
} catch {
    Write-ColorOutput "Error: Not logged in to NPM" "Red"
    Write-Host "Please run: npm login"
    exit 1
}

Write-ColorOutput "Logged in as: $npmUser" "Green"

# Get current version from package.json
$packageJson = Get-Content -Path "package.json" -Raw | ConvertFrom-Json
$currentVersion = $packageJson.version
Write-Host ""
Write-Host "Current version: $currentVersion"

# Ask for version bump type
Write-Host ""
Write-Host "Select version bump type:"
Write-Host "  1) patch (bug fixes - 0.1.0 -> 0.1.1)"
Write-Host "  2) minor (new features - 0.1.0 -> 0.2.0)"
Write-Host "  3) major (breaking changes - 0.1.0 -> 1.0.0)"
Write-Host "  4) custom version"
Write-Host ""
$versionChoice = Read-Host "Enter choice [1-4]"

$versionType = switch ($versionChoice) {
    "1" { "patch" }
    "2" { "minor" }
    "3" { "major" }
    "4" {
        $customVersion = Read-Host "Enter custom version (e.g., 1.0.0)"
        $customVersion
    }
    default {
        Write-ColorOutput "Invalid choice" "Red"
        exit 1
    }
}

# Run tests and build
# Write-Host ""
# Write-ColorOutput "Running tests..." "Yellow"
# npm test
# if ($LASTEXITCODE -ne 0) {
#     Write-ColorOutput "Tests failed" "Red"
#     exit 1
# }

# Write-Host ""
# Write-ColorOutput "Running linter..." "Yellow"
# npm run lint
# if ($LASTEXITCODE -ne 0) {
#     Write-ColorOutput "Linter failed" "Red"
#     exit 1
# }

Write-Host ""
Write-ColorOutput "Building project..." "Yellow"
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-ColorOutput "Build failed" "Red"
    exit 1
}

# Verify package contents
Write-Host ""
Write-ColorOutput "Verifying package contents..." "Yellow"
npm pack --dry-run

# Bump version
Write-Host ""
if ($versionChoice -eq "4") {
    Write-ColorOutput "Setting version to $versionType..." "Yellow"
} else {
    Write-ColorOutput "Bumping version ($versionType)..." "Yellow"
}

npm version $versionType --no-git-tag-version
if ($LASTEXITCODE -ne 0) {
    Write-ColorOutput "Version bump failed" "Red"
    exit 1
}

$packageJson = Get-Content -Path "package.json" -Raw | ConvertFrom-Json
$newVersion = $packageJson.version
Write-ColorOutput "New version: $newVersion" "Green"

# Commit version bump
Write-Host ""
Write-ColorOutput "Committing version bump..." "Yellow"
git add package.json
git commit -m "chore: bump version to $newVersion"
git tag "v$newVersion"

# Final confirmation
Write-Host ""
Write-ColorOutput "Ready to publish version $newVersion" "Yellow"
$confirmation = Read-Host "Continue? [y/N]"
if ($confirmation -notmatch "^[Yy]$") {
    Write-ColorOutput "Publishing cancelled" "Red"
    Write-Host "To undo version bump:"
    Write-Host "  git reset --hard HEAD~1"
    Write-Host "  git tag -d v$newVersion"
    exit 1
}

# Publish to NPM
Write-Host ""
Write-ColorOutput "Publishing to NPM..." "Yellow"
npm publish --access public
if ($LASTEXITCODE -ne 0) {
    Write-ColorOutput "Publishing failed" "Red"
    exit 1
}

# Push to GitHub
Write-Host ""
Write-ColorOutput "Pushing to GitHub..." "Yellow"
git push origin main
git push origin "v$newVersion"

Write-Host ""
Write-ColorOutput "✓ Successfully published version $newVersion" "Green"
Write-Host ""
Write-Host "View on NPM: https://www.npmjs.com/package/youbencha"
Write-Host "View release: https://github.com/youbencha/youbencha-cli/releases/tag/v$newVersion"

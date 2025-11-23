#!/usr/bin/env bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}youBencha NPM Publishing Script${NC}"
echo "=================================="
echo ""

# Check if we're on main branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo -e "${RED}Error: You must be on the main branch to publish${NC}"
  echo "Current branch: $BRANCH"
  exit 1
fi

# Check if working directory is clean
if [ -n "$(git status --porcelain)" ]; then
  echo -e "${RED}Error: Working directory is not clean${NC}"
  echo "Please commit or stash your changes before publishing"
  git status --short
  exit 1
fi

# Pull latest changes
echo -e "${YELLOW}Pulling latest changes...${NC}"
git pull origin main

# Check NPM authentication
echo -e "${YELLOW}Checking NPM authentication...${NC}"
if ! npm whoami &> /dev/null; then
  echo -e "${RED}Error: Not logged in to NPM${NC}"
  echo "Please run: npm login"
  exit 1
fi

NPM_USER=$(npm whoami)
echo -e "${GREEN}Logged in as: $NPM_USER${NC}"

# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo ""
echo "Current version: $CURRENT_VERSION"

# Ask for version bump type
echo ""
echo "Select version bump type:"
echo "  1) patch (bug fixes - 0.1.0 -> 0.1.1)"
echo "  2) minor (new features - 0.1.0 -> 0.2.0)"
echo "  3) major (breaking changes - 0.1.0 -> 1.0.0)"
echo "  4) custom version"
echo ""
read -p "Enter choice [1-4]: " VERSION_CHOICE

case $VERSION_CHOICE in
  1)
    VERSION_TYPE="patch"
    ;;
  2)
    VERSION_TYPE="minor"
    ;;
  3)
    VERSION_TYPE="major"
    ;;
  4)
    read -p "Enter custom version (e.g., 1.0.0): " CUSTOM_VERSION
    VERSION_TYPE="$CUSTOM_VERSION"
    ;;
  *)
    echo -e "${RED}Invalid choice${NC}"
    exit 1
    ;;
esac

# Run tests and build
echo ""
echo -e "${YELLOW}Running tests...${NC}"
npm test

echo ""
echo -e "${YELLOW}Running linter...${NC}"
npm run lint

echo ""
echo -e "${YELLOW}Building project...${NC}"
npm run build

# Verify package contents
echo ""
echo -e "${YELLOW}Verifying package contents...${NC}"
npm pack --dry-run

# Bump version
echo ""
if [ "$VERSION_CHOICE" = "4" ]; then
  echo -e "${YELLOW}Setting version to $VERSION_TYPE...${NC}"
  npm version $VERSION_TYPE --no-git-tag-version
else
  echo -e "${YELLOW}Bumping version ($VERSION_TYPE)...${NC}"
  npm version $VERSION_TYPE --no-git-tag-version
fi

NEW_VERSION=$(node -p "require('./package.json').version")
echo -e "${GREEN}New version: $NEW_VERSION${NC}"

# Commit version bump
echo ""
echo -e "${YELLOW}Committing version bump...${NC}"
git add package.json
git commit -m "chore: bump version to $NEW_VERSION"
git tag "v$NEW_VERSION"

# Final confirmation
echo ""
echo -e "${YELLOW}Ready to publish version $NEW_VERSION${NC}"
read -p "Continue? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${RED}Publishing cancelled${NC}"
  echo "To undo version bump:"
  echo "  git reset --hard HEAD~1"
  echo "  git tag -d v$NEW_VERSION"
  exit 1
fi

# Publish to NPM
echo ""
echo -e "${YELLOW}Publishing to NPM...${NC}"
npm publish --access public

# Push to GitHub
echo ""
echo -e "${YELLOW}Pushing to GitHub...${NC}"
git push origin main
git push origin "v$NEW_VERSION"

echo ""
echo -e "${GREEN}✓ Successfully published version $NEW_VERSION${NC}"
echo ""
echo "View on NPM: https://www.npmjs.com/package/youbencha"
echo "View release: https://github.com/youbencha/youbencha-cli/releases/tag/v$NEW_VERSION"

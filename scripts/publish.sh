#!/bin/bash
set -euf -o pipefail

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  exit 1
fi

# Step 1: Bump version for all packages
echo "Setting version to $VERSION..."
yarn workspaces foreach -A -t version $VERSION

# Step 2: Commit the version changes
git add .
git commit -m "chore: release version $VERSION"
git commit --allow-empty -m "chore: release $VERSION" -m "Release-As: $VERSION"
git push
git push --tags -f

# Step 3: Publish packages
echo "Publishing packages..."
yarn workspaces foreach -A -t --include actor-core --include @actor-core/cloudflare-workers --include @actor-core/rivet --include @actor-core/bun --include @actor-core/nodejs npm publish --access public --tolerate-republish

echo "✅ Published specified packages at version $VERSION"
echo "⚠️Make sure to merge Release Please"


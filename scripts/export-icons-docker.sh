#!/bin/sh
set -eu

# Run from the checkout root so both the build context and output mount are local.
docker build -f scripts/icons.Dockerfile -t txcode-icon-export:local .
exec docker run --rm --network none -v "$PWD:/repo" txcode-icon-export:local "$@"

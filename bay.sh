#!/bin/sh
exec node --disable-warning=ExperimentalWarning "$(dirname "$0")/bay/cli.ts" "$@"

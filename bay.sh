#!/bin/sh
# Kit entrypoint. Usage: ./bay.sh build [--project /path/to/repo]
exec python3 "$(cd "$(dirname "$0")" && pwd)/bay/cli.py" "$@"

#!/bin/sh
set -e

/docker-entrypoint.d/40-ssl-init.sh

/usr/local/bin/reload-watcher.sh &

exec nginx -g "daemon off;"

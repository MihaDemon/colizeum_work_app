#!/bin/sh
set -eu
# Explicitly refresh existing volumes on rebuild; Docker only auto-populates new ones.
find /usr/share/nginx/html -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a /opt/frontend/. /usr/share/nginx/html/

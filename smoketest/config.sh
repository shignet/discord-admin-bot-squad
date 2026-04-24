#!/bin/bash
# Smoketest fixture — mirrors the expected shape of the real config.sh

export SQUAD_PORT=7787
export DSG_MOD_LIST="3193475024 3193475888 3193475999"
export LOG_DIR="/var/log/squad"

echo "Starting $SQUAD_INSTANCE"

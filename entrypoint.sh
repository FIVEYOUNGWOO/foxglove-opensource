#!/bin/sh
# Optionally override the default layout with one provided via bind mount
mkdir -p /foxglove
touch /foxglove/default-layout.json
index_html=$(cat index.html)
replace_pattern='/*FOXGLOVE_STUDIO_DEFAULT_LAYOUT_PLACEHOLDER*/'
replace_value=$(cat /foxglove/default-layout.json)
echo "${index_html/"$replace_pattern"/$replace_value}" > index.html

# Continue executing the CMD
exec "$@"

# Build stage -
# We have to upgrade node.js version 16 to 18.
# But some dependencies are not compatible with node.js 16v, and use it at least 14v.
FROM node:16 as build
WORKDIR /src

COPY . ./

# RUN corepack enable
# Upgrade to adapt stable yarn verison.
RUN corepack enable && corepack prepare yarn@stable --activate
RUN yarn install --immutable

RUN yarn run web:build:prod

# Release stage
FROM caddy:2.5.2-alpine
WORKDIR /src
COPY --from=build /src/web/.webpack ./

EXPOSE 8080

COPY <<EOF /entrypoint.sh
# Optionally override the default layout with one provided via bind mount
mkdir -p /foxglove
touch /foxglove/default-layout.json
index_html=\$(cat index.html)
replace_pattern='/*FOXGLOVE_STUDIO_DEFAULT_LAYOUT_PLACEHOLDER*/'
replace_value=\$(cat /foxglove/default-layout.json)
echo "\${index_html/"\$replace_pattern"/\$replace_value}" > index.html

# Continue executing the CMD
exec "\$@"
EOF

ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
CMD ["caddy", "file-server", "--listen", ":8080"]

# Build stage -
# We have to upgrade node.js version at least 16.
#WORKDIR /src
FROM node:16 as build
WORKDIR /foxglove-opensource
COPY . ./

# Upgrade to adapt stable yarn verison.
# The original foxglove-stduio applies yarn v3.6.3 version.
# However, Ubuntu 20.04 PC default corepack version is 0.10.0, which does not support yarn v3.6.3.
# RUN corepack enable && corepack prepare yarn@3.6.3 --activate
RUN corepack enable

# Install git lfs (large file storage) to pull large files.
RUN lfs install --force
RUN lfs fetch --all
RUN lfs checkout

# Prevent yarn install --immutable installation errors.
RUN sudo rm -rf .yarn/cache
RUN sudo yarn install --check-cache
RUN sudo yarn up comlink

RUN yarn install --immutable
RUN yarn run web:build:prod


# Release stage
# WORKDIR /src
# COPY --from=build /src/web/.webpack ./
FROM caddy:2.5.2-alpine
WORKDIR /foxglove-opensource
COPY --from=build /foxglove-opensource/web/.webpack ./

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

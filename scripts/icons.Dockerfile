FROM node:24.13.1-bookworm-slim
WORKDIR /tool
RUN npm install --no-audit --no-fund --save-exact sharp@0.35.4 && npm pkg set type=module
COPY scripts/export-portable-icons.ts scripts/export-portable-icons.ts
COPY scripts/lib/brand-assets.ts scripts/lib/brand-icon-variants.ts scripts/lib/icon-export.ts scripts/lib/
WORKDIR /repo
ENTRYPOINT ["node", "/tool/scripts/export-portable-icons.ts"]

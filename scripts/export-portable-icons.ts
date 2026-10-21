#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Standalone Docker exporter depends only on Sharp and Node built-ins.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import sharp from "sharp";

import { ICON_VARIANTS } from "./lib/brand-icon-variants.ts";
import { resolveWebIconOverrides } from "./lib/brand-assets.ts";
import { encodePngIco, WINDOWS_ICON_SIZES } from "./lib/icon-export.ts";

interface IconProject {
  groups: {
    layers: {
      "image-name": string;
      hidden?: boolean;
      opacity?: number;
      position?: { scale?: number; "translation-in-points"?: [number, number] };
    }[];
  }[];
}

const root = process.cwd();
const check = process.argv.includes("--check");
const generated = new Map<string, Buffer>();
const svg = (body: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${body}</svg>`,
  );

// Interpret layer placement from the shared projects. Glass/material effects belong
// to Apple's renderer; this portable rendition uses the original flat SVG artwork.
async function renderArtwork(source: string) {
  const project: IconProject = JSON.parse(
    await NodeFSP.readFile(NodePath.resolve(root, source, "icon.json"), "utf8"),
  );
  const layers: string[] = ['<rect width="1024" height="1024" fill="black"/>'];
  for (const group of project.groups.toReversed()) {
    for (const layer of group.layers.toReversed()) {
      if (layer.hidden) continue;
      const image = await NodeFSP.readFile(
        NodePath.resolve(root, source, "Assets", layer["image-name"]),
        "utf8",
      );
      const dimensions = image.match(/viewBox="[^"]*?([\d.]+) ([\d.]+)"/);
      if (!dimensions) throw new Error(`Missing SVG viewBox: ${layer["image-name"]}`);
      const scale = layer.position?.scale ?? 1;
      const width = Number(dimensions[1]) * scale;
      const height = Number(dimensions[2]) * scale;
      const [dx, dy] = layer.position?.["translation-in-points"] ?? [0, 0];
      const data = Buffer.from(image).toString("base64");
      layers.push(
        `<image href="data:image/svg+xml;base64,${data}" x="${512 + dx - width / 2}" y="${512 + dy - height / 2}" width="${width}" height="${height}" opacity="${layer.opacity ?? 1}"/>`,
      );
    }
  }
  return svg(layers.join(""));
}

for (const variant of ICON_VARIANTS) {
  const artwork = await renderArtwork(variant.source);
  const data = artwork.toString("base64");
  const rounded = svg(
    `<defs><clipPath id="body"><rect width="1024" height="1024" rx="224"/></clipPath></defs><image href="data:image/svg+xml;base64,${data}" width="1024" height="1024" clip-path="url(#body)"/>`,
  );
  const macos = svg(
    `<defs><clipPath id="body"><rect x="100" y="100" width="824" height="824" rx="180"/></clipPath><filter id="shadow" x="-25%" y="-25%" width="150%" height="160%"><feGaussianBlur stdDeviation="12"/></filter></defs><rect x="100" y="112" width="824" height="824" rx="180" fill="black" opacity="0.28" filter="url(#shadow)"/><image href="data:image/svg+xml;base64,${data}" x="100" y="100" width="824" height="824" clip-path="url(#body)"/>`,
  );
  const render = (input: Buffer, size: number) => sharp(input).resize(size, size).png().toBuffer();
  const outputs = variant.outputs;
  // iOS applies its own silhouette and requires an opaque App Store fallback.
  generated.set(outputs.ios, await sharp(artwork).removeAlpha().png().toBuffer());
  generated.set(outputs.macos, await render(macos, 1024));
  for (const [target, size] of [
    [outputs.universal, 1024],
    [outputs.appleTouch, 180],
    [outputs.webApp192, 192],
    [outputs.webApp512, 512],
    [outputs.favicon16, 16],
    [outputs.favicon32, 32],
  ] as const)
    generated.set(target, await render(rounded, size));
  const ico = encodePngIco(
    await Promise.all(
      WINDOWS_ICON_SIZES.map(async (size) => ({ size, contents: await render(rounded, size) })),
    ),
  );
  generated.set(outputs.windowsIco, ico);
  generated.set(outputs.faviconIco, ico);
}

for (const [brand, directory] of [
  ["development", "apps/web/public"],
  ["production", "apps/marketing/public"],
] as const) {
  for (const override of resolveWebIconOverrides(brand, directory)) {
    // The marketing site only ships the favicon and touch icon.
    if (directory.includes("marketing") && override.targetRelativePath.includes("web-app-icon"))
      continue;
    const contents = generated.get(override.sourceRelativePath);
    if (!contents) throw new Error(`Missing generated icon: ${override.sourceRelativePath}`);
    generated.set(override.targetRelativePath, contents);
  }
}

const stale: string[] = [];
for (const [target, contents] of generated) {
  if (check) {
    const existing = await NodeFSP.readFile(NodePath.resolve(root, target)).catch(() => undefined);
    if (!existing?.equals(contents)) stale.push(target);
  } else {
    await NodeFSP.writeFile(NodePath.resolve(root, target), contents);
  }
}
if (stale.length) throw new Error(`Generated icons are stale:\n${stale.join("\n")}`);
console.log(`${check ? "Verified" : "Updated"} ${generated.size} portable icon assets.`);

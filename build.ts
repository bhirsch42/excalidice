// Bundle the content scripts and copy the manifest and icons into dist/, which Chrome loads
// unpacked. With --zip, also pack dist/ into excalidice-<version>.zip for a release.
import { $ } from "bun";
import { cp, rm } from "node:fs/promises";

const root = new URL("./", import.meta.url).pathname;
const out = `${root}dist/`;
await rm(out, { recursive: true, force: true });
// content.js is the tray (isolated world); page.js reaches Excalidraw's collab socket (main world).
for (const name of ["content", "page"]) {
  const result = await Bun.build({
    entrypoints: [`${root}src/${name}.ts`],
    outdir: out,
    naming: `${name}.js`,
    format: "iife",
    minify: true,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}
await cp(`${root}manifest.json`, `${out}manifest.json`);
await cp(`${root}icons`, `${out}icons`, { recursive: true });
console.log(`built ${out}`);

if (process.argv.includes("--zip")) {
  const { version } = await Bun.file(`${root}manifest.json`).json();
  const zip = `${root}excalidice-${version}.zip`;
  await rm(zip, { force: true });
  await $`zip -qrX ${zip} .`.cwd(out);
  console.log(`packed ${zip}`);
}

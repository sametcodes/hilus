// Sürümü üç yerde birden günceller: package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml.
// Kullanım: npm run bump -- 0.2.0
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Kullanım: npm run bump -- 0.2.0");
  process.exit(1);
}
for (const file of ["package.json", "src-tauri/tauri.conf.json"]) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.version = version;
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
}
const cargo = "src-tauri/Cargo.toml";
writeFileSync(cargo, readFileSync(cargo, "utf8").replace(/^version = ".*"$/m, `version = "${version}"`));
console.log(`Sürüm ${version}. Şimdi: git commit -am "chore: v${version}" && git push && gh workflow run release.yml`);

/**
 * 把 `packages/` 里的包汇总成一份 `registry.json`。
 *
 *   node scripts/build.mjs           # 生成 / 更新 registry.json
 *   node scripts/build.mjs --check   # 只检查：registry.json 是不是最新（CI 用）
 *
 * # 输入只有两样
 *
 *   packages/<id>-<version>.lattice   包本体（签名对象）
 *   packages/<id>-<version>.json      条目元数据（谁发的 / 什么时候 / 签名）
 *   icons/<id>.svg                    可选，装不上图标就不写这个字段
 *
 * 其余字段一律从包里读。**不维护第二份清单** —— 目录和包一旦各写一份描述，
 * 迟早对不上，而"对不上"在用户眼里就是装不上。
 *
 * # 构建时做四件事，任何一条不过就整体失败
 *
 * 1. 文件名 = `<manifest.id>-<manifest.version>.lattice`
 * 2. 签名对得上包的实际字节（这一条同时挡住了"包被换了但 sidecar 没更新"）
 * 3. id / 版本 / 权限格式合法
 * 4. 同一个 id 的版本号不重复
 *
 * 失败就退出，不写半份 registry.json —— 一个"少了个组件"的目录比构建失败
 * 难查得多。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Hex, verifyBytes } from "./ed25519.mjs";
import { readManifest } from "./zip.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = join(root, "packages");
const ICONS = join(root, "icons");
const OUTPUT = join(root, "registry.json");

const ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const KEY_RE = /^[0-9a-f]{64}$/;
const SIGNATURE_RE = /^[0-9a-f]{128}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CATALOGUE_NAME = "Lattice Registry";

const problems = [];
const complain = (message) => problems.push(message);

function compareVersionsDesc(a, b) {
  const split = (value) => value.split(/[.+-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const left = split(a);
  const right = split(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const one = left[index] ?? 0;
    const two = right[index] ?? 0;
    if (one === two) continue;
    if (typeof one === "number" && typeof two === "number") return two - one;
    return String(two).localeCompare(String(one));
  }
  return 0;
}

function collect() {
  if (!existsSync(PACKAGES)) {
    complain("packages/ 不存在");
    return [];
  }

  const files = readdirSync(PACKAGES)
    .filter((name) => name.endsWith(".lattice"))
    .sort();

  const entries = [];

  for (const file of files) {
    const path = join(PACKAGES, file);
    const sidecarPath = join(PACKAGES, `${basename(file, ".lattice")}.json`);

    if (!existsSync(sidecarPath)) {
      complain(`${file}: 缺 ${basename(sidecarPath)}（跑 scripts/sign.mjs 生成）`);
      continue;
    }

    let sidecar;
    let manifest;
    let bytes;
    try {
      sidecar = JSON.parse(readFileSync(sidecarPath, "utf8"));
      bytes = readFileSync(path);
      manifest = readManifest(bytes);
    } catch (error) {
      complain(`${file}: 读不出来 —— ${error.message}`);
      continue;
    }

    const publisherKey = String(sidecar?.publisher?.key ?? "").toLowerCase();
    const signature = String(sidecar?.signature ?? "").toLowerCase();
    const publisherName = String(sidecar?.publisher?.name ?? "").trim();
    const published = String(sidecar?.published ?? "");

    if (!KEY_RE.test(publisherKey)) {
      complain(`${file}: publisher.key 要 64 个 hex 字符`);
      continue;
    }
    if (!SIGNATURE_RE.test(signature)) {
      complain(`${file}: signature 要 128 个 hex 字符`);
      continue;
    }
    if (!publisherName) {
      complain(`${file}: publisher.name 不能为空（安装时会显示它）`);
      continue;
    }
    if (!DATE_RE.test(published)) {
      complain(`${file}: published 要写成 YYYY-MM-DD`);
      continue;
    }
    if (!verifyBytes(bytes, signature, publisherKey)) {
      complain(`${file}: 签名验不过 —— 包和 sidecar 不是一起发的，或者包被改过`);
      continue;
    }
    if (!manifest.id || !ID_RE.test(manifest.id)) {
      complain(`${file}: manifest.id 不合法（${manifest.id ?? "缺失"}）`);
      continue;
    }
    if (!VERSION_RE.test(String(manifest.version ?? ""))) {
      complain(`${file}: manifest.version 不合法（${manifest.version ?? "缺失"}）`);
      continue;
    }
    if (file !== `${manifest.id}-${manifest.version}.lattice`) {
      complain(`${file}: 文件名和清单不一致（应为 ${manifest.id}-${manifest.version}.lattice）`);
      continue;
    }

    const iconPath = join(ICONS, `${manifest.id}.svg`);
    const permissions = Array.isArray(manifest.permissions)
      ? manifest.permissions.filter((item) => typeof item === "string")
      : [];

    entries.push({
      id: manifest.id,
      name: manifest.name ?? manifest.id,
      description: manifest.description ?? "",
      author: manifest.author ?? publisherName,
      ...(existsSync(iconPath) ? { icon: `icons/${manifest.id}.svg` } : {}),
      ...(sidecar.homepage ? { homepage: String(sidecar.homepage) } : {}),
      publisher: { name: publisherName, key: publisherKey },
      published,
      version: {
        version: manifest.version,
        url: `packages/${file}`,
        sha256: sha256Hex(bytes),
        size: bytes.length,
        signature,
        permissions,
      },
    });
  }

  // 按 id 合并版本，保持"一个组件一条记录"
  const byId = new Map();
  for (const item of entries) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, { ...item, versions: [item.version] });
      continue;
    }
    if (existing.publisher.key !== item.publisher.key) {
      complain(`${item.id}: ${item.version.version} 和已收录版本的发布者钥匙不同 —— 同名组件只能由一个发布者维护`);
      continue;
    }
    if (existing.versions.some((version) => version.version === item.version.version)) {
      complain(`${item.id}: 版本 ${item.version.version} 重复`);
      continue;
    }
    existing.versions.push(item.version);
    if (item.published > existing.published) existing.published = item.published;
  }

  return [...byId.values()]
    .map(({ version, ...entry }) => ({
      ...entry,
      versions: entry.versions.sort((a, b) => compareVersionsDesc(a.version, b.version)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function main() {
  const check = process.argv.includes("--check");
  const widgets = collect();

  if (problems.length > 0) {
    console.error(`\n  ${problems.length} 处问题，没有写出 registry.json：\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error("");
    process.exit(1);
  }

  const updated = widgets.reduce((latest, item) => (item.published > latest ? item.published : latest), "");
  const catalogue = {
    schema: 1,
    name: CATALOGUE_NAME,
    updated,
    widgets,
  };
  const text = `${JSON.stringify(catalogue, null, 2)}\n`;

  if (check) {
    const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : "";
    if (current !== text) {
      console.error("\n  registry.json 不是最新的 —— 跑 node scripts/build.mjs 再提交\n");
      process.exit(1);
    }
    console.log(`\n  registry.json 是最新的（${widgets.length} 个组件）\n`);
    return;
  }

  writeFileSync(OUTPUT, text);
  const total = widgets.reduce(
    (sum, item) => sum + item.versions.reduce((bytes, version) => bytes + version.size, 0),
    0,
  );
  console.log(`\n  ${widgets.length} 个组件 / ${widgets.reduce((n, i) => n + i.versions.length, 0)} 个版本 → registry.json`);
  console.log(`  共 ${(total / 1024).toFixed(1)} KB，最近更新 ${updated}\n`);
}

main();

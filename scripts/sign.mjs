/**
 * 给一个已经打好的 `.lattice` 包签一份"条目元数据"（sidecar）。
 *
 *   node scripts/sign.mjs packages/lattice.clock-0.2.0.lattice --key publisher.key --name "Lattice"
 *   LATTICE_PUBLISHER_KEY=<64 hex> node scripts/sign.mjs packages/x.lattice --name "Tom"
 *
 * 产物是 `packages/<同名>.json`，内容只有三样东西：谁发的、什么时候发的、签名。
 * 其余字段（id、版本、描述、权限）构建时从包里的 `manifest.json` 直接读 ——
 * **不复制**，就不会有"目录和包对不上"这种事。
 *
 * # 为什么签名在 sidecar 里，而不是塞进包里
 *
 * 塞进包里就得改包、重算哈希，签名的对象是包本身这件事就乱了。签名是
 * "关于这个包的一句外部断言"，天然属于目录。
 *
 * # 私钥从哪儿来
 *
 * `--key <文件>` 读一行 hex；没有就给 `LATTICE_PUBLISHER_KEY` 环境变量。
 * 两者都没有就报错退出 —— 绝不替你生成一把随手的钥匙，那会让"这把钥匙
 * 一直是同一把"这个唯一的信任前提失效。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { publicKeyFromSeed, sha256Hex, signBytes, verifyBytes } from "./ed25519.mjs";
import { readManifest } from "./zip.mjs";

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const target = process.argv.slice(2).find((token) => token.endsWith(".lattice"));
if (!target) fail("用法：node scripts/sign.mjs <包文件> --key <私钥文件> --name <发布者名字>");

const packagePath = resolve(target);
if (!existsSync(packagePath)) fail(`${target} 不存在`);

const keyFile = flag("--key");
const seed = keyFile
  ? readFileSync(resolve(keyFile), "utf8")
  : process.env.LATTICE_PUBLISHER_KEY ?? "";
if (!seed.trim()) fail("没有私钥：给 --key <文件>，或者设 LATTICE_PUBLISHER_KEY");

const publisherName = flag("--name") ?? process.env.LATTICE_PUBLISHER_NAME ?? "";
if (!publisherName.trim()) fail("没有发布者名字：给 --name <名字>（安装时会显示这个）");

const homepage = flag("--homepage");
const published = flag("--published") ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(published)) fail(`--published 要写成 YYYY-MM-DD，收到 ${published}`);

const bytes = readFileSync(packagePath);
const manifest = readManifest(bytes);
const { publicKey } = publicKeyFromSeed(seed);

// 文件名和清单必须对得上：目录里的下载地址是从文件名拼出来的，
// 这里放过一个不一致的包，装的时候会在"版本对不上"那一步才报错，很难查。
const expected = `${manifest.id}-${manifest.version}.lattice`;
if (basename(packagePath) !== expected) {
  fail(`文件名应为 ${expected}（清单里是 ${manifest.id} ${manifest.version}）`);
}

const signature = signBytes(bytes, seed);
if (!verifyBytes(bytes, signature, publicKey)) fail("签完自己验不过 —— 不该发生，先别用这个包");

const sidecar = {
  schema: 1,
  published,
  publisher: { name: publisherName.trim(), key: publicKey },
  ...(homepage ? { homepage } : {}),
  signature,
};

const out = resolve(dirname(packagePath), `${basename(packagePath, ".lattice")}.json`);
writeFileSync(out, `${JSON.stringify(sidecar, null, 2)}\n`);

console.log(`\n  ${manifest.id} ${manifest.version}`);
console.log(`  sha256     ${sha256Hex(bytes)}`);
console.log(`  publisher  ${sidecar.publisher.name} ${publicKey}`);
console.log(`  → ${out}\n`);
console.log("  把这个 json 和包一起提交。私钥不要提交。\n");

/**
 * ed25519 的最小封装 —— 和平台里 `scripts/sign-widget.mjs` 是同一套东西。
 *
 * 算法必须和校验方（Rust 侧 `ed25519-dalek`）一致，所以这里**照抄**平台的
 * 实现而不是自己换一种写法。`--selftest` 用的是平台单测里的同一组固定向量：
 * 哪天两边有一边漂了，这条会红。
 *
 * 私钥是 32 字节种子、64 个 hex 字符。它只该待在签名的人自己的机器上，
 * 不进这个仓库 —— 目录仓库是公开的。
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function publicKeyFromSeed(seedHex) {
  const seed = Buffer.from(String(seedHex).trim(), "hex");
  if (seed.length !== 32) {
    throw new Error(`publisher key must be 32 bytes (64 hex characters), got ${seed.length}`);
  }
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const spki = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  return { publicKey: spki.subarray(SPKI_PREFIX.length).toString("hex"), privateKey };
}

export function signBytes(bytes, seedHex) {
  const { privateKey } = publicKeyFromSeed(seedHex);
  return sign(null, bytes, privateKey).toString("hex");
}

export function verifyBytes(bytes, signatureHex, publicKeyHex) {
  const spki = Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]);
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  return verify(null, bytes, key, Buffer.from(signatureHex, "hex"));
}

/** 和 `src-tauri/src/signature.rs` 单测共用的向量 */
const SELFTEST = {
  seed: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  payload: "lattice signature self test",
  publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  signature:
    "9f9fcdb0cdc48c7acfd2e5a6da1db2337e2749ed8c0419e4fd5efe2ec15cddea43009a0326b7d839b66ca187544f9f7fb08a899c7132ab0a79d94ad41a46ac04",
};

export function selfTest() {
  const payload = Buffer.from(SELFTEST.payload);
  const { publicKey } = publicKeyFromSeed(SELFTEST.seed);
  if (publicKey !== SELFTEST.publicKey) throw new Error(`public key drifted: ${publicKey}`);
  const signature = signBytes(payload, SELFTEST.seed);
  if (signature !== SELFTEST.signature) throw new Error(`signature drifted: ${signature}`);
  if (!verifyBytes(payload, signature, publicKey)) throw new Error("signature does not verify");
  return true;
}

if (process.argv.includes("--selftest")) {
  selfTest();
  console.log("  selftest ok — same vector as src-tauri/src/signature.rs");
}

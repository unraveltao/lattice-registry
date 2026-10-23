/**
 * 只读 ZIP 解析 —— 够读 `.lattice` 里的 `manifest.json` 就行。
 *
 * # 为什么不用 zip 库
 *
 * 和平台那边打包的取舍一样：容器格式本身只有几十行，deflate 用 Node 自带的
 * `zlib.inflateRawSync`。目录仓库是个纯静态仓库，多一个依赖就多一份"三年后
 * 装不上"的风险。
 *
 * # 为什么读中央目录而不是顺着本地头往后走
 *
 * 本地头里的压缩大小可能是 0（带 data descriptor 的包就是这样），顺着走会
 * 读错。中央目录里的字段是可信的，代价只是要先找到 EOCD。
 */
import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(bytes) {
  // EOCD 后面最多跟 64KB 的注释，所以从尾部往前扫这么远就够
  const stop = Math.max(0, bytes.length - 0x10000 - 22);
  for (let offset = bytes.length - 22; offset >= stop; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/**
 * @param {Buffer} bytes
 * @returns {Map<string, Buffer>} 包内路径 → 解压后的内容
 */
export function readZip(bytes) {
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory record)");

  const count = bytes.readUInt16LE(eocd + 10);
  let cursor = bytes.readUInt32LE(eocd + 16);
  const files = new Map();

  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error(`corrupt central directory at entry ${index}`);
    }
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    if (bytes.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`corrupt local header for ${name}`);
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const body = bytes.subarray(start, start + compressedSize);

    if (method === 0) files.set(name, Buffer.from(body));
    else if (method === 8) files.set(name, inflateRawSync(body));
    else throw new Error(`${name}: unsupported compression method ${method}`);

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

/** 从包里读 `manifest.json`，读不出来就当这个包坏了 */
export function readManifest(bytes) {
  const files = readZip(bytes);
  const raw = files.get("manifest.json");
  if (!raw) throw new Error("package has no manifest.json");
  return JSON.parse(raw.toString("utf8"));
}

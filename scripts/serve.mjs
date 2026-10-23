/**
 * 本地预览用的静态服务器 —— 只为了在真机上验一遍目录。
 *
 *   node scripts/serve.mjs            # http://127.0.0.1:8080/registry.json
 *   node scripts/serve.mjs --port 9000
 *
 * 应用里 Settings → Widget catalogue → Custom URL 填这个地址，走的就是
 * "远端目录"那条真实路径（HTTP + 跨域 + 相对地址解析），比把文件塞进
 * public/store 里试要可信。
 *
 * 带 `Access-Control-Allow-Origin: *`：正式托管在 Pages 上也是同样的头，
 * 本地不模拟一下，上线才发现图标加载不出来就晚了。
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portIndex = process.argv.indexOf("--port");
const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 8080;

const TYPES = {
  ".json": "application/json; charset=utf-8",
  ".lattice": "application/zip",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const server = createServer((request, response) => {
  const pathname = decodeURIComponent((request.url ?? "/").split("?")[0]);
  const relative = normalize(pathname === "/" ? "/registry.json" : pathname).replace(/^[\\/]+/, "");
  const path = join(root, relative);

  // 目录穿越：normalize 之后还在 root 里面才算数
  if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end(`not found: ${pathname}\n`);
    return;
  }

  const bytes = readFileSync(path);
  response.writeHead(200, {
    "content-type": TYPES[extname(path)] ?? "application/octet-stream",
    "content-length": bytes.length,
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  response.end(bytes);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`\n  http://127.0.0.1:${port}/registry.json\n  把这一行填进 Settings → Widget catalogue → Custom URL\n`);
});

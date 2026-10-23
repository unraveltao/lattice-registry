# Lattice Registry

一份静态的组件目录。**没有服务端**，没有数据库，没有构建服务 —— 只有一份 `registry.json`、一批签名过的 `.lattice` 包，和一组图标。

Lattice 在 `Settings → Widget catalogue → Custom URL` 里填本仓库 Pages 的地址，就能装这里的所有组件、收到后续更新。

```
https://<你的用户名>.github.io/lattice-registry/registry.json
```

## 它长什么样

```
registry.json                     ← 构建产物，提交进仓库，也直接对外
packages/
  lattice.clock-0.2.0.lattice     ← 包本体（ZIP，签名对象）
  lattice.clock-0.2.0.json        ← 条目元数据：谁发的、什么时候、签名
icons/
  lattice.clock.svg               ← 可选，缺了就不显示图标
scripts/
  build.mjs                       ← 汇总 + 校验
  sign.mjs                        ← 作者在自己机器上签名，产出 sidecar
  zip.mjs / ed25519.mjs           ← 各几十行，零依赖
  serve.mjs                       ← 本地预览
```

`registry.json` 里每个条目只写三样来自 sidecar 的东西（发布者、日期、签名），**其余字段全部从包里读**。目录和包不各写一份描述，就不会出现"目录说 0.2.0、包里是 0.1.0"这种装不上的情况。

## 加一个组件

前提：你已经有一个 `.lattice` 包。没有的话，在 Lattice 仓库里：

```bash
npm run create:widget -- demo.hello   # 起个骨架
npm run pack:widget -- examples/demo.hello --out dist-packs
```

然后在本仓库：

```bash
# 1. 放包
cp dist-packs/demo.hello-0.1.0.lattice packages/

# 2. 签名（私钥只在你机器上）
node scripts/sign.mjs packages/demo.hello-0.1.0.lattice \
  --key /path/to/your-publisher.key --name "你的名字"

# 3. 重算目录
node scripts/build.mjs

# 4. 提交三个文件
git add packages/demo.hello-0.1.0.lattice packages/demo.hello-0.1.0.json registry.json
```

有图标就顺手放一张 `icons/demo.hello.svg`（正方形，透明底）。push 到 `main` 之后 Actions 会自动部署。

## 签名是怎么算的

- 算法 ed25519，签的是**整个包文件的字节**。
- 私钥是 32 字节种子，64 个 hex 字符，一行。生成：`npm run sign:widget -- --gen-key --out publisher.key`（在 Lattice 仓库里）。
- 公钥从私钥推出来，写进 sidecar 的 `publisher.key`。安装时界面会印出它的指纹（`f842 c1bf fc52 e48c` 这种形式）。
- Lattice 第一次装某个组件时记下这把钥匙，之后**换钥匙必须用户点一次确认**。所以：一把钥匙用到底，别换。

**私钥永远不进这个仓库。** 目录是公开的，谁拿到私钥谁就能冒充你发版本。

## 校验

构建时四件事全过才写文件，任何一条不过就整体失败：

1. 文件名 = `<manifest.id>-<manifest.version>.lattice`
2. 签名对得上包的实际字节（这条同时挡住"包被换了但 sidecar 没更新"）
3. id / 版本 / 权限格式合法
4. 同一个组件只能由一个发布者维护，版本号不重复

```bash
npm run check      # registry.json 是不是最新的（CI 跑的就是这个）
npm run selftest   # 签名算法自检，向量和 Lattice 的 Rust 单测同一组
```

## 本地预览

```bash
npm run serve      # http://127.0.0.1:8080/registry.json
```

把这一行填进应用的 Custom URL。走的是真实的远端路径（HTTP + 跨域 + 相对地址解析），比把文件塞进 `public/store` 里试可信。

## 明确不做

账号、评分服务端、下载计数、组件市场首页。这些都要服务端，而整个 Lattice 分发模型的前提就是"没有服务端"。评分和举报落本地文件，作者自己收。

## 许可

本仓库只分发包，不托管组件源码。每个组件的授权由它的作者决定，见包内 `manifest.json`。

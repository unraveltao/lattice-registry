# 提交一个组件

## 只收包，不收代码

提 PR 的时候带三样东西：`.lattice` 包、同名 `.json`（sidecar）、更新后的 `registry.json`。**不要**把组件源码目录提上来。

原因很实在：一旦目录开始"从源码构建"，就得为构建环境、依赖版本、可复现性负责 —— 那是另一个项目。现在这里只有一个 Node 进程读几个文件，任何人 clone 下来都能在十秒内验证一遍。

## 步骤

1. **打好包**。在 Lattice 仓库：`npm run pack:widget -- <组件目录> --out dist-packs`。包名必须是 `<id>-<version>.lattice`。
2. **签名**。`node scripts/sign.mjs dist-packs/x.lattice --key publisher.key --name "你的名字"`，产出同目录的 `.json`。
3. **放进来**。两个文件都拷到 `packages/`，图标（可选）放 `icons/<id>.svg`。
4. **重算目录**。`node scripts/build.mjs`。
5. **提 PR**。写清这个组件干什么、要了哪些权限、为什么。

上面五步是**没有 Lattice 源码也能走完**的路子（比如你在别的机器上只 clone 了这个仓库）。如果你就在 Lattice 仓库里干活，第 1 到 4 步有现成的一条命令：

```bash
npm run publish:widget -- public/widgets/lattice.note --key ../lattice-registry/.keys/publisher.key
```

它做完打包、签名、写 sidecar、重建 `registry.json`，最后把"改了哪几个文件、下一条 git 命令是什么"打出来。同一个目录重跑一次是幂等的 —— 不会因为把 sidecar 的日期改成今天而脏出一份空提交。

## 会被拒的情况

- 签名验不过，或者 `publisher.key` 和这个 id 以前用的不是同一把。
- 要的权限和功能不匹配（一个时钟要 `network`）。
- 文件名和清单里的 id / 版本对不上。
- 同一个 id 换个发布者重新提交 —— 组件归属跟着钥匙走，不跟着名字走。
- 打包里塞了 `node_modules`、图片以外的二进制、或者任何 `.lattice`。

## 版本与回滚

同一个 id 可以有多个版本，目录里全部保留，应用按 semver 挑最新的。**不要删旧版本** —— 用户回滚靠的就是它们。真要撤一个坏版本，删掉它并说明原因，别覆盖同一个版本号重发（哈希变了，签名也变了，用户那边会当成两回事）。

## 发布者钥匙

一把钥匙对应一个身份，组件归属跟着它走。钥匙丢了就没法给已有组件发新版（只能换 id 重新开始），所以备份好。别把私钥提交到任何仓库，包括 fork。

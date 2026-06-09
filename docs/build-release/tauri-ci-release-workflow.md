# CI 与发布工作流说明（ci.yml / release.yml）

本文说明仓库 `.github/workflows/` 下两个工作流的职责、协作方式、缓存提速原理，以及维护时的注意事项。

> 方案参考 clash-verge-rev：用"默认分支维持热缓存 + tag 发版只读缓存"的模式，把每次发版的冷编译时间从 30 多分钟降下来。

---

## 一、两个工作流的分工

| 文件 | 触发时机 | 职责 | 是否写缓存 |
|------|----------|------|-----------|
| `ci.yml` | push 到 `master`（默认分支）/ 手动 | 三平台 release 编译，充当 CI + **写热缓存** | 是（`save-if: master`） |
| `release.yml` | push `v*.*.*` tag / 手动 | 三平台打包 + 创建 Release 草稿 + 上传 updater | 否（只读缓存） |

核心思想：**缓存只在一个地方（master）写入，发版构建从那里读取。**

---

## 二、为什么这样能提速（缓存机制）

GitHub Actions 的缓存**按 ref（分支/tag）隔离**，恢复时只会查找：

1. 当前 ref 自己的缓存；
2. **默认分支（master）的缓存**。

而每个 tag（`v0.1.0`、`v0.1.1`…）都是**不同的 ref**，彼此缓存互不可见。所以：

- 如果只在 tag 上构建、master 从不构建 → 默认分支缓存为空 → **每次发版都从零编译约 600 个 crate（30+ 分钟）**。
- 现在由 `ci.yml` 在 master 上维持一份热缓存，`release.yml` 的 tag 构建从 master 缓存恢复依赖 → **只需重编你自己改动的 `ccmesh` crate**，大幅提速。

### 缓存能跨 workflow 命中的前提

`ci.yml` 与 `release.yml` 的以下配置**必须逐字一致**，否则缓存 key 对不上、命中失败：

```yaml
- uses: dtolnay/rust-toolchain@master
  with:
    toolchain: '1.96.0'          # 两边同一版本
- uses: Swatinem/rust-cache@v2
  with:
    workspaces: './src-tauri -> target'
    prefix-key: 'v1-rust'
    key: 'release-${{ matrix.platform }}'
    cache-all-crates: true
```

`rust-cache` 实际 key = `prefix-key` + 上面的 `key` + 操作系统 + **rustc 版本** + `Cargo.lock` 哈希。因此固定 Rust 版本、保持 `Cargo.lock` 一致是命中的关键。tag 从 master 切出，`Cargo.lock` 天然相同。

---

## 三、关键配置项解释

### `env: CARGO_INCREMENTAL: 0`
CI 里关闭 Rust 增量编译。增量产物体积大、跨 runner 无法复用，关掉后缓存更小、干净构建更快。

### `toolchain: '1.96.0'`（固定，不用 `@stable`）
浮动 `@stable` 每次 Rust 小版本更新都会改变缓存 key → 触发一次全量重编。固定版本让缓存 key 稳定。

### `save-if: ${{ github.ref == 'refs/heads/master' }}`
- 在 `release.yml`：tag 构建 ref 是 `refs/tags/...` → 条件不成立 → **只读不写**。
- 在 `ci.yml`：push master 时 ref 是 `refs/heads/master` → 条件成立 → **写缓存**。

### `ci.yml` 用 `pnpm tauri build --no-bundle`
只编译 Rust + 前端，跳过 msi/dmg/AppImage 打包，省时间；但依赖 crate 仍被完整编译，足以填满热缓存。`release.yml` 不加 `--no-bundle`，因为它要真正产出安装包。

---

## 四、如何发布一个版本

1. 确认改动已合入 `master`，且 `master` 上的 `ci.yml` 至少成功跑过一次（缓存已就绪）。
2. 更新版本号：`src-tauri/tauri.conf.json` 的 `version`（以及如有需要的 `package.json`）。
3. 打 tag 并推送：
   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```
4. `release.yml` 自动构建三平台，在 GitHub 创建一个 **Release 草稿（draft）**，附带各平台安装包、`.sig` 签名与 `latest.json`。
5. 到 GitHub Releases 页面**手动 Publish** 这个草稿——只有正式发布后，updater 的 `latest/download` 更新源才会生效。

> 想先验证三平台能否构建、又不创建 Release：在 Actions 里对 `release.yml` 用 **workflow_dispatch 手动触发**（`tagName` 为空，不会建 Release）。

---

## 五、必需的仓库 Secrets

在 GitHub 仓库 `Settings → Secrets and variables → Actions` 配置：

| Secret | 用途 | 缺失后果 |
|--------|------|----------|
| `TAURI_SIGNING_PRIVATE_KEY` | updater 更新包签名（密钥**内容**，非路径） | 安装包仍能出，但无 `.sig`，自动更新失效 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码（本项目当前为空，也要建该 Secret 并留空） | 同上 |
| `APPLE_*` 系列 | macOS 代码签名与公证 | 产出未签名包，自用可，分发会被 Gatekeeper 拦 |

> `TAURI_SIGNING_PRIVATE_KEY` 的值＝本地 `.env.local` 里那串密钥内容。**私钥绝不能进仓库**，只放本地 `.env.local`（已 gitignore）和这里的 Secrets。详见 [`tauri-updater-signing.md`](./tauri-updater-signing.md)。

---

## 六、注意事项（容易踩的坑）

1. **首次 master 构建仍是冷编译（~30 分钟）。** 这是在建立缓存，无法避免；之后的 master push 和所有 tag 发版才会快。

2. **升级 Rust 版本时，两个文件的 `toolchain: '1.96.0'` 必须同步改。** 只改一个会导致缓存 key 不一致、命中失效，发版又退回冷编译。

3. **改 `Cargo.lock`（增删依赖）会使缓存部分失效。** 这是正常的——下一次 master 构建会重建缓存，发版前让 `ci.yml` 在 master 上先跑一遍即可恢复热缓存。

4. **缓存有容量与过期限制。** 单仓库缓存上限 10 GB，超出后按 LRU 淘汰；7 天未被读取的缓存会被自动清理。长期不发版后第一次构建可能因缓存过期而变慢。

5. **`key` 改动即放弃旧缓存。** 如果哪天想强制清空重建，把两个文件的 `prefix-key` 从 `v1-rust` 改成 `v2-rust` 即可（旧缓存自然失活）。

6. **`concurrency.cancel-in-progress: true`。** 连续推两个 tag 时，前一个构建会被取消。如需每个 tag 都跑完，可去掉该项。

7. **依赖系统库的平台差异已在 workflow 内处理：** Linux 需 `libwebkit2gtk-4.1-dev` 等（已在 `Install Linux dependencies` 步骤安装）；本项目 reqwest 用 rustls，**无需 OpenSSL**。

---

## 七、相关文档

- 更新签名与密钥管理：[`tauri-updater-signing.md`](./tauri-updater-signing.md)
- 本地构建配置：[`tauri-build-config.md`](./tauri-build-config.md)
- 本地打包指南：[`tauri-build-guide.md`](./tauri-build-guide.md)
- 发版操作手册：[`tauri-release-ops.md`](./tauri-release-ops.md)

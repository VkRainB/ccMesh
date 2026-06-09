# 发版操作手册

ccMesh 发版的日常操作：打 tag、重新触发构建、正式发布、紧急撤回。

> 前置条件：已在 GitHub Secrets 配好 `TAURI_SIGNING_PRIVATE_KEY`（见 [`tauri-updater-signing.md`](./tauri-updater-signing.md)）。

---

## 一、正常发版流程

```bash
# 1. 改版本号（tauri.conf.json + package.json 保持一致）
# 2. 提交并推送到 master
git add -A && git commit -m "release: v0.2.0"
git push origin master

# 3. 等 master 的 ci.yml 跑完（热缓存就绪）
# 4. 打 tag 并推送，触发 release.yml 三平台构建
git tag v0.2.0
git push origin v0.2.0
```

CI 完成后到 GitHub → Releases → 找到 Draft → 点 **Publish release** 正式发布。

### 发布后 checklist

- [ ] Release 页面 Assets 里有 msi / dmg / deb / latest.json
- [ ] 已点 **Publish release**（Draft 状态下 updater 检测不到更新）
- [ ] 访问 `https://github.com/VkRainB/ccMesh/releases/latest/download/latest.json` 能打开
- [ ] 已安装客户端能检测到更新并下载

---

## 二、重新触发构建（Re-tag）

适用场景：CI 构建失败（如依赖下载超时、签名配置错误），修复后需要重新触发。

```bash
# 1. 修复问题并提交
git add -A && git commit -m "fix: 修复构建问题"
git push origin master

# 2. 删除旧 tag（本地 + 远程）
git tag -d v0.1.0
git push origin :refs/tags/v0.1.0

# 3. 在最新 commit 上重新打 tag 并推送
git tag v0.1.0
git push origin v0.1.0
```

推完 tag 后 GitHub Actions 自动触发新的构建。旧 Release 草稿会被新构建覆盖。

### 完整示例（本次 v0.1.0 的实际操作记录）

```
$ git tag -d v0.1.0
Deleted tag 'v0.1.0' (was 113d1fd)

$ git push origin :refs/tags/v0.1.0
To https://github.com/VkRainB/ccMesh.git
 - [deleted]         v0.1.0

$ git tag v0.1.0
$ git push origin v0.1.0
To https://github.com/VkRainB/ccMesh.git
 * [new tag]         v0.1.0 -> v0.1.0
```

---

## 三、正式发布（Draft → Published）

Draft 只有仓库协作者可见，普通用户和 updater 都检测不到。

1. GitHub → **Releases** → 找到对应版本的 Draft
2. 点右上角 **Edit**（铅笔图标）
3. 检查 Assets 文件是否齐全
4. 填写 Release 标题和说明（可选）
5. 点底部绿色按钮 **Publish release**

> **不要勾选 Pre-release**。Pre-release 是标记"非正式版"的标签，和 Draft/Published 是独立的概念。

---

## 四、撤回已发布版本

如果已发布的版本有严重问题：

### 方案 A：删除 Release（推荐用于紧急情况）

```bash
# 1. GitHub 上删除该 Release（Assets 和 latest.json 一并删除）
# 2. updater 检测不到 latest.json，不会提示更新
# 3. 修复后重新走正常发版流程
```

### 方案 B：标记为 Pre-release

GitHub Release 页面 → Edit → 勾选 **Pre-release** → Update release。

Pre-release 会被 updater 忽略（`latest.json` 只指向非 pre-release 的最新版）。

---

## 五、手动验证构建（不发版）

在 GitHub Actions 页面对 `release.yml` 点 **Run workflow**，选择 master 分支手动触发。

手动触发时 `tagName` 为空，不会创建 Release，只验证三平台能否构建。适合：
- 验证签名配置是否正确
- 升级依赖后确认编译通过
- 调试 CI 问题

---

## 六、版本号规范

ccMesh 使用 [语义化版本](https://semver.org/lang/zh-cn/)：

```
v主版本.次版本.修订号
v0.1.0 → v0.1.1 → v0.2.0 → v1.0.0
```

| 变动类型 | 版本变化 | 示例 |
|---------|---------|------|
| Bug 修复 | 修订号 +1 | v0.1.0 → v0.1.1 |
| 新功能 | 次版本 +1 | v0.1.1 → v0.2.0 |
| 破坏性变更 | 主版本 +1 | v0.2.0 → v1.0.0 |

两个文件的版本号必须同步修改：
- `src-tauri/tauri.conf.json` → `version`
- `package.json` → `version`

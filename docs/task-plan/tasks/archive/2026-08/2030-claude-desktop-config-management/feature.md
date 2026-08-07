# 2030 Claude Desktop 配置文件接管管理实现路径

## 目标

在现有配置文件管理页面中增加 Claude Desktop 配置管理能力。实现重点不是复制现有 Claude Code / Codex 的快照模式，而是安全接管 Claude Desktop 真实配置文件：解析真实目录、读取 profile 与 `_meta.json` 关系、用表单和 JSON 编辑器展示、写入前备份并原子保存。

## 现状（根因）

当前项目已有 `ConfigProfiles` 页面和 `tool_config` 后端模块，但它们面向的是快照式管理：

```text
真实配置 -> extract -> app_data/profiles/<tool>/<channel-id> -> save -> apply -> 真实配置
```

Claude Desktop 的模型不同：

```text
真实 3P 配置目录
  configLibrary/_meta.json              实时注册表
  configLibrary/<profile-id>.json       一个文件就是一个渠道 / 网关配置
  claude_desktop_config.json            3P 模式相关
  developer_settings.json               3P / 开发者模式相关
```

因此：

- 不能只把 `claude-desktop` 加进现有 `Tool` 枚举然后复用 `save_channel()`。
- 需要单独的文件接管 service，复用原子写、备份、命令注册、UI 三栏模式即可。

## 关键文件 / 落点

### 后端新增 / 修改

| 文件 | 操作 | 说明 |
| --- | --- | --- |
| `src-tauri/src/utils/paths.rs` | 修改 | 增加 Claude Desktop 跨平台路径解析入口和路径 DTO |
| `src-tauri/src/modules/tool_config/mod.rs` | 修改 | `pub mod claude_desktop;`，必要时暴露共享 JSON / backup helper |
| `src-tauri/src/modules/tool_config/claude_desktop.rs` | 新增 | Claude Desktop 文件接管核心逻辑 |
| `src-tauri/src/models/tool_config.rs` | 修改或拆分 | 增加 Claude Desktop DTO；若过大可新建 `models/claude_desktop_config.rs` |
| `src-tauri/src/commands/tool_config.rs` | 修改 | 增加 Claude Desktop 专用 Tauri commands |
| `src-tauri/src/lib.rs` | 修改 | 注册新增 commands |

### 前端新增 / 修改

| 文件 | 操作 | 说明 |
| --- | --- | --- |
| `src/pages/ConfigProfiles/index.tsx` | 修改 | 新增 `Claude Desktop` Tab |
| `src/pages/ConfigProfiles/_components/ClaudeDesktopWorkspace.tsx` | 新增 | Claude Desktop 三栏工作区 |
| `src/pages/ConfigProfiles/_components/ChannelList.tsx` | 小改 | 增加可选文案 props，复用为“配置文件”列表 |
| `src/services/modules/claude_desktop_config.ts` | 新增 | 前端 IPC service 与类型 |
| `src/lib/claudeDesktopConfig.ts` | 新增 | profile/meta 关系、表单合并、脱敏显示等纯函数 |
| `src/lib/toolConfig.ts` | 小改可选 | 若要复用 `gatewayBaseUrl`，可扩展 appType 或保持 Claude Desktop 调用 `gatewayBaseUrl(port, "claude")` |

### 参考文件

- `src/pages/ConfigProfiles/_components/ClaudeWorkspace.tsx`：Claude Code 三栏和模型字段表单。
- `src/pages/ConfigProfiles/_components/CodexWorkspace.tsx`：多文件配置 UI 经验。
- `src/components/common/JsonEditor.tsx`：右栏编辑器。
- `src-tauri/src/modules/tool_config/claude.rs`：env 字段合并思路。
- `src-tauri/src/modules/tool_config/codex.rs`：多文件校验和回滚思路。

## 任务拆解

### 2030.1 后端路径解析与路径状态 DTO

实现 Claude Desktop 路径解析，不读写具体 profile。

#### 输出 DTO 草案

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDesktopPathsDto {
    pub supported: bool,
    pub platform: String,
    pub threep_root_logical: Option<String>,
    pub threep_root_resolved: Option<String>,
    pub config_library_path: Option<String>,
    pub meta_path: Option<String>,
    pub threep_config_path: Option<String>,
    pub developer_settings_path: Option<String>,
    pub normal_config_path: Option<String>,
    pub resolution_source: String,
    pub package_family_name: Option<String>,
    pub is_msix_virtualized: bool,
    pub candidates: Vec<ClaudeDesktopPathCandidateDto>,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDesktopPathCandidateDto {
    pub path: String,
    pub source: String,
    pub score: i32,
    pub exists: bool,
    pub markers: Vec<String>,
}
```

#### Windows 精简伪代码

```rust
pub fn resolve_claude_desktop_paths() -> AppResult<ClaudeDesktopPaths> {
    if let Some(override_dir) = env::var_os("CLAUDE_USER_DATA_DIR") {
        return score_and_build_paths(vec![candidate(override_dir, "env")]);
    }

    match std::env::consts::OS {
        "windows" => resolve_windows_paths(),
        "macos" => resolve_macos_paths(),
        "linux" => resolve_linux_paths_or_unsupported(),
        other => unsupported(other),
    }
}

fn resolve_windows_paths() -> AppResult<ClaudeDesktopPaths> {
    let local_app_data = env_path("LOCALAPPDATA")?;
    let roaming_app_data = env_path("APPDATA").ok();
    let mut candidates = Vec::new();

    // 方法 1：Get-AppxPackage，高收益主路径。
    if let Ok(package_family_name) = get_appx_package_family_name() {
        candidates.push(candidate(
            local_app_data
                .join("Packages")
                .join(&package_family_name)
                .join("LocalCache")
                .join("Local")
                .join("Claude-3p"),
            "get-appxpackage-msix-local",
        ));
        // 1P / Roaming 配置可从同一个 PFN 派生。
        let normal_config_path = local_app_data
            .join("Packages")
            .join(&package_family_name)
            .join("LocalCache")
            .join("Roaming")
            .join("Claude")
            .join("claude_desktop_config.json");
    }

    // 方法 2：候选目录探测，覆盖 Get-AppxPackage 不可用或多包残留。
    candidates.extend(probe_windows_candidates(&local_app_data)?);

    // 非 MSIX / 已排除虚拟化时的逻辑路径也作为候选。
    candidates.push(candidate(local_app_data.join("Claude-3p"), "logical-localappdata"));

    if let Some(roaming) = roaming_app_data {
        // 普通 1P fallback，只用于 normal_config_path，不作为 3P 根。
        let normal_fallback = roaming.join("Claude").join("claude_desktop_config.json");
    }

    select_best_candidate(candidates)
}

fn get_appx_package_family_name() -> AppResult<String> {
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "$pkg = Get-AppxPackage -Name Claude; if ($pkg) { $pkg.PackageFamilyName }",
        ])
        .output()?;
    parse_single_non_empty_line(output.stdout)
}

fn probe_windows_candidates(local_app_data: &Path) -> AppResult<Vec<PathBuf>> {
    // ponytail: 只枚举 LocalAppData\Packages\Claude_* 一层；若未来 Anthropic 改包名，再增加手动目录覆盖。
    let packages_dir = local_app_data.join("Packages");
    let mut out = Vec::new();
    for entry in fs::read_dir(packages_dir)?.flatten() {
        let package_dir = entry.path();
        let Some(name) = package_dir.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !name.starts_with("Claude_") {
            continue;
        }
        out.push(package_dir.join("LocalCache").join("Local").join("Claude-3p"));
    }
    Ok(out)
}
```

#### 候选目录打分伪代码

```rust
fn score_candidate(path: &Path) -> CandidateScore {
    let mut score = 0;
    let mut markers = Vec::new();

    if path.exists() {
        score += 1;
        markers.push("dir".into());
    }
    if path.join("configLibrary").join("_meta.json").exists() {
        score += 100;
        markers.push("configLibrary/_meta.json".into());
    }
    if has_any_json(path.join("configLibrary")) {
        score += 80;
        markers.push("configLibrary/*.json".into());
    }
    if path.join("claude_desktop_config.json").exists() {
        score += 30;
        markers.push("claude_desktop_config.json".into());
    }
    if path.join("developer_settings.json").exists() {
        score += 20;
        markers.push("developer_settings.json".into());
    }
    if path.join("logs").join("main.log").exists() {
        score += 10;
        markers.push("logs/main.log".into());
    }

    CandidateScore { score, markers }
}
```

### 2030.2 后端 Claude Desktop profile/meta 文件接管

实现读取 `_meta.json`、profile 文件列表、文件状态和保存逻辑。

#### 数据契约草案

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDesktopProfileMetaDto {
    pub id: String,
    pub name: String,
    pub file_name: String,
    pub path: String,
    pub registered: bool,
    pub active: bool,
    pub exists: bool,
    pub valid_json: bool,
    pub updated_at: Option<String>,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDesktopProfileDataDto {
    pub meta: ClaudeDesktopProfileMetaDto,
    pub profile_json: serde_json::Value,
    pub meta_json: serde_json::Value,
    pub developer_settings_json: serde_json::Value,
    pub desktop_config_json: serde_json::Value,
    pub paths: ClaudeDesktopPathsDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveClaudeDesktopProfileRequest {
    pub id: Option<String>,
    pub name: String,
    pub profile_json: serde_json::Value,
    pub register_in_meta: bool,
    pub make_active: bool,
}
```

#### `_meta.json` 策略

由于当前阶段不能把敏感真实 JSON 抄入文档，实现阶段先采用“保留未知字段 + 最小增改注册项”的策略：

```rust
fn upsert_profile_in_meta(meta_json: Value, profile: ProfileRegistration) -> AppResult<Value> {
    let mut root = ensure_object(meta_json);

    // 伪代码：具体字段名要根据真实 _meta.json 样例落地。
    // 原则：只改注册列表和 active/current 字段，其他未知字段保持原样。
    let profiles = ensure_array_at_known_profile_list_key(&mut root)?;
    remove_existing_registration(profiles, &profile.id);
    profiles.push(json!({
        "id": profile.id,
        "name": profile.name,
        "file": format!("{}.json", profile.id),
    }));

    if profile.make_active {
        set_known_active_profile_key(&mut root, &profile.id)?;
    }

    Ok(Value::Object(root))
}
```

实现前必须只读本机 `_meta.json` 的字段名，但不能把 token 或完整内容写入日志。若 `_meta.json` 结构版本未知，应返回“需要手动确认 schema”的错误，不要盲写。

#### 保存流程伪代码

```rust
pub fn save_claude_desktop_profile(req: SaveClaudeDesktopProfileRequest) -> AppResult<ClaudeDesktopProfileMetaDto> {
    validate_profile_name(&req.name)?;
    validate_json_object(&req.profile_json, "profile")?;

    let paths = resolve_claude_desktop_paths()?;
    let config_library = paths.config_library_path()?;
    fs::create_dir_all(&config_library)?;

    let profile_id = req.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    validate_file_safe_profile_id(&profile_id)?;
    let profile_path = config_library.join(format!("{profile_id}.json"));
    let meta_path = config_library.join("_meta.json");

    let old_meta = read_json_or_default(&meta_path, json!({}))?;
    let new_meta = if req.register_in_meta {
        upsert_profile_in_meta(old_meta, registration_from_req(&req, &profile_id))?
    } else {
        old_meta
    };

    backup_file_if_exists(&profile_path, "claude-desktop-profile", "json")?;
    backup_file_if_exists(&meta_path, "claude-desktop-meta", "json")?;

    atomic_write_pretty_json(&profile_path, &req.profile_json)?;
    if req.register_in_meta {
        atomic_write_pretty_json(&meta_path, &new_meta)?;
    }

    read_profile_meta(&paths, &profile_id)
}
```

### 2030.3 后端 3P 模式文件写入与命令注册

实现 `claude_desktop_config.json`、`developer_settings.json` 的接管 / 应用动作。

#### 命令草案

```rust
#[tauri::command]
pub fn resolve_claude_desktop_paths() -> AppResult<ClaudeDesktopPathsDto>;

#[tauri::command]
pub fn list_claude_desktop_profiles() -> AppResult<Vec<ClaudeDesktopProfileMetaDto>>;

#[tauri::command]
pub fn get_claude_desktop_profile(id: String) -> AppResult<ClaudeDesktopProfileDataDto>;

#[tauri::command]
pub fn save_claude_desktop_profile(req: SaveClaudeDesktopProfileRequest) -> AppResult<ClaudeDesktopProfileMetaDto>;

#[tauri::command]
pub fn unregister_claude_desktop_profile(id: String) -> AppResult<()>;

#[tauri::command]
pub fn delete_claude_desktop_profile_file(id: String) -> AppResult<()>;

#[tauri::command]
pub fn apply_claude_desktop_3p_mode(req: ApplyClaudeDesktop3pRequest) -> AppResult<ApplyClaudeDesktop3pResult>;
```

#### 3P 应用请求草案

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyClaudeDesktop3pRequest {
    pub active_profile_id: String,
    pub write_normal_config: bool,
    pub write_threep_config: bool,
    pub write_developer_settings: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyClaudeDesktop3pResult {
    pub written_files: Vec<String>,
    pub backup_files: Vec<String>,
    pub warnings: Vec<String>,
    pub restart_required: bool,
}
```

#### 3P 合并策略伪代码

```rust
fn apply_deployment_mode(mut config: Value) -> Value {
    let object = ensure_object(config);
    object.insert("deploymentMode".to_string(), Value::String("3p".to_string()));
    Value::Object(object)
}

fn apply_developer_settings(mut settings: Value) -> Value {
    let object = ensure_object(settings);
    // 具体字段以真实 developer_settings.json 样例为准。
    // 原则：只改 3P 必要开关，保留其他字段。
    object.insert("deploymentMode".to_string(), Value::String("3p".to_string()));
    Value::Object(object)
}
```

注意：`developer_settings.json` 的确切字段名必须实现前按报告和真实文件确认。如果真实字段不是 `deploymentMode`，文档中的伪代码只能作为“保留未知字段并写最小 3P 开关”的策略说明。

### 2030.4 前端 service、类型和纯函数

新增 `claudeDesktopConfigApi`，不要混入 `toolConfigApi`。

```ts
export interface ClaudeDesktopPaths {
  supported: boolean;
  platform: string;
  threepRootLogical?: string | null;
  threepRootResolved?: string | null;
  configLibraryPath?: string | null;
  metaPath?: string | null;
  threepConfigPath?: string | null;
  developerSettingsPath?: string | null;
  normalConfigPath?: string | null;
  resolutionSource: string;
  packageFamilyName?: string | null;
  isMsixVirtualized: boolean;
  candidates: ClaudeDesktopPathCandidate[];
  warning?: string | null;
}

export interface ClaudeDesktopProfileMeta {
  id: string;
  name: string;
  fileName: string;
  path: string;
  registered: boolean;
  active: boolean;
  exists: boolean;
  validJson: boolean;
  updatedAt?: string | null;
  warning?: string | null;
}

export const claudeDesktopConfigApi = {
  resolvePaths: () => request<ClaudeDesktopPaths>("resolve_claude_desktop_paths"),
  listProfiles: () => request<ClaudeDesktopProfileMeta[]>("list_claude_desktop_profiles"),
  getProfile: (id: string) => request<ClaudeDesktopProfileData>("get_claude_desktop_profile", { id }),
  saveProfile: (req: SaveClaudeDesktopProfileRequest) =>
    request<ClaudeDesktopProfileMeta>("save_claude_desktop_profile", { req }),
  unregisterProfile: (id: string) => request<void>("unregister_claude_desktop_profile", { id }),
  deleteProfileFile: (id: string) => request<void>("delete_claude_desktop_profile_file", { id }),
  apply3pMode: (req: ApplyClaudeDesktop3pRequest) =>
    request<ApplyClaudeDesktop3pResult>("apply_claude_desktop_3p_mode", { req }),
};
```

`src/lib/claudeDesktopConfig.ts` 建议放纯函数：

```ts
export function buildDefaultClaudeDesktopProfile(baseUrl: string): Record<string, unknown>;
export function parseClaudeDesktopOperationFields(profileJson: unknown): ClaudeDesktopOperationFields;
export function mergeClaudeDesktopOperationFields(base: unknown, fields: ClaudeDesktopOperationFields): Record<string, unknown>;
export function formatPathSourceLabel(paths: ClaudeDesktopPaths): string;
export function getEditableFileText(data: ClaudeDesktopProfileData, fileKind: EditableClaudeDesktopFile): string;
export function replaceEditableFileJson(data: ClaudeDesktopProfileData, fileKind: EditableClaudeDesktopFile, value: unknown): ClaudeDesktopProfileData;
```

### 2030.5 前端 ClaudeDesktopWorkspace UI

新增三栏工作区，复用当前体验。

#### UI 布局

```tsx
export function ClaudeDesktopWorkspace() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PathStatusBanner />
      <div className="flex min-h-0 flex-1 gap-3">
        <ChannelList title="配置文件" newLabel="新增配置文件" ... />
        <MiddleProfileForm />
        <RightFileEditor />
      </div>
      <FooterActions />
      <TakeoverConfirmDialog />
      <DeleteConfirmDialog />
    </div>
  );
}
```

#### 中栏建议字段

```text
基本信息
  - 配置名称
  - Profile ID / 文件名，只读展示
  - 注册状态：已注册 / 未注册
  - 当前应用：是 / 否

写入模式
  - 端点配置写入：base URL 自动为 http://127.0.0.1:<port>
  - 自定义配置写入：base URL 可编辑，并可拉取模型

网关字段
  - 地址
  - 秘钥
  - Sonnet / Opus / Haiku 模型映射
  - 默认兜底模型

3P 文件状态
  - _meta.json 状态
  - developer_settings.json 状态
  - claude_desktop_config.json 状态
```

#### 右栏文件 Tab

```tsx
type EditableClaudeDesktopFile =
  | "profile"
  | "meta"
  | "developerSettings"
  | "desktopConfig";

<Tabs value={fileKind} onValueChange={(value) => setFileKind(value as EditableClaudeDesktopFile)}>
  <TabsList>
    <TabsTrigger value="profile">Profile</TabsTrigger>
    <TabsTrigger value="meta">_meta.json</TabsTrigger>
    <TabsTrigger value="developerSettings">developer_settings.json</TabsTrigger>
    <TabsTrigger value="desktopConfig">claude_desktop_config.json</TabsTrigger>
  </TabsList>
</Tabs>

<JsonEditor value={fileText} lang="json" readOnly={!rightEditable} fill onChange={setFileText} />
```

### 2030.6 验证与人工核对

#### 自动验证建议

后端：

```text
cargo test claude_desktop --lib
cargo test tool_config --lib
```

前端：

```text
npx vitest run src/lib/claudeDesktopConfig.test.ts
npx tsc --noEmit
```

具体命令以项目 `package.json` / `Cargo.toml` 实际 scripts 为准，执行阶段再探测，不在计划中臆造。

#### 人工核对清单

1. Windows MSIX 机器上，解析结果应指向：

```text
%LOCALAPPDATA%\Packages\<PackageFamilyName>\LocalCache\Local\Claude-3p
```

2. UI 中显示 `resolutionSource=get-appxpackage-msix-local` 或 `probe-msix-local`。
3. 新增 profile 后：
   - `configLibrary/<profile-id>.json` 存在。
   - `_meta.json` 有对应注册项。
   - 右栏能切换查看 profile 和 `_meta.json`。
4. 启用 3P 后：
   - `claude_desktop_config.json` / `developer_settings.json` 被备份并写入。
   - UI 提示需要重启 Claude Desktop。
5. 删除默认只解除注册；如选择删除文件，需要二次危险确认。

## 数据契约

### 后端 command 列表

```text
resolve_claude_desktop_paths() -> ClaudeDesktopPathsDto
list_claude_desktop_profiles() -> Vec<ClaudeDesktopProfileMetaDto>
get_claude_desktop_profile(id) -> ClaudeDesktopProfileDataDto
save_claude_desktop_profile(req) -> ClaudeDesktopProfileMetaDto
unregister_claude_desktop_profile(id) -> ()
delete_claude_desktop_profile_file(id) -> ()
apply_claude_desktop_3p_mode(req) -> ApplyClaudeDesktop3pResult
```

### 前端 Query Key 建议

```ts
const CLAUDE_DESKTOP_QUERY_KEYS = {
  paths: ["claude-desktop-config", "paths"] as const,
  profiles: ["claude-desktop-config", "profiles"] as const,
  profile: (id: string) => ["claude-desktop-config", "profile", id] as const,
};
```

### 文件编辑状态建议

```ts
interface ClaudeDesktopEditorState {
  selectedId: string | null;
  loaded: boolean;
  profileName: string;
  writeMode: "endpoint" | "custom";
  operationFields: ClaudeDesktopOperationFields;
  editableFile: EditableClaudeDesktopFile;
  fileText: string;
  fileTextDirty: boolean;
  rightEditable: boolean;
}
```

## 实现顺序

1. 后端路径解析 DTO + tests。
2. 后端读取 profile/meta 列表 + tests。
3. 后端保存 profile 与 `_meta.json` 注册 + tests。
4. 后端 3P 应用命令 + command 注册。
5. 前端 service 与纯函数。
6. `ChannelList` 轻量文案泛化。
7. `ConfigProfiles` 新增 Claude Desktop Tab。
8. `ClaudeDesktopWorkspace` 三栏 UI。
9. 验证、自修、人工核对。

## 验收标准

- 路径解析准确，Windows 不写错逻辑目录。
- `_meta.json` 和 profile 关系可视化，新增时同步注册。
- 端点配置写入和自定义配置写入均可生成 profile JSON。
- 右栏可以查看四类 JSON 文件。
- 写盘前备份，失败不吞错，不泄漏密钥。

## 测试点

1. `score_candidate`：含 `_meta.json` 的 MSIX 目录胜过空逻辑目录。
2. `resolve_windows_paths`：Get-AppxPackage 失败时仍能通过候选目录探测。
3. `upsert_profile_in_meta`：保留未知字段，不重复注册同一 id。
4. `unregister_profile_from_meta`：只移除注册，不删除 profile 文件。
5. `mergeClaudeDesktopOperationFields`：保留 profile JSON 非操作字段。
6. `ClaudeDesktopWorkspace`：无路径时显示可理解的错误和候选路径，不崩溃。

## 提交策略

后续编码完成后按模块拆提交，不要一股脑提交：

1. `docs(task-plan): plan claude desktop config takeover`
2. `feat(backend): resolve claude desktop config paths`
3. `feat(backend): manage claude desktop profiles`
4. `feat(frontend): add claude desktop config workspace`
5. `test(config): cover claude desktop path and meta logic`

本轮只写文档，不提交。

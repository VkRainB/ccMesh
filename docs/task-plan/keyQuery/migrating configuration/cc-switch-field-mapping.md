# cc-switch → ccMesh 供应商字段映射

> Phase 1：`claude` / `codex` → ccMesh `endpoints`  
> Schema 版本：`SCHEMA_VERSION = 11`（`cc-switch.db`）  
> 更新：2026-06-26

---

## 1. 范围

| 做 | 不做 |
|----|------|
| 读 `providers`（claude/codex） | 其余表、OAuth JSON 文件 |
| 抽取 `settings_config` URL/Key → `endpoints` | Channel、Copilot/ChatGPT OAuth |

**DB 路径**：`~/.cc-switch/cc-switch.db`（Windows：`%USERPROFILE%\.cc-switch\`；另查 `%HOME%\.cc-switch\` legacy）

---

## 2. `providers` 表结构

来源：`cc-switch/src-tauri/src/database/schema.rs`。全平台 Schema 一致。

**主键**：`(id, app_type)`

| 列名 | 类型 | 默认 | 用途 | Phase 1 |
|------|------|------|------|---------|
| `id` | TEXT | — | 供应商标识，同 app 下唯一 | remark 溯源 |
| `app_type` | TEXT | — | 应用类型，见 §3 | 筛 `claude`/`codex` |
| `name` | TEXT | — | 显示名称 | → `endpoints.name` |
| `settings_config` | TEXT | — | **JSON**，live 配置快照（§4） | 解析 url/key |
| `website_url` | TEXT | NULL | 供应商官网 | 可选 → remark |
| `category` | TEXT | NULL | 分类：`official`/`custom`/… | 不迁移 |
| `created_at` | INTEGER | NULL | 创建时间（毫秒时间戳） | 不迁移 |
| `sort_index` | INTEGER | NULL | 列表排序 | → `sort_order` |
| `notes` | TEXT | NULL | 用户备注 | → `remark` |
| `icon` | TEXT | NULL | 图标名（如 `anthropic`） | 不迁移 |
| `icon_color` | TEXT | NULL | 图标色 Hex | 不迁移 |
| `meta` | TEXT | `'{}'` | **JSON**，CC Switch 元数据（§5） | transformer / 跳过 OAuth |
| `is_current` | BOOLEAN | `0` | 是否为当前激活供应商 | 不迁移 |
| `in_failover_queue` | BOOLEAN | `0` | 是否在代理故障转移队列 | 不迁移 |
| `cost_multiplier` | TEXT | `'1.0'` | 成本倍率（v2 迁移列；多数在 meta 也有） | 不迁移 |
| `limit_daily_usd` | TEXT | NULL | 日消费限额 USD | 不迁移 |
| `limit_monthly_usd` | TEXT | NULL | 月消费限额 USD | 不迁移 |
| `provider_type` | TEXT | NULL | 表级类型标识（legacy，优先读 meta） | 不迁移 |

**行 JSON 示例（Claude）**：

```json
{
  "id": "deepseek-api",
  "app_type": "claude",
  "name": "DeepSeek 中转",
  "settings_config": {
    "env": {
      "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
      "ANTHROPIC_API_KEY": "sk-xxx",
      "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-chat"
    }
  },
  "website_url": "https://deepseek.com",
  "category": "third_party",
  "created_at": 1710000000000,
  "sort_index": 1,
  "notes": "自用",
  "icon": "deepseek",
  "icon_color": "#4D6BFE",
  "meta": {
    "apiFormat": "anthropic",
    "authBinding": { "source": "provider_config" }
  },
  "is_current": false,
  "in_failover_queue": false
}
```

**行 JSON 示例（Codex）**：

```json
{
  "id": "openrouter-codex",
  "app_type": "codex",
  "name": "OpenRouter Codex",
  "settings_config": {
    "auth": { "OPENAI_API_KEY": "sk-or-xxx" },
    "config": "model_provider = \"OpenRouter\"\n[model_providers.OpenRouter]\nbase_url = \"https://openrouter.ai/api/v1\"\nmodel = \"openai/gpt-5.2-codex\""
  },
  "meta": { "apiFormat": "openai_responses" },
  "sort_index": 0
}
```

---

## 3. `app_type` 枚举（`providers.app_type`）

| 值 | 客户端 | Phase 1 |
|----|--------|---------|
| `claude` | Claude Code | **迁移** |
| `codex` | OpenAI Codex | **迁移** |
| `claude-desktop` | Claude Desktop | 跳过 |
| `gemini` / `opencode` / `openclaw` / `hermes` | 各 CLI | 跳过 |

别名：`claude-desktop` ← `claude_desktop` / `claudeDesktop`

---

## 4. JSON 列：`settings_config`（按 app_type）

写入本机 live 配置的快照；**URL/Key 迁移从此解析**。

### 4.1 `claude` / `claude-desktop`

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.example.com/v1",
    "ANTHROPIC_AUTH_TOKEN": "sk-...",
    "ANTHROPIC_API_KEY": "sk-...",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-...",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-...",
    "ANTHROPIC_DEFAULT_FABLE_MODEL": "claude-fable-5-...",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4-...",
    "ANTHROPIC_MODEL": "..."
  },
  "apiKey": "..."
}
```

| JSON 路径 | 用途 | → ccMesh |
|-----------|------|----------|
| `env.ANTHROPIC_BASE_URL` | 上游 API 地址 | `api_url` |
| `env.ANTHROPIC_AUTH_TOKEN` | 密钥（优先） | `api_key` |
| `env.ANTHROPIC_API_KEY` | 密钥（次选） | `api_key` |
| 顶层 `apiKey` | Bedrock 等预设 | `api_key` |
| `env.ANTHROPIC_*_MODEL` | 默认模型 | `models` / `model` |
| `env` 其它键 | 客户端行为配置 | 不迁移 |

Key 优先级：`apiKey` → `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY`

### 4.2 `codex`

```json
{
  "auth": {
    "OPENAI_API_KEY": "sk-..."
  },
  "config": "model_provider = \"OpenRouter\"\nmodel = \"gpt-5.2-codex\"\n[model_providers.OpenRouter]\nbase_url = \"https://openrouter.ai/api/v1\""
}
```

| JSON 路径 | 用途 | → ccMesh |
|-----------|------|----------|
| `auth.OPENAI_API_KEY` | 主密钥 | `api_key` |
| `env.OPENAI_API_KEY` | 备选密钥 | `api_key` |
| `config`（TOML）→ `[model_providers.<active>].base_url` | 上游地址 | `api_url` |
| `config`（TOML）→ `model` | 主模型 | `model` |
| `config`（TOML）→ `review_model` | 审查模型 | `models[]` |
| `auth.tokens.*` | ChatGPT OAuth 登录 | 不迁移 |

---

## 5. JSON 列：`meta`（ProviderMeta）

仅存 CC Switch 内部，**不写入**客户端 live 配置。

```json
{
  "apiFormat": "anthropic",
  "authBinding": {
    "source": "provider_config",
    "authProvider": "github_copilot",
    "accountId": "12345"
  },
  "providerType": "github_copilot",
  "apiKeyField": "ANTHROPIC_AUTH_TOKEN",
  "costMultiplier": "1.0",
  "endpointAutoSelect": false,
  "custom_endpoints": {
    "https://backup.example.com": { "url": "https://backup.example.com", "addedAt": 1710000000000 }
  },
  "testConfig": { "enabled": false, "testModel": "claude-sonnet-4-..." },
  "codexFastMode": false,
  "githubAccountId": "12345"
}
```

| JSON 键 | 用途 | Phase 1 |
|---------|------|---------|
| `apiFormat` | API 协议：`anthropic`/`openai_chat`/`openai_responses`/`gemini_native` | → `transformer` |
| `authBinding.source` | `provider_config` / `managed_account` | `managed_account` → **跳过** |
| `authBinding.authProvider` | `github_copilot` / `codex_oauth` | 配合跳过 OAuth |
| `authBinding.accountId` | 托管账号 ID | 不迁移 |
| `providerType` | 特殊类型：`github_copilot`/`codex_oauth` | OAuth → **跳过** |
| `apiKeyField` | Claude 密钥 env 键名 | 仅影响读 key |
| `githubAccountId` | 旧 Copilot 绑定 | **跳过** |
| `costMultiplier` / `limitDailyUsd` / `limitMonthlyUsd` | 计费限额 | 不迁移 |
| `custom_endpoints` | 自定义 URL 候选 | URL fallback 参考 |
| `endpointAutoSelect` | 测速自动选 URL | 不迁移 |
| `testConfig` | 单独测速配置 | 不迁移 |
| `usage_script` | 用量查询脚本 | 不迁移 |
| `codexFastMode` / `codexChatReasoning` | Codex 代理行为 | 不迁移 |
| `claudeDesktopMode` / `claudeDesktopModelRoutes` | Desktop 3P 路由 | 不迁移 |
| `isFullUrl` / `promptCacheKey` / `customUserAgent` | 代理转发细节 | 不迁移 |

---

## 6. cc-switch → ccMesh 映射（Phase 1）

| cc-switch | ccMesh `endpoints` | 说明 |
|-----------|-------------------|------|
| `name` | `name` | 冲突跳过或重命名 |
| 解析 URL | `api_url` | 无则跳过 |
| 解析 Key | `api_key` | 无/`PROXY_MANAGED`/`${…}` 跳过 |
| `meta.apiFormat` | `transformer` | claude 默认 `claude`；codex 默认 `openai` |
| `notes` + `[cc-switch:id=…]` | `remark` | |
| `sort_index` | `sort_order` | null→0 |

**apiFormat → transformer**：`anthropic`→`claude`；`openai_chat`/`openai_responses`→`openai`

**跳过**：`providerType`∈(`github_copilot`,`codex_oauth`)；`authBinding.source=managed_account`；无 url/key

**默认值**：`auth_mode=api_key`，`enabled`/`test_status` 由导入流程探测决定（见 [cc-switch-import-flow.md](./cc-switch-import-flow.md)），`use_proxy=false`，`model_mappings=[]`，`active_models=[]`

---

## 7. 源码与后续

| 项 | 路径 |
|----|------|
| **导入实现流程** | [cc-switch-import-flow.md](./cc-switch-import-flow.md) |
| Schema | `cc-switch/src-tauri/src/database/schema.rs` |
| ProviderMeta | `cc-switch/src-tauri/src/provider.rs` |
| Claude Key | `cc-switch/src/utils/providerConfigUtils.ts` |
| Codex Key/URL | `cc-switch/src-tauri/src/codex_config.rs` |
| ccMesh Endpoint | `ccMesh/src-tauri/src/models/endpoint.rs` |

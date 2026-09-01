# ZCode 使用统计功能设计

配套文档：[`ZCode使用统计数据存储与读取分析.md`](./ZCode使用统计数据存储与读取分析.md)（数据源/表结构/读取路径调查）

## 1. 目标

在「统计 → 用量统计」平台子导航增加 **ZCode**，与 Claude Code、Codex 一致：按平台过滤、按日期联动汇总请求数 / 输入 Token / 输出 Token / 缓存 Token，三平台（Windows / Linux / macOS）通用。

## 2. 现状链路（已实现）

```
本机 JSONL 日志
  → usage_local/{claude,codex}.rs 解析为 UsageRecord
  → usage_repo::insert_record  按 (app_type, record_key) 去重写入 usage_records
  → commands/usage.rs  查询（带 app_type 过滤 + date/ts 区间）
  → 前端 UsagePanel.tsx  APP_TABS 切 app → 重查
```

关键设计：**统一表 `usage_records` + `app_type` 字段区分平台**，跨平台路径用 `paths::home_dir()`（Windows 取 `USERPROFILE`、Unix 取 `HOME`）。

## 3. ZCode 差异与对策

| 项 | Claude / Codex | ZCode | 对策 |
|---|---|---|---|
| 数据源 | JSONL 文件 | **SQLite 单文件** | 用 rusqlite 只读打开 |
| 路径 | `~/.claude`、`~/.codex` | `~/.zcode/cli/db/db.sqlite` | `home_dir().join(...)` |
| 增量依据 | 文件 mtime | WAL 模式，主文件 mtime 不可靠 | **每次全量读 + 按 record_key 去重** |
| 时间戳 | JSONL 内 RFC3339 | `started_at` Unix 毫秒 | 直接用，无需解析 |
| 字段 | usage 对象 | `model_usage` 表各 token 列 | 直接映射 |

ZCode 的 `input_tokens` 与 `cache_creation_input_tokens` / `cache_read_input_tokens` 分列，语义与现有 Claude（非缓存输入）一致，**无需拆分**。

## 4. 字段映射

ZCode `model_usage` 表 → `UsageRecord`：

| UsageRecord | 来源 | 说明 |
|---|---|---|
| `app_type` | 固定 `"zcode"` | 复用统一表 |
| `record_key` | `"zcode:" + id` | 天然去重；ZCode 30 天清理不影响已存历史 |
| `ts` | `started_at` | Unix 毫秒，直接用 |
| `date` | `started_at` 转本地 `YYYY-MM-DD` | 复用 `local_date` 思路（毫秒版） |
| `model` | `model_id` | |
| `requests` | `1` | 每行一次模型请求 |
| `input_tokens` | `input_tokens` | |
| `output_tokens` | `output_tokens` | |
| `cache_creation_tokens` | `cache_creation_input_tokens` | |
| `cache_read_tokens` | `cache_read_input_tokens` | |

**跳过全 0 token 行**（error / cancelled 通常 token 为 0），与 `claude.rs` 行为一致，三平台"请求数"语义统一。

## 5. 改动清单（最小 diff）

### 5.1 后端

**新增** `src-tauri/src/modules/usage_local/zcode.rs`：

```rust
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OpenFlags};

use crate::models::usage::UsageRecord;

/// ZCode 数据库默认路径：<home>/.zcode/cli/db/db.sqlite
pub fn default_db_path(home: &Path) -> std::path::PathBuf {
    home.join(".zcode").join("cli").join("db").join("db.sqlite")
}

/// 只读读取 ZCode model_usage，转为 UsageRecord 列表。
/// db 不存在或不可读 → 返回空 Vec（不报错，用户可能未装 ZCode）。
pub fn read_records(db_path: &Path) -> Vec<UsageRecord> {
    if !db_path.exists() {
        return Vec::new();
    }
    let Ok(conn) = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return Vec::new();
    };
    let _ = conn.busy_timeout(2000);
    read_from_conn(&conn)
}

fn read_from_conn(conn: &Connection) -> Vec<UsageRecord> {
    let sql = "SELECT id, model_id, started_at, input_tokens, output_tokens,
                      cache_creation_input_tokens, cache_read_input_tokens
               FROM model_usage";
    let Ok(stmt) = conn.prepare(sql) else { return Vec::new() };
    let rows = stmt.query_map([], |r| {
        let id: String = r.get(0)?;
        let model: String = r.get::<_, Option<String>>(1)?.unwrap_or_default();
        let started_at: i64 = r.get(2)?;
        let input: i64 = r.get(3)?;
        let output: i64 = r.get(4)?;
        let cache_create: i64 = r.get(5)?;
        let cache_read: i64 = r.get(6)?;
        Ok((id, model, started_at, input, output, cache_create, cache_read))
    });
    let Ok(rows) = rows else { return Vec::new() };
    let mut out = Vec::new();
    for row in rows.flatten() {
        let (id, model, started_at, input, output, cache_create, cache_read) = row;
        if input == 0 && output == 0 && cache_create == 0 && cache_read == 0 {
            continue;
        }
        out.push(UsageRecord {
            app_type: "zcode".to_string(),
            record_key: format!("zcode:{id}"),
            date: local_date_from_ms(started_at),
            ts: Some(started_at),
            model,
            requests: 1,
            input_tokens: input,
            output_tokens: output,
            cache_creation_tokens: cache_create,
            cache_read_tokens: cache_read,
        });
    }
    out
}

/// Unix 毫秒 → 本地日期 YYYY-MM-DD。
fn local_date_from_ms(ms: i64) -> String {
    use chrono::TimeZone;
    chrono::Local
        .timestamp_opt(ms / 1000, ((ms % 1000) * 1_000_000) as u32)
        .single()
        .map(|t| t.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_zero_token_rows() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE model_usage (
               id TEXT, model_id TEXT, started_at INTEGER,
               input_tokens INTEGER, output_tokens INTEGER,
               cache_creation_input_tokens INTEGER, cache_read_input_tokens INTEGER)",
        )
        .unwrap();
        c.execute(
            "INSERT INTO model_usage VALUES ('a','GLM-5.3-Flash',1788232572895,100,50,0,30)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO model_usage VALUES ('b','gpt-5-5',1788232572895,0,0,0,0)",
            [],
        )
        .unwrap();
        let recs = read_from_conn(&c);
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].record_key, "zcode:a");
        assert_eq!(recs[0].app_type, "zcode");
        assert_eq!(recs[0].input_tokens, 100);
        assert_eq!(recs[0].cache_read_tokens, 30);
        assert_eq!(recs[0].ts, Some(1788232572895));
    }

    #[test]
    fn missing_db_returns_empty() {
        assert!(read_records(Path::("/nope/missing.sqlite")).is_empty());
    }
}
```

**改** `src-tauri/src/modules/usage_local/mod.rs`：

```rust
pub mod claude;
pub mod codex;
pub mod zcode;   // +

// sync_all 内，Claude/Codex 收集之后追加：
if let Some(home) = &home {
    let zcode_db = zcode::default_db_path(home);
    for rec in zcode::read_records(&zcode_db) {
        match usage_repo::insert_record(conn, &rec) {
            Ok(true) => result.imported += 1,
            Ok(false) => {}
            Err(_) => result.errors += 1,
        }
    }
}
```

> 不走 `sync_file`：ZCode 是单文件 SQLite，文件 mtime 增量不适用（WAL 模式下主文件 mtime 不可靠）。每次全量读 + `insert_record` 的 `ON CONFLICT` 去重，已导入行不会重复写。

**改** `src-tauri/src/models/usage.rs`：`UsageRecord.app_type` 注释更新为 `"claude" | "codex" | "zcode"`（仅注释，无逻辑变化）。

### 5.2 前端

**改** `src/pages/Statistics/_components/UsagePanel.tsx`：

```ts
const APP_TABS: { key: UsageAppFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "claude", label: "Claude Code" },
  { key: "codex", label: "Codex" },
  { key: "zcode", label: "ZCode" },   // +
];

function appLabel(app: string): string {
  if (app === "claude") return "Claude Code";
  if (app === "codex") return "Codex";
  if (app === "zcode") return "ZCode";   // +
  return app;
}
```

**改** `src/services/modules/usage.ts`：

```ts
export type UsageAppFilter = "all" | "claude" | "codex" | "zcode";   // +
```

### 5.3 无需迁移

`usage_records.app_type` 已是 `TEXT`，现有索引 `idx_usage_records_app` 对 `"zcode"` 同样生效。**不新增表、不新增列、不加迁移脚本**。

## 6. 跨平台

- `paths::home_dir()` 与 ZCode 源码 `os.homedir()` 同语义：Windows 取 `USERPROFILE`，macOS/Linux 取 `$HOME`。
- 三平台 ZCode db 路径：`<home>/.zcode/cli/db/db.sqlite`（文档 §2.1 已确认无平台分支）。
- 只读打开 + `busy_timeout`：ZCode 运行中也可安全读，WAL 已提交数据可见。

## 7. 验收

- `cargo test -p ccmesh`：新增 `zcode::tests` 通过，现有 `usage_repo` / `claude` / `codex` 单测不破。
- 前端：用量统计出现 ZCode tab；切到 ZCode + 选日期，请求数 / 输入 / 输出 / 缓存四卡仅含 ZCode 数据；「全部」含三者。
- 三平台：ZCode 未安装时 tab 仍在，数据为 0，不报错。

## 8. 提交策略（按模块 scoped）

1. 后端：`usage_local/zcode.rs` + `usage_local/mod.rs` + `models/usage.rs` 注释
2. 前端：`UsagePanel.tsx` + `usage.ts`
3. 文档：本设计文档（可并入 1）

精确 `git add` 路径，不 `add -A`。

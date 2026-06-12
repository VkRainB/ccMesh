<!--
  task-plan-workflow 工作流真相源（single source of truth）。
  本文件由插件 init 复制进项目 docs/task-plan/workflow.md，可按项目定制。
  - 每轮 UserPromptSubmit hook 只「解析」本文件，不保存面包屑副本。
  - 改流程/改面包屑文案 → 只改本文件，不改 hook 脚本。
  - [workflow-state:STATUS] ... [/workflow-state:STATUS] 块是每轮注入的唯一来源。
    STATUS ∈ no_task | planning | in_progress | lite | done，对应 task.md 的 status 字段
    （lite 块用于 mode=lite 的快速通道任务；done 为 finish 之后、archive 之前的瞬态）。
    无激活任务时合成 no_task。
-->

# task-plan-workflow 工作流

把一条需求沿 **需求 → 路由评估 → （探索 → PRD →）任务/进度 → 编码 → 验证 → 按模块提交 → 收尾** 推到可交付。
与技术栈无关：所有构建/测试命令按当前项目实际探测，不写死。

双通道状态机（入口智能路由）：

```
路由评估 ──简单──→ lite 快速通道 (mode=lite, 直接 in_progress)：实现 → 验证 → progress.csv → 提交 → 归档
        └─标准──→ full 完整链路 (mode=full)：
                   Phase 1 规划 (planning) → 探索调研 → 澄清 → prd.md + feature.md → 整理 context.jsonl
                   Phase 2 执行 (in_progress) → 实现 → 验证 → 自修
                   Phase 3 收尾 (in_progress→done) → 最终验证 → progress.csv → scoped 提交 → 归档
```

任务产物（每任务一个隔离目录，互不污染）：

```
docs/task-plan/
├── workflow.md                 本文件（状态机真相源）
├── progress.csv                全局进度索引（12 列，进度真相源）
├── .runtime/sessions/<key>.json  session 级激活任务指针（gitignore，多窗口隔离）
└── tasks/<NN-slug>/
    ├── task.md                 元数据（frontmatter：status/priority/layer/branch…）+ 说明
    ├── prd.md                  需求文档（只写决策，不贴文件路径与代码）
    ├── feature.md              落地细节（具体文件路径/任务拆解/数据契约/验收/提交策略）
    ├── context.jsonl           read-before-write 清单（只放 spec+research，不放待改源码）
    └── research/<topic>.md      调研产物（持久化，子 agent 与后续 session 可读）
```

---

## Phase 索引（步骤总表）

| 步骤 | 名称 | 标记 | 载体 |
|---|---|---|---|
| 1.0 | 创建任务（`task.py create`，status=planning） | required·once | task.py |
| 1.1 | 探索调研（定位根因/复用点/影响范围；大范围派生 Explore 子 agent，结论写 research/） | required·repeatable | Explore / research agent |
| 1.2 | 澄清真歧义（`AskUserQuestion`，带推荐项；等回答再定稿） | required·repeatable | AskUserQuestion |
| 1.3 | 写 prd.md（只写决策）+ feature.md（落地细节） | required·once | to-prd 命令 / 手写 |
| 1.4 | 整理 context.jsonl（登记真实 spec/research，替换种子行） | required·once | 手写 |
| 1.5 | 激活任务（`task.py start`，status→in_progress） | required·once | task.py |
| 2.1 | 实现（先读 prd+context.jsonl 列出文件，再改码；调用 feature-dev） | required·repeatable | feature-dev / implement |
| 2.2 | 验证（跑项目自带 lint/typecheck/test，按栈探测） | required·repeatable | Bash |
| 2.3 | 自修（check 发现问题直接修并重跑，而非只报告） | required·repeatable | feature-dev:code-reviewer |
| 3.1 | 最终验证（整体回归，显式声明无法无头验证的部分） | required·once | Bash |
| 3.2 | 更新 progress.csv（`task.py progress set` 改状态/补日期） | required·once | task.py |
| 3.3 | 按模块 scoped 提交（派生 scoped-commit-bot，传精确文件清单） | required·once | scoped-commit-bot |
| 3.4 | 标记完成 + 归档（`task.py finish` → `task.py archive`） | required·once | task.py |

lite 快速通道（mode=lite，跳过 1.1–1.5 的文档产物）：`create --lite` → 登记 progress → 实现 → 验证 →
progress set 完成 → scoped 提交 → finish/archive。中途变复杂用 `task.py mode full` 升级回 planning。

恢复中断：`/task-plan-workflow:continue`，按 task.md.status + 产物存在性路由到具体步骤。

---

[workflow-state:no_task]
当前 session 无激活任务。先判断用户本轮意图，三选一：

- **A 直接回答**：纯问答 / 解释 / 查询 / 闲聊，不产生文件改动 → 直接回答后停止，不要建任务。
- **B 进入工作流**：实现、改文档、重构、构建、迁移，或任何需要交付产物的工作 →
  先做**智能路由评估**（判据见下），再按路由建任务：
  - **B1 简单 → lite 快速通道**：`python "$TPW_TASK" create "<标题>" --slug <name> --lite`
    → 直达执行：不写 prd/feature/context，进度只记 progress.csv。
  - **B2 标准 → full 完整链路**：`python "$TPW_TASK" create "<标题>" --slug <name>` → 进入 planning：
    先调研（必要时派生 Explore 子 agent），用 `AskUserQuestion` 澄清真歧义，再写 prd/feature。
- **C 本轮跳过工作流（逐轮逃逸口）**：仅当**用户当前消息**明确表达「这次直接改/不要走流程/skip」时，
  才在本轮 inline 改文件。不要自行替用户选择跳过。

**智能路由判据**（评估在建任务前完成，不确定时先快速检索代码再判）：

走 **lite** 须全部满足：
1. 预计改动 ≤2 个文件、约 ≤50 行，无新文件结构；
2. 需求明确、方案唯一，无需向用户澄清；
3. 不涉及架构决策 / 新抽象 / 数据契约（接口、事件、存储结构）变更 / 外部系统集成；
4. 失败易回滚，不碰关键路径的核心逻辑。
典型：bug 修复、文案/样式微调、配置项增改、小函数、参数透传、依赖小版本升级。

走 **full**（任一命中即是）：多文件/跨模块、新功能、需要架构或契约决策、需求含糊有真歧义、
外部集成、影响面拿不准、用户明确要求 PRD/规划。

**拿不准 → full**（宁可流程重，不可漏决策）；用户消息明确说「简单改一下/快速处理」可作为 lite 的加权信号，
但判据不满足时仍走 full 并向用户说明原因。

默认严格走 B：对话会被压缩重启，任务文件不会——工作产物需要持久任务文件。
[/workflow-state:no_task]

[workflow-state:planning]
当前任务处于**规划阶段**。目标：把请求落成 implement/check 可信赖的任务文件。按序推进：

1. **探索调研**（若未做）：定位根因、可复用实现、影响范围。代码符号→codegraph；中文/UI/配置→Grep；
   文件名→Glob；大范围或分析参考代码库→派生 Explore 子 agent。**调研结论写进 `research/<topic>.md`**
   （留在聊天里会丢；写文件后子 agent 与后续 session 都能读）。
2. **澄清**：有影响实现的真歧义，用 `AskUserQuestion`（每项带推荐项+说明），等用户回答再定稿。
3. **写 prd.md**：可用 `/task-plan-workflow:to-prd`。只写**决策**（接口/数据结构/契约/优先级/默认值），
   不贴具体文件路径与代码片段。
4. **写 feature.md**：落地细节——具体文件路径/落点、任务拆解（NN.x）、数据契约、验收标准、测试点、提交策略。
5. **整理 context.jsonl**：把实现/检查需要先读的 **spec 文件与 research 文件**逐行登记（含 reason），
   **替换掉种子 `_example` 行**。规则：只放 spec+research，**不要登记即将修改的源码文件**。
6. **登记进度**：用 `task.py progress add` 把 feature.md 拆出的子任务写入 progress.csv（初始状态 待开始）。
7. **激活**：`python "$TPW_TASK" start` → 进入执行阶段。

未写 prd.md 或 context.jsonl 仍是种子行时，`task.py start` 会拦截（确需跳过加 --force）。
[/workflow-state:planning]

[workflow-state:in_progress]
当前任务处于**执行/收尾阶段**（status 从 start 到 archive 全程为 in_progress）。

**执行（Phase 2）**
1. **先读后写**：先读 `prd.md`，再读 `context.jsonl` 列出的每个 spec/research 文件，再看相关源码，最后动手。
2. **实现**：优先调用 `feature-dev:feature-dev`（强制 澄清→设计→批准→实现）。已充分调研时**不要**重复派生 explore 子 agent。按 feature.md「构建顺序」：纯逻辑+单测 → 集成 → 命令/事件/接口 → 前端/UI。
3. **验证**：跑**项目自带**命令（从 package.json / Cargo.toml / Makefile / pyproject / CI 探测，别臆造脚本名）。
4. **自修**：检查发现的 spec 偏离 / 验证失败 / 越界改动，**直接修复并重跑**，不要只报告。
   若暴露的是需求问题，回 planning 改 prd.md 再实现。

**收尾（Phase 3）**
5. **最终验证**：整体回归。GUI/动效/真实出网等无头环境无法自动验证的，**显式声明** + 给本地核对清单。
6. **更新进度**：每完成一个子任务 `python "$TPW_TASK" progress set <编号> --status 完成 --done <日期>`。
7. **按模块 scoped 提交**：派生 `scoped-commit-bot`，**传本轮精确文件清单**。绝不 `git add -A`/`.`。
   先 docs（PRD/feature/progress）单独成提交，再按「纯逻辑+单测 / 集成 / 命令+事件 / 前端」分组。
8. **收尾**：全部提交完成后 `task.py finish` 标记 done，再 `task.py archive` 归档。
   有可复用经验（约定/契约/陷阱）就沉淀到项目 spec/CLAUDE.md，供未来任务复用。
[/workflow-state:in_progress]

[workflow-state:lite]
当前任务走 **lite 快速通道**（简单任务：不写 prd/feature/context，进度只记 progress.csv）。按序推进：

1. **登记进度**（若未记）：`python "$TPW_TASK" progress add --stage 执行 --milestone <里程碑> --id <NN前缀> --title <标题> --layer <层> --status 进行中`（整任务一行即可）。
2. **实现**：最小必要调研（直接 Grep/codegraph 检索，不派子 agent）→ 直接改码，遵循周边代码风格。
3. **验证**：跑项目自带 lint/typecheck/test（按栈探测，别臆造）；发现问题自修并重跑。
4. **复杂度升级出口**：实现中发现超出 lite 判据（>2 文件 / 出现架构或契约决策 / 冒出需要澄清的真歧义）→
   立即 `python "$TPW_TASK" mode full` 升级（缺 prd 时自动回 planning），补 prd.md/feature.md 后按标准链路推进。**别硬扛**。
5. **收尾**：`progress set <NN前缀> --status 完成 --done <日期>` → 派生 `scoped-commit-bot`（传精确文件清单，
   绝不 `git add -A`）→ `task.py finish` → `task.py archive`。
[/workflow-state:lite]

[workflow-state:done]
任务已标记 done。确认工作改动已提交后，运行 `python "$TPW_TASK" archive` 归档到
tasks/archive/YYYY-MM/，并在 progress.csv 中确认该任务相关行均为 完成。
若工作树仍脏（有未提交的本任务改动），先回到 Phase 3.7 用 scoped-commit-bot 提交，再归档。
[/workflow-state:done]

# 构建说明

## 为什么构建时间较长？

Tauri 应用的构建涉及多个步骤，导致整体构建时间较长（首次构建约 5-10 分钟）：

### 1. 前端构建阶段

- **TypeScript 编译**：需要检查所有类型定义，确保类型安全
- **Vite 打包**：将 2062 个模块转换、打包、压缩
- **资源优化**：字体文件（Inter、JetBrains Mono）需要处理多个子集（latin、cyrillic、greek 等）

### 2. Rust 编译阶段（耗时最长）

- **依赖数量多**：项目依赖了 Tauri 框架、Axum Web 框架、SQLite、HTTP 客户端等大量 Rust crate
- **Rust 编译特性**：Rust 编译器进行大量优化（LLVM 优化、链接时优化等）
- **首次构建无缓存**：清理 target 目录后，所有依赖需要从头编译

### 3. 打包阶段

- **MSI 打包**：生成 Windows Installer 包
- **NSIS 打包**：生成 NSIS 安装程序

## 如何加快构建速度？

### 开发阶段

```bash
# 使用开发模式，前端热更新，Rust 增量编译
pnpm tauri dev
```

### 生产构建

```bash
# 保留 target 目录，利用增量编译缓存
pnpm tauri build

# 只构建前端（不打包 Tauri）
pnpm build
```

### 其他优化

1. **不要删除 `src-tauri/target` 目录**：这是 Rust 的编译缓存，删除后需要重新编译所有依赖
2. **使用 SSD**：Rust 编译涉及大量小文件读写
3. **增加内存**：Rust 编译器是内存密集型的

## 构建产物

构建完成后，安装包位于：

```
src-tauri/target/release/bundle/
├── msi/
│   └── ccMesh_0.1.0_x64_en-US.msi      # MSI 安装包
└── nsis/
    └── ccMesh_0.1.0_x64-setup.exe       # NSIS 安装包
```

## 环境要求

- **Node.js**：18+（推荐 20+）
- **pnpm**：10+
- **Rust**：1.70+
- **Visual Studio Build Tools**：Windows 需要安装 C++ 桌面开发工作负载

## 常见问题

### Q: 构建失败提示路径错误

A: 可能是缓存了旧的路径信息，清理 `src-tauri/target` 目录后重试

```bash
rm -rf src-tauri/target
pnpm tauri build
```

### Q: 构建过程中内存不足

A: Rust 编译器默认使用多线程，可以限制并行数

```bash
# 限制为 2 个并行编译任务
CARGO_BUILD_JOBS=2 pnpm tauri build
```

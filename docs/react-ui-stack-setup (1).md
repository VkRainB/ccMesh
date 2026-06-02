# React UI 技术栈安装与配置指南

> 适用于 React + TypeScript 项目（使用 Vite 作为构建工具）。本文档供 Agent 自动化安装时参考。

---

## 技术栈摘要

| 类别 | 方案 |
|---|---|
| 构建工具 | Vite |
| UI 原语 | Radix UI（无样式，可访问性好） |
| 样式方案 | Tailwind CSS 4 |
| 类名工具 | clsx + tailwind-merge + class-variance-authority |
| 组件层 | shadcn/ui（按需复制，不锁定依赖） |
| 图标 | lucide-react |
| 动画 | Motion（原 Framer Motion） |
| 状态管理 | Zustand（客户端）+ TanStack Query（服务端） |
| 代码编辑器 | CodeMirror 6（按需） |

---

## Step 1：创建 React 项目

```bash
pnpm create vite@latest my-app -- --template react-ts
cd my-app
pnpm install
```

> 使用 `react-ts` 模板，自动配置 TypeScript + React，无需额外设置。

---

## Step 2：Tailwind CSS 4 配置

### 说明

Tailwind v4 采用 **CSS-first 配置**，不再使用 `tailwind.config.js`，所有主题定制直接写在 CSS 文件中。

### 2.1 安装

```bash
pnpm add tailwindcss @tailwindcss/vite
```

### 2.2 Vite 配置文件

在 `vite.config.ts` 中添加 Tailwind 插件：

```ts
// vite.config.ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
})
```

### 2.3 全局 CSS 入口

在 `src/index.css` 顶部引入 Tailwind：

```css
@import "tailwindcss";
@import "tw-animate-css"; /* shadcn/ui 动画支持，见 Step 4 */
```

> **注意**：v4 不再需要 `@tailwind base;` / `@tailwind components;` / `@tailwind utilities;` 三行指令，直接 `@import "tailwindcss"` 即可。

### 2.4 自定义 Design Token（可选）

在 `index.css` 中通过 `@theme` 扩展主题，替代旧版 `tailwind.config.js` 的 `theme.extend`：

```css
@theme {
  --color-brand: #6366f1;
  --font-sans: "Inter", sans-serif;
  --radius-lg: 0.75rem;
}
```

📖 官方文档：https://tailwindcss.com/docs/guides/vite

---

## Step 3：类名工具链

```bash
pnpm add clsx tailwind-merge class-variance-authority
```

### 用法示例

```ts
// src/lib/utils.ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

> shadcn/ui 的 `init` 命令会自动生成此文件，无需手动创建。

---

## Step 4：shadcn/ui

shadcn/ui 不是传统 npm 包，而是通过 CLI 将组件源码复制到项目中，完全可修改，无版本锁定。

### 4.1 配置路径别名

shadcn/ui 依赖 `@/` 路径别名，需先在 `vite.config.ts` 和 `tsconfig.json` 中配置：

```bash
pnpm add -D @types/node
```

```ts
// vite.config.ts
import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
```

```json
// tsconfig.json（在 compilerOptions 中添加）
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### 4.2 初始化（推荐方式）

```bash
pnpm dlx shadcn@latest init
```

CLI 会交互式询问配置项（样式、颜色、路径等），自动完成以下操作：

- 安装 `tw-animate-css` 和相关 Radix UI 依赖
- 生成 `components.json` 配置文件
- 在 `src/index.css` 中写入 CSS 变量（颜色 token）
- 创建 `src/lib/utils.ts`（包含 `cn` 工具函数）
- 创建 `src/components/ui/` 目录

### 4.3 生成的 components.json 示例

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

> 注意：React 纯客户端项目中 `rsc` 应设为 `false`。

### 4.4 添加组件（按需安装）

```bash
# 单个组件
pnpm dlx shadcn@latest add button
pnpm dlx shadcn@latest add dialog
pnpm dlx shadcn@latest add select

# 多个组件一次性添加
pnpm dlx shadcn@latest add button dialog input label select card
```

组件文件会出现在 `src/components/ui/` 目录下，可直接编辑。

📖 官方文档：https://ui.shadcn.com/docs/installation/vite
📖 组件列表：https://ui.shadcn.com/docs/components

---

## Step 5：图标 — lucide-react

```bash
pnpm add lucide-react
```

### 用法

```tsx
import { Search, Settings, User } from "lucide-react"

export function Header() {
  return <Search className="h-4 w-4" />
}
```

📖 官方文档：https://lucide.dev/guide/packages/lucide-react

---

## Step 6：动画 — Motion

> ⚠️ 包名是 `motion`，不是 `framer-motion`（v11 起正式更名，import 路径也变了）

```bash
pnpm add motion
```

### 用法

```tsx
// ✅ 正确：新版 import 路径
import { motion } from "motion/react"

// ❌ 旧版（不再推荐）
import { motion } from "framer-motion"

export function Card() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    />
  )
}
```

📖 官方文档：https://motion.dev/docs/react-installation
📖 快速上手：https://motion.dev/docs/react

---

## Step 7：状态管理

### 7.1 Zustand — 客户端全局状态

```bash
pnpm add zustand
```

#### 创建 Store

```ts
// src/store/use-counter-store.ts
import { create } from "zustand"

interface CounterState {
  count: number
  increment: () => void
  decrement: () => void
  reset: () => void
}

export const useCounterStore = create<CounterState>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  decrement: () => set((state) => ({ count: state.count - 1 })),
  reset: () => set({ count: 0 }),
}))
```

#### 在组件中使用

```tsx
import { useCounterStore } from "@/store/use-counter-store"

export function Counter() {
  const { count, increment } = useCounterStore()
  return <button onClick={increment}>{count}</button>
}
```

📖 官方文档：https://zustand.docs.pmnd.rs/getting-started/introduction

---

### 7.2 TanStack Query — 服务端状态 / 数据请求

```bash
pnpm add @tanstack/react-query
# 可选：开发者工具
pnpm add @tanstack/react-query-devtools
```

#### 在根组件挂载 QueryClientProvider

```tsx
// src/main.tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import App from "./App"
import "./index.css"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 分钟
    },
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </StrictMode>
)
```

#### 基础 useQuery 用法

```tsx
import { useQuery } from "@tanstack/react-query"

export function UserList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["users"],
    queryFn: () => fetch("/api/users").then((r) => r.json()),
  })

  if (isLoading) return <p>加载中...</p>
  if (error) return <p>请求失败</p>
  return <ul>{data?.map((u: any) => <li key={u.id}>{u.name}</li>)}</ul>
}
```

📖 官方文档：https://tanstack.com/query/v5/docs/framework/react/overview

---

## Step 8：暗黑模式 — next-themes

> `next-themes` 也完全支持纯 React 项目，无需 Next.js。

```bash
pnpm add next-themes
```

#### 在根组件挂载 ThemeProvider

```tsx
// src/main.tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "next-themes"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import App from "./App"
import "./index.css"

const queryClient = new QueryClient()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
)
```

#### 切换主题

```tsx
import { useTheme } from "next-themes"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      切换主题
    </button>
  )
}
```

📖 官方文档：https://github.com/pacocoursey/next-themes

---

## Step 9：CodeMirror 6（按需安装）

仅在项目中需要代码编辑器功能时安装。

```bash
pnpm add @uiw/react-codemirror \
  @codemirror/lang-json \
  @codemirror/theme-one-dark \
  @codemirror/state \
  @codemirror/view \
  @codemirror/commands \
  @codemirror/search
```

### 基础用法

```tsx
import CodeMirror from "@uiw/react-codemirror"
import { json } from "@codemirror/lang-json"
import { oneDark } from "@codemirror/theme-one-dark"

export function JsonEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <CodeMirror
      value={value}
      extensions={[json()]}
      theme={oneDark}
      onChange={onChange}
    />
  )
}
```

📖 官方文档：https://uiwjs.github.io/react-codemirror/

---

## 一键安装命令（核心集合）

```bash
# 0. 创建项目
pnpm create vite@latest my-app -- --template react-ts
cd my-app && pnpm install

# 1. Tailwind CSS 4
pnpm add tailwindcss @tailwindcss/vite

# 2. 类名工具
pnpm add clsx tailwind-merge class-variance-authority

# 3. 路径别名依赖
pnpm add -D @types/node

# 4. shadcn/ui 初始化（会自动安装 Radix UI 依赖）
pnpm dlx shadcn@latest init

# 5. 图标 + 动画
pnpm add lucide-react motion

# 6. 状态管理
pnpm add zustand @tanstack/react-query @tanstack/react-query-devtools

# 7. 暗黑模式
pnpm add next-themes
```

---

## 易错包名速查表

| ✅ 正确包名 | ❌ 常见错误 | 备注 |
|---|---|---|
| `motion` | `framer-motion` | v11 起已更名，旧包仍可用但不推荐 |
| `import from "motion/react"` | `import from "framer-motion"` | import 路径也变了 |
| `@tanstack/react-query` | `react-query` | v4 之前的旧包，已废弃 |
| `@tanstack/react-virtual` | `react-virtual` | 旧包，已废弃 |
| `lucide-react` | `lucide` | 后者不含 React 绑定 |
| `sonner` | `react-sonner` | 不存在此包 |
| `class-variance-authority` | `cva` | 不存在此包 |
| `pnpm dlx shadcn@latest` | `npx shadcn-ui@latest` | shadcn-ui 包名已废弃 |
| `@tailwindcss/vite` | `@tailwindcss/postcss` | Vite 项目使用 vite 插件，不用 postcss 插件 |

---

## 参考文档

| 工具 | 文档地址 |
|---|---|
| Vite | https://vitejs.dev/guide/ |
| Tailwind CSS v4 (Vite) | https://tailwindcss.com/docs/guides/vite |
| Tailwind v4 主题配置 | https://tailwindcss.com/docs/theme |
| shadcn/ui 安装 (Vite) | https://ui.shadcn.com/docs/installation/vite |
| shadcn/ui 组件列表 | https://ui.shadcn.com/docs/components |
| shadcn/ui components.json | https://ui.shadcn.com/docs/components-json |
| Motion（动画） | https://motion.dev/docs/react-installation |
| Zustand | https://zustand.docs.pmnd.rs/getting-started/introduction |
| TanStack Query v5 | https://tanstack.com/query/v5/docs/framework/react/overview |
| next-themes | https://github.com/pacocoursey/next-themes |
| lucide-react | https://lucide.dev/guide/packages/lucide-react |
| CodeMirror React | https://uiwjs.github.io/react-codemirror/ |

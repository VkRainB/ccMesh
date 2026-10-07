# useCache.js —— 浏览器数据持久化通用封装说明

> 源码：[`./useCache.js`](./useCache.js)
> 依赖：`react`、`web-storage-cache@^1.x`
> 定位：**数据持久化层**（不是状态管理库）。目标是把「存什么、存哪、何时过期、多个组件怎么保持一致」四件事收敛到一处。

---

## 1. 为什么封装

`web-storage-cache` 本身只解决「localStorage/sessionStorage 带超时的读写」，它有若干短板：

| 短板 | 后果 | 本封装的解法 |
|---|---|---|
| 没有响应式 | A 组件改了缓存，B 组件不知道，得手动刷新 | Hook 层用「同页自定义事件 + 跨标签 `storage` 事件」同步 |
| 没有 React 集成 | 每个组件重复写 `useState + cache.get + cache.set` | `useCache(key, options)` 一行拿到响应式状态 |
| 命令式 API 零散 | 各处直接 `new WebStorageCache()`，key 散落 | 工具函数层 + `CACHE_KEY` 集中管理 |
| 存储不可用时行为不明 | 隐私模式/SSR 下直接抛错或静默失败 | 自动降级为内存 Map，语义一致 |

**一句话分工**：TTL（超时）交给 `web-storage-cache`，**响应式**交给 Hook 层。

---

## 2. 目录结构与导出清单

```js
// 常量
CACHE_TYPE          // { LOCAL: 'localStorage', SESSION: 'sessionStorage' }
CACHE_KEY           // { IS_DARK, USER, LANG, THEME, LAYOUT, ROLE_ROUTERS, DICT_CACHE }

// 实例
getCache(type?)     // 取（并缓存）wsCache 实例

// 工具函数（命令式，非 React 环境可用）
cacheSet(key, value, options?, type?)
cacheGet(key, fallback?, type?)
cacheHas(key, type?)
cacheRemove(key, type?)
cacheClear(type?)
cacheRemoveExpires(type?)
cacheTouch(key, exp, type?)

// Hook
useCache(key, options?)          // 响应式状态：[value, setValue, remove, refresh]
useCacheInstance(type?)          // 仅取原始实例：{ wsCache }
```

---

## 3. 快速上手

### 3.1 Hook 用法（组件内，推荐）

```jsx
import { CACHE_KEY, useCache } from '@/docs/plans/useCache'

function ThemeSwitch() {
  // 值直接持久化，默认 'light'
  const [theme, setTheme] = useCache(CACHE_KEY.THEME, { defaultValue: 'light' })

  return <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme}</button>
}

function LangPanel() {
  // 存对象 + 1 小时过期
  const [user, setUser, removeUser] = useCache(CACHE_KEY.USER, { defaultValue: null, exp: 3600 })

  useEffect(() => {
    setUser({ name: 'Wu', role: 'admin' })
  }, [])

  return <button onClick={removeUser}>清空</button>
}
```

要点：

- `setValue` 像 `useState` 的 setter：支持直接传值，也支持传函数 `(prev) => next`。
- 同一个 key 的多个组件**自动保持一致**（同页 + 跨标签页）。
- 对象、数组直接存，序列化由库完成。

### 3.2 工具函数用法（组件外 / 非 React）

```js
import { CACHE_KEY, cacheGet, cacheSet, cacheRemoveExpires } from '@/docs/plans/useCache'

// 在 axios / fetch 拦截器里存 token
cacheSet('token', token, { exp: 3600 })       // 1 小时后过期（数字单位：秒）
cacheGet('token', '')                         // 过期或不存在 → ''

// 也可以传 Date 作为绝对过期时间
cacheSet('license', data, { exp: new Date('2099-12-31') })

// 日常维护：只清过期项（推荐）
cacheRemoveExpires()
```

### 3.3 只想用原始库（兼容旧写法）

原来那种「传介质类型、拿实例」的写法保留为 `useCacheInstance`：

```js
import { useCacheInstance } from '@/docs/plans/useCache'

const { wsCache } = useCacheInstance('sessionStorage')
wsCache.set('token', 'xxx', { exp: 3600 })
wsCache.get('token')
```

> 迁移提示：原片段里的 `useCache(type) => { wsCache }` 已改名为 **`useCacheInstance`**（`useCache` 这个名字让给了响应式状态 Hook）。

---

## 4. 持久化方案说明

### 4.1 介质怎么选

| 介质 | 生命周期 | 适用数据 |
|---|---|---|
| `localStorage`（默认） | 永久，除非手动清 | 主题、语言、布局、用户偏好、字典缓存 |
| `sessionStorage` | 关闭标签页即失效 | 登录态临时令牌、单次流程的中间态 |
| 内存兜底（自动） | 刷新即失效 | 存储不可用时的降级，保证代码不崩 |

### 4.2 超时（TTL）语义

- **单位是秒**，不是毫秒：`{ exp: 3600 }` = 1 小时。
- 也支持 `Infinity`（永不过期，默认）和 `Date`（绝对时间点）。
- 读取时会自动清理「读到的那个已过期键」；`cacheRemoveExpires()` 批量清理全部过期项。
- 构造函数级默认超时用 `getCache` 之外的实例时才需要，本封装一律**在写入时传 `exp`**，避免隐式全局默认值（见 §6 的坑）。

### 4.3 数据在底层长什么样

`web-storage-cache` 会把你存的值包一层：

```js
// localStorage.getItem('theme') 的实际内容
'{"c":1730000000000,"e":1730003600000,"v":"\"dark\""}'
//  c = 写入时间戳，e = 过期时间戳，v = JSON 字符串化后的业务值
```

这带来一个使用上的好处：**key 是原样写入的（库没有默认前缀）**，所以用浏览器 DevTools 能直接按业务 key 查、也能被原生 `storage` 事件精确匹配——本封装的跨标签同步就依赖这一点。

### 4.4 多组件 / 多标签同步原理

```
组件 A: setValue('dark')
   └─> cacheSet() 写 storage
   └─> notifyChange() 派发 CustomEvent('web-storage-cache:change')
          ├─> 同页面其他 useCache(key) 实例：监听事件 → 重新 get → setState
          └─> （其他标签页）浏览器原生 'storage' 事件 → 重新 get → setState
```

为什么要自己发事件：**原生 `storage` 事件只在「其他」标签页触发，同一页面内不触发**，这是所有 storage hook 实现都要处理的经典问题（ahooks 也为此定义了 `AHOOKS_SYNC_STORAGE_EVENT_NAME`）。

---

## 5. 与「zustand + persist」的取舍

两者不是竞品，但同一份偏好数据只应选一种方案：

| | useCache（本文件） | zustand + persist |
|---|---|---|
| 定位 | 单键持久化 + 响应式 | 全局状态容器 + 可选持久化 |
| 心智 | 一个 key 一个 hook，就近声明 | 集中声明状态树，跨页面共享 |
| 适合 | 分散的、单键的偏好（主题、语言、token） | 关联字段多、跨页面读写频繁的 UI 状态 |
| 不适合 | 几十个 key 密集互相关联（会散） | 只有一两个键（杀鸡用牛刀） |

**判断标准**：数据是否「一个组件族内自洽、键之间无联动」→ 用 `useCache`；是否「多页面共享、字段之间要一起更新」→ 用 zustand persist。二者可以共存，但**同一个 key 不要既进 zustand 又进 useCache**，否则会互相覆盖。

---

## 6. 注意事项与已知坑

1. **`null` 与「不存在」不可区分**
   `get` 对「无此键」和「值为 null」都返回 `null`，所以本封装的 `cacheGet` 一律走 fallback。业务上不要依赖「存过 null」这个事实。

2. **`cacheClear()` 会误伤他人数据**
   底层是 `storage.clear()`，会把不是本库写入（甚至别人库写入）的键一起清掉。日常维护请用 `cacheRemoveExpires()`。

3. **`exp` 的构造函数选项是模块级全局的**
   `web-storage-cache` 的构造函数会把 `exp` 写进模块内变量作为**所有实例的默认过期时间**，存在隐式串扰。本封装的 `getCache()` 不传 `exp`，默认 `Infinity`，超时一律在 `set` 时显式给出。

4. **写入 `undefined` 等于删除**
   `cacheSet(key, undefined)` → 执行 `delete(key)`。需要存「空值」请用 `null` 之外的哨兵值（如 `''`、`0`）。

5. **容量与配额**
   localStorage 通常约 5MB，超出会抛 `QuotaExceededError`。库内部默认 `force: true`（先清过期项再重试），大对象（如字典缓存）建议配 `exp` 并定期 `cacheRemoveExpires()`。**不要**往里塞大 JSON（如接口全量响应），那属于 IndexedDB 或后端的活。

6. **SSR / 隐私模式**
   已在 `getCache()` 内兜底为内存 Map，`isSupported()` 返回 `false`。注意此时数据**不跨页面持久**，属于预期行为。

7. **不要存敏感明文**
   localStorage 可被同源脚本读取。token 至少配 `exp`，且优先放 `sessionStorage`；真正敏感的数据应由后端管理。（本库另有 `web-storage-cache-crypto` 做加密，本项目未引入。）

8. **`defaultValue` 建议用常量**
   `useCache` 的 `defaultValue` 会进依赖数组，内联写 `() => ({})` 这类函数会导致每轮渲染重建 `read`，进而反复重挂同步监听。写模块级常量即可。

---

## 7. 桌面端（Tauri）适配说明

本方案落在 **WebView 的 localStorage** 上，即：
- 数据存放在 WebView 的数据目录（Windows 一般是 `%LOCALAPPDATA%\<identifier>\EBWebView\...`），**清除应用数据会丢失**；
- 因此它适合**纯前端的 UI 偏好**，不适合作为业务数据的唯一来源。

建议的分层：

| 数据 | 存哪 |
|---|---|
| 主题 / 语言 / 布局 / 列表视图模式 | `useCache`（localStorage） |
| 登录态临时令牌 | `useCache`（sessionStorage） |
| 业务数据（端点、配置、会话、统计） | Tauri 命令 → 后端 SQLite |

如果将来希望 UI 偏好也落到 SQLite 或跨设备同步，改造点很小：实现一个同样满足 `get/set/delete` 语义的适配器替换 `getCache()` 内部实现即可，工具函数与 Hook 的调用方**无需改动**。

---

## 8. 最小接入步骤

```bash
# 1. 安装依赖（本项目若已用 pnpm）
pnpm add web-storage-cache

# 2. 把 useCache.js 放到 src/hooks/ 或 src/utils/ 下（当前位于 docs/plans，仅作方案稿）

# 3. 业务里按需引入
import { CACHE_KEY, useCache } from '@/hooks/useCache'
```

无需额外 Provider、无需初始化；首次调用时按需创建实例。

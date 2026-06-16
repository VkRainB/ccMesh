# Markdown 扩展示例

本页演示 VitePress 内置的部分 Markdown 扩展在 Paper-Blueprint-Manual 主题下的渲染效果。

## 语法高亮

VitePress 由 [Shiki](https://github.com/shikijs/shiki) 提供语法高亮，并支持行高亮等附加功能：

**输入**

````md
```js{4}
export default {
  data () {
    return {
      msg: 'Highlighted!'
    }
  }
}
```
````

**输出**

```js{4}
export default {
  data () {
    return {
      msg: 'Highlighted!'
    }
  }
}
```

## 代码组

::: code-group

```sh [npm]
$ npm add -D vitepress
```

```sh [pnpm]
$ pnpm add -D vitepress
```

```sh [yarn]
$ yarn add -D vitepress
```

```sh [bun]
$ bun add -D vitepress
```

:::

## 自定义容器

**输入**

```md
::: info
这是一条信息。
:::

::: tip
这是一个提示。
:::

::: warning
这是一条警告。
:::

::: danger
这是一个危险警告。
:::
```

**输出**

::: info
这是一条信息。
:::

::: tip
这是一个提示。
:::

::: warning
这是一条警告。
:::

::: danger
这是一个危险警告。
:::

## 表格

| 列 | 约定 | 示例 |
| --- | --- | --- |
| 任务编号 | upsert 主键 | `2028.1` |
| 多值字段 | 分号分隔 | `1;2;3` |
| 日期 | 绝对日期 | `2026-06-12` |

## 更多

查看 [Markdown 扩展](https://vitepress.dev/zh/guide/markdown) 文档获取完整列表。

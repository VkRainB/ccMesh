# 运行时 API 示例

本页演示 VitePress 提供的部分运行时 API 的使用方法。

主要的 `useData()` API 可以用于访问当前页面的站点、主题和页面数据，它在 `.md` 与 `.vue` 文件中都可以使用：

```md
<script setup>
import { useData } from 'vitepress'

const { theme, page, frontmatter } = useData()
</script>

## 结果

### Theme Data
<pre>{{ theme }}</pre>

### Page Data
<pre>{{ page }}</pre>

### Page Frontmatter
<pre>{{ frontmatter }}</pre>
```

<script setup>
import { useData } from 'vitepress'

const { site, theme, page, frontmatter } = useData()
</script>

## 结果

### Theme Data
<pre>{{ theme }}</pre>

### Page Data
<pre>{{ page }}</pre>

### Page Frontmatter
<pre>{{ frontmatter }}</pre>

## 更多

查看 [运行时 API](https://vitepress.dev/zh/reference/runtime-api) 文档获取完整列表。

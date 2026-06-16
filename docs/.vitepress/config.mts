import { defineConfig } from 'vitepress'

// https://vitepress.dev/zh/reference/site-config
export default defineConfig({
  lang: 'zh-CN',
  title: 'Doc Style',
  description: 'Paper-Blueprint-Manual 设计语言的 VitePress 主题示例',
  base: '/ccMesh/',
  // 本主题为亮色印刷版式（light-first），关闭暗色切换
  appearance: false,
  markdown: {
    // 代码块按 DESIGN.md 走深色锚点（墨蓝灰底），高亮配深色语法主题
    theme: 'github-dark'
  },
  themeConfig: {
    // https://vitepress.dev/zh/reference/default-theme-config
    nav: [
      { text: '首页', link: '/' },
      { text: '示例', link: '/markdown-examples' }
    ],
    sidebar: [
      {
        text: '示例',
        items: [
          { text: 'Markdown 示例', link: '/markdown-examples' },
          { text: '运行时 API 示例', link: '/api-examples' }
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/vuejs/vitepress' }
    ],
    outline: { label: '本页目录' },
    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdated: { text: '最后更新于' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单'
  }
})

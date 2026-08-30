import { defineConfig } from 'vitepress'
import { fetchReleaseDownloads, fetchReleaseVersion } from './fetch-version.mts'

const releaseVersion = await fetchReleaseVersion()
const releaseDownloads = await fetchReleaseDownloads(releaseVersion)

// https://vitepress.dev/zh/reference/site-config
export default defineConfig({
  lang: 'zh-CN',
  title: 'CC Mesh',
  description: '跨平台 AI 代理网关桌面应用 · 功能文档',
  base: '/ccMesh/',
  cleanUrls: true,
  lastUpdated: true,
  // 启用暗色/亮色模式切换：导航栏右侧按钮，配合 custom.css 中的 .dark 变量
  appearance: true,
  markdown: {
    // 代码块按 DESIGN.md 走深色锚点（墨蓝灰底），高亮配深色语法主题
    theme: 'github-dark'
  },
  head: [
    ['link', { rel: 'icon', href: '/ccMesh/screenshots/logo.png' }],
    ['meta', { name: 'keywords', content: 'CC Mesh,AI,代理网关,Claude,OpenAI,Codex,协议转换,端点轮换,熔断,Tauri,跨平台' }],
    ['meta', { name: 'author', content: 'VkRainB' }],
    ['meta', { name: 'robots', content: 'index, follow' }],
    ['meta', { property: 'og:site_name', content: 'CC Mesh' }],
    ['meta', { property: 'og:title', content: 'CC Mesh：跨平台 AI 代理网关' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:url', content: 'https://vkrainb.github.io/ccMesh/' }],
    ['meta', { property: 'og:image', content: 'https://vkrainb.github.io/ccMesh/screenshots/logo.png' }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
    ['meta', { name: 'twitter:title', content: 'CC Mesh：跨平台 AI 代理网关' }]
  ],
  themeConfig: {
    // https://vitepress.dev/zh/reference/default-theme-config
    releaseDownloads,
    logo: '/screenshots/logo.png',
    nav: [
      { text: '指南', link: '/guide/introduction' },
      { text: '功能', link: '/features/dashboard' },
      { text: '进阶', link: '/advanced/architecture' },
      {
        text: releaseVersion,
        items: [
          { text: '下载最新版', link: 'https://github.com/VkRainB/ccMesh/releases/latest' },
          { text: '更新日志', link: 'https://github.com/VkRainB/ccMesh/releases' }
        ]
      }
    ],
    sidebar: {
      '/guide/': [
        {
          text: '指南',
          items: [
            { text: '项目简介', link: '/guide/introduction' },
            { text: '安装', link: '/guide/installation' },
            { text: '快速入门', link: '/guide/quickstart' },
            { text: '核心概念', link: '/guide/concepts' },
            { text: '主题组件', link: '/guide/theme-components' }
          ]
        }
      ],
      '/features/': [
        {
          text: '功能',
          items: [
            { text: '仪表盘', link: '/features/dashboard' },
            { text: '端点管理', link: '/features/endpoints' },
            { text: '配置文件', link: '/features/config-profiles' },
            { text: '对话', link: '/features/chat' },
            { text: '会话管理', link: '/features/tool-sessions' },
            { text: '统计', link: '/features/statistics' },
            { text: '同步', link: '/features/sync' },
            { text: '日志', link: '/features/logs' },
            { text: '设置', link: '/features/settings' },
            { text: '精灵宠物', link: '/features/pet' },
            { text: '关于', link: '/features/about' }
          ]
        }
      ],
      '/advanced/': [
        {
          text: '架构与原理',
          items: [
            { text: '技术架构', link: '/advanced/architecture' },
            { text: '协议转换', link: '/advanced/protocol-transform' },
            { text: '轮换与熔断', link: '/advanced/rotation' }
          ]
        },
        {
          text: '构建与发布',
          items: [
            { text: '从源码构建', link: '/advanced/build-from-source' },
            { text: '自动更新', link: '/advanced/auto-update' }
          ]
        }
      ]
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/VkRainB/ccMesh' }
    ],
    outline: { label: '本页目录', level: [2, 3] },
    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdated: { text: '最后更新于' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    editLink: {
      pattern: 'https://github.com/VkRainB/ccMesh/edit/master/docs-site/:path',
      text: '在 GitHub 上编辑此页'
    },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '搜索文档' },
          modal: {
            displayDetails: '显示详细列表',
            resetButtonTitle: '清除查询',
            backButtonTitle: '返回',
            noResultsText: '没有结果',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' }
          }
        }
      }
    }
  }
})

import { defineConfig } from 'vitepress'
import { fetchReleaseVersion } from './fetch-version.mts'

const releaseVersion = await fetchReleaseVersion()

// https://vitepress.dev/zh/reference/site-config
export default defineConfig({
    lang: 'zh-CN',
    title: 'ccMesh',
    description: '轻量级跨平台 AI 代理网关桌面应用 · 功能文档',
    base: '/ccMesh/',
    // 本主题为亮色印刷版式（light-first），关闭暗色切换
    appearance: false,
    markdown: {
      // 代码块按 DESIGN.md 走深色锚点（墨蓝灰底），高亮配深色语法主题
      theme: 'github-dark'
    },
    themeConfig: {
      // https://vitepress.dev/zh/reference/default-theme-config
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
            text: '开始使用',
            items: [
              { text: '项目简介', link: '/guide/introduction' },
              { text: '安装', link: '/guide/installation' },
              { text: '快速使用指南（图文）', link: '/guide/quickstart' },
              { text: '快速上手', link: '/guide/getting-started' },
              { text: '核心概念', link: '/guide/concepts' }
            ]
          }
        ],
        '/features/': [
          {
            text: '功能详解',
            items: [
              { text: '仪表盘', link: '/features/dashboard' },
              { text: '端点管理', link: '/features/endpoints' },
              { text: '配置文件', link: '/features/config-profiles' },
              { text: '统计', link: '/features/statistics' },
              { text: '同步', link: '/features/sync' },
              { text: '设置', link: '/features/settings' }
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
      search: {
        provider: 'local'
      }
    }
})

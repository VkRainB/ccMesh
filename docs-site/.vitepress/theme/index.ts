// 扩展默认主题：叠加 PiDeck 视觉样式层 + 图片查看器（viewerjs）+ 导航栏 release 版本号
import DefaultTheme from 'vitepress/theme'
import type { EnhanceAppContext } from 'vitepress'
import { useRoute } from 'vitepress'
import { onMounted } from 'vue'
import imageViewer from 'vitepress-plugin-image-viewer'
import vImageViewer from 'vitepress-plugin-image-viewer/lib/vImageViewer.vue'
import { fetchReleaseVersion } from '../fetch-version.mts'
import 'viewerjs/dist/viewer.min.css'
import './custom.css'

function updateNavReleaseVersion(label: string) {
  document.querySelectorAll<HTMLElement>('.VPNavBarMenu .VPNavBarMenuLink').forEach((el) => {
    if (/^v\d+\.\d+\.\d+$/.test(el.textContent?.trim() ?? '')) {
      el.textContent = label
    }
  })
}

export default {
  extends: DefaultTheme,
  enhanceApp(ctx: EnhanceAppContext) {
    ctx.app.component('vImageViewer', vImageViewer)
  },
  setup() {
    const route = useRoute()

    onMounted(async () => {
      const version = await fetchReleaseVersion()
      updateNavReleaseVersion(version)
    })
    // 对正文区域 .vp-doc 内的图片启用点击放大（缩放 / 拖拽 / 旋转 / 全屏）
    // transition: false —— 关闭 viewerjs 的 CSS 过渡。其淡入/淡出依赖 transitionend
    // 回调来「完成显示并把图片放入 canvas / 卸载遮罩」，但该事件在本站环境下不会自动
    // 触发（需外部重排才被动完成），表现为点击后遮罩变灰、无图、无法关闭。改为同步显隐后即正常。
    imageViewer(route, '.vp-doc', { transition: false })
  }
}

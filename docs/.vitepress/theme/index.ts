// 扩展默认主题：叠加 Paper-Blueprint-Manual 样式层 + 图片查看器（viewerjs）
import DefaultTheme from 'vitepress/theme'
import type { EnhanceAppContext } from 'vitepress'
import { useRoute } from 'vitepress'
import imageViewer from 'vitepress-plugin-image-viewer'
import vImageViewer from 'vitepress-plugin-image-viewer/lib/vImageViewer.vue'
import 'viewerjs/dist/viewer.min.css'
import './style/custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp(ctx: EnhanceAppContext) {
    ctx.app.component('vImageViewer', vImageViewer)
  },
  setup() {
    const route = useRoute()
    // 对正文区域 .vp-doc 内的图片启用点击放大（缩放 / 拖拽 / 旋转 / 全屏）
    // transition: false —— 关闭 viewerjs 的 CSS 过渡。其淡入/淡出依赖 transitionend
    // 回调来「完成显示并把图片放入 canvas / 卸载遮罩」，但该事件在本站环境下不会自动
    // 触发（需外部重排才被动完成），表现为点击后遮罩变灰、无图、无法关闭。改为同步显隐后即正常。
    imageViewer(route, '.vp-doc', { transition: false })
  }
}

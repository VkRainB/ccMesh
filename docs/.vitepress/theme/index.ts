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
    imageViewer(route)
  }
}

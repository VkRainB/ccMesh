// 扩展默认主题：叠加 Paper-Blueprint-Manual 样式层 + 图片点击放大（medium-zoom）
import DefaultTheme from 'vitepress/theme'
import mediumZoom from 'medium-zoom'
import { onMounted, watch, nextTick } from 'vue'
import { useRoute } from 'vitepress'
import './style/custom.css'

export default {
  extends: DefaultTheme,
  setup() {
    const route = useRoute()

    const initZoom = () => {
      // 仅对正文区域的图片启用放大，跳过 logo / 图标等
      mediumZoom('.vp-doc img:not(.no-zoom)', {
        background: 'rgba(0, 0, 0, 0.7)',
        margin: 24
      })
    }

    onMounted(() => initZoom())
    watch(
      () => route.path,
      () => nextTick(() => initZoom())
    )
  }
}

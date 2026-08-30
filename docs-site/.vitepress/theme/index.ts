import DefaultTheme from 'vitepress/theme'
import type { EnhanceAppContext } from 'vitepress'
import { useRoute } from 'vitepress'
import { onMounted } from 'vue'
import imageViewer from 'vitepress-plugin-image-viewer'
import vImageViewer from 'vitepress-plugin-image-viewer/lib/vImageViewer.vue'
import { fetchReleaseVersion } from '../fetch-version.mts'
import HomeLanding from './HomeLanding.vue'
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
    ctx.app.component('HomeLanding', HomeLanding)
  },
  setup() {
    const route = useRoute()

    onMounted(async () => {
      const version = await fetchReleaseVersion()
      updateNavReleaseVersion(version)
    })
    imageViewer(route, '.vp-doc', { transition: false })
  }
}

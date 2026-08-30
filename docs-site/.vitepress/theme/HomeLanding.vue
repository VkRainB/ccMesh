<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useData, withBase } from 'vitepress'
import {
  assetUrlsFromTag,
  fetchReleaseDownloads,
  type PlatformKey,
  type ReleaseDownloads
} from '../fetch-version.mts'

const capsules = [
  { icon: 'play', title: '代理启停', text: '本机开关一键拉起或停下代理' },
  { icon: 'layers', title: '模型映射', text: '入站名与上游标识灵活对应' },
  { icon: 'pulse', title: '连通性测试', text: '端点卡片上直接探活与延迟' },
  { icon: 'shield', title: '轮换与熔断', text: '故障自动切下一跳，三态熔断' }
]

const features = [
  { icon: 'plug', title: '多协议统一接入', text: 'Claude / OpenAI / Codex 三类转换器' },
  { icon: 'shield', title: '轮换与熔断', text: '按模型过滤轮换，三态熔断器' },
  { icon: 'sliders', title: '渠道化配置', text: 'Claude Code settings.json 与 Codex auth.json' },
  { icon: 'chart', title: '用量统计与监控', text: '耗时、首字延迟、Token' },
  { icon: 'cloud', title: '同步与备份', text: '本地备份 / 恢复 / 导出 / WebDAV' },
  { icon: 'monitor', title: '跨平台桌面', text: 'Tauri 2 + Rust + React 19' }
]

const steps = [
  { icon: 'globe', title: '配端点', text: '在端点管理添加 claude / openai / codex，测通后点亮模型。' },
  { icon: 'toggle', title: '开代理', text: '仪表盘打开本地代理，默认端口 3000，状态变为运行中。' },
  { icon: 'terminal', title: '填本机地址', text: '客户端 Base URL 填 http://127.0.0.1:3000，密钥可留空。' },
  { icon: 'cube', title: '拉模型', text: '从网关拉取对外模型，选中后即可对话并在仪表盘看请求。' }
]

const downloads = [
  { os: 'windows' as const, icon: 'windows', name: 'Windows', hint: 'setup.exe / MSI', primary: true },
  { os: 'macos' as const, icon: 'macos', name: 'macOS', hint: '未签名，请右键打开', primary: false },
  { os: 'linux' as const, icon: 'linux', name: 'Linux', hint: 'AppImage / deb / rpm', primary: true }
]

const FALLBACK_TAG = 'v0.2.5'
const { theme } = useData()
const baked = (theme.value as { releaseDownloads?: ReleaseDownloads }).releaseDownloads
const pack = ref<ReleaseDownloads>(
  baked ?? {
    version: FALLBACK_TAG,
    tagUrl: `https://github.com/VkRainB/ccMesh/releases/tag/${FALLBACK_TAG}`,
    urls: assetUrlsFromTag(FALLBACK_TAG)
  }
)

function hrefFor(os: PlatformKey) {
  return pack.value.urls[os] || assetUrlsFromTag(pack.value.version)[os]
}

async function onDownload(e: MouseEvent, os: PlatformKey) {
  if (pack.value.urls[os]) return
  e.preventDefault()
  pack.value = await fetchReleaseDownloads(pack.value.version)
  window.location.href = hrefFor(os)
}

function shot(name: string) {
  return withBase(`/screenshots/landing/${name}`)
}

onMounted(() => {
  fetchReleaseDownloads().then((d) => {
    pack.value = d
  })
})
</script>

<template>
  <div class="landing">
    <section class="hero" id="hero">
      <div class="hero-copy">
        <p class="eyebrow">LOCAL AI PROXY GATEWAY</p>
        <h1>跨平台 AI 代理网关</h1>
        <p class="lead">
          在本机统一接入 Claude / OpenAI / Codex,<br />
          协议转换 · 模型映射 · 轮换熔断 · 请求统计。<br />
          不改客户端配置即可切换上游。
        </p>
        <div class="cta">
          <a class="btn btn-primary" :href="withBase('/guide/quickstart')">快速入门</a>
          <a class="btn btn-outline" :href="withBase('/guide/introduction')">项目简介</a>
        </div>
        <ul class="platform-row">
          <li v-for="d in downloads" :key="d.os">
            <a
              class="plat"
              :href="hrefFor(d.os)"
              @click="onDownload($event, d.os)"
            >
              <img class="ico" :src="withBase(`/icons/${d.icon}.svg`)" alt="" />
              <span>{{ d.name }}</span>
            </a>
          </li>
          <li>
            <span class="chip">
              <img class="ico" :src="withBase('/icons/apache.svg')" alt="" />
              <span>Apache-2.0</span>
            </span>
          </li>
          <li>
            <span class="chip">
              <img class="ico" :src="withBase('/icons/tauri.svg')" alt="" />
              <span>Tauri 2</span>
            </span>
          </li>
        </ul>
      </div>
      <figure class="hero-shot">
        <img :src="shot('hero-dashboard-3d.png')" alt="CC Mesh 仪表盘" />
      </figure>
    </section>

    <section class="block" id="product">
      <p class="eyebrow">产品界面</p>
      <h2>全局视角，轻松掌控</h2>
      <p class="sub">端点管理 · 会话管理 · 配置文件 · 统计</p>
      <div class="product-windows">
        <figure class="app-window">
          <img :src="shot('product-endpoints.png')" alt="端点管理" />
        </figure>
        <figure class="app-window">
          <img :src="shot('product-sessions.png')" alt="会话管理" />
        </figure>
        <figure class="app-window">
          <img :src="shot('product-profiles.png')" alt="配置文件" />
        </figure>
        <figure class="app-window">
          <img :src="shot('product-statistics.png')" alt="统计" />
        </figure>
      </div>
      <ul class="capsules">
        <li v-for="c in capsules" :key="c.title">
          <img class="ico" :src="withBase(`/icons/${c.icon}.svg`)" alt="" />
          <div>
            <strong>{{ c.title }}</strong>
            <span>{{ c.text }}</span>
          </div>
        </li>
      </ul>
    </section>

    <section class="block" id="features">
      <h2>核心能力</h2>
      <p class="sub">一个本机网关，统一多上游。</p>
      <div class="feat-split">
        <figure class="protocol-fig">
          <img :src="shot('protocol-shunt.png')" alt="客户端经网关分流到上游服务商" />
        </figure>
        <ul class="feat-tiles">
          <li v-for="f in features" :key="f.title">
            <span class="feat-icon">
              <img class="ico" :src="withBase(`/icons/${f.icon}.svg`)" alt="" />
            </span>
            <div>
              <strong>{{ f.title }}</strong>
              <p>{{ f.text }}</p>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <section class="block" id="start">
      <h2>四步接入</h2>
      <ol class="step-grid">
        <li v-for="(s, i) in steps" :key="s.title">
          <div class="step-head">
            <span class="step-n">{{ i + 1 }}</span>
            <img class="ico" :src="withBase(`/icons/${s.icon}.svg`)" alt="" />
          </div>
          <strong>{{ s.title }}</strong>
          <p>{{ s.text }}</p>
        </li>
      </ol>
      <div class="dl-grid">
        <article v-for="d in downloads" :key="d.name">
          <img class="ico ico-lg" :src="withBase(`/icons/${d.icon}.svg`)" alt="" />
          <div>
            <h3>{{ d.name }}</h3>
            <p>{{ d.hint }}</p>
          </div>
            <a
              :class="['btn', d.primary ? 'btn-primary' : 'btn-outline']"
              :href="hrefFor(d.os)"
              @click="onDownload($event, d.os)"
            >下载</a>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.landing {
  max-width: 1120px;
  margin: 0 auto;
  padding: 28px 32px 56px;
  overflow: visible;
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--cc-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  gap: 20px;
  align-items: center;
  padding: 28px 0 48px;
  overflow: visible;
}

.hero h1,
.block h2 {
  margin: 0 0 12px;
  color: var(--cc-dark);
  font-size: 36px;
  font-weight: 760;
  letter-spacing: -0.03em;
  line-height: 1.15;
}

#start h2 {
  margin-bottom: 28px;
}

.lead,
.sub {
  margin: 0 0 20px;
  color: var(--cc-muted);
  font-size: 14px;
  line-height: 1.7;
  max-width: 28rem;
}

.cta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 650;
  text-decoration: none;
}

.btn-primary {
  background: var(--cc-primary);
  color: #fff;
}

.btn-outline {
  background: var(--cc-card);
  color: var(--cc-primary-deep);
  border: 1px solid var(--cc-primary);
}

.ico {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  display: block;
  object-fit: contain;
}

.ico-lg {
  width: 22px;
  height: 22px;
  flex-basis: 22px;
}

.platform-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  list-style: none;
  padding: 0;
  margin: 22px 0 0;
  color: var(--cc-text);
  font-size: 12px;
}

.platform-row li {
  display: inline-flex;
}

.plat,
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--cc-border);
  border-radius: 8px;
  background: var(--cc-surface);
  color: var(--cc-text);
  line-height: 1;
  text-decoration: none;
}

.plat {
  cursor: pointer;
}

.plat:hover {
  background: #fff;
  border-color: #d1d5db;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}

.plat:focus-visible {
  outline: 2px solid var(--cc-primary);
  outline-offset: 2px;
}

.plat .ico,
.chip .ico,
.platform-row svg {
  color: #6b7280;
}

.app-window {
  margin: 0;
  background: var(--cc-card);
  border: 1px solid var(--cc-border);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--cc-shadow-window);
}

.hero-shot {
  margin: 0;
  min-width: 0;
  border-radius: 12px;
  overflow: hidden;
}

.app-window img,
.hero-shot img {
  display: block;
  width: 100%;
  height: auto;
  border: 0;
  object-fit: contain;
}

.block {
  padding: 36px 0;
}

.block h2,
.block .eyebrow,
.block .sub {
  text-align: center;
  margin-left: auto;
  margin-right: auto;
}

.product-windows {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 22px;
}

.capsules {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  list-style: none;
  padding: 0;
  margin: 18px 0 0;
}

.capsules li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 14px 16px;
  border: 1px solid var(--cc-border);
  border-radius: 12px;
  background: var(--cc-card);
}

.capsules strong,
.feat-tiles strong,
.step-grid strong {
  display: block;
  color: var(--cc-text);
  font-size: 14px;
}

.capsules span,
.feat-tiles p,
.step-grid p {
  display: block;
  margin: 2px 0 0;
  color: var(--cc-muted);
  font-size: 12px;
  line-height: 1.45;
}

.feat-split {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
  gap: 20px;
  align-items: center;
}

.protocol-fig {
  margin: 0;
  border: 0;
  background: transparent;
  border-radius: 12px;
  overflow: hidden;
}

.protocol-fig img {
  display: block;
  width: 100%;
  height: auto;
  border: 0;
}

.feat-tiles {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  list-style: none;
  padding: 0;
  margin: 0;
}

.feat-tiles li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--cc-border);
  border-radius: 10px;
  background: var(--cc-card);
}

.feat-tiles li > div {
  min-width: 0;
}

.feat-tiles strong {
  line-height: 18px;
}

.feat-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  display: grid;
  place-items: center;
}

.feat-icon .ico {
  width: 18px;
  height: 18px;
  flex-basis: 18px;
}

.step-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  list-style: none;
  padding: 0;
  margin: 0;
}

.step-grid li {
  padding: 16px 18px;
  border: 1px solid var(--cc-border);
  border-radius: 12px;
  background: var(--cc-card);
}

.step-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.step-n {
  width: 25px;
  height: 25px;
  border-radius: 999px;
  background: var(--cc-primary);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: grid;
  place-items: center;
}

.dl-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 22px;
}

.dl-grid article {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  border: 1px solid var(--cc-border);
  border-radius: 10px;
  background: var(--cc-card);
  padding: 12px 14px;
}

.dl-grid article > div {
  min-width: 0;
  flex: 1;
}

.dl-grid h3 {
  margin: 0;
  font-size: 15px;
}

.dl-grid p {
  margin: 2px 0 0;
  color: var(--cc-muted);
  font-size: 12px;
}

.dl-grid .btn {
  flex: 0 0 auto;
  min-height: 32px;
  padding: 0 12px;
}

@media (max-width: 960px) {
  .hero,
  .product-windows,
  .feat-split,
  .feat-tiles,
  .step-grid,
  .capsules,
  .dl-grid {
    grid-template-columns: 1fr;
  }

  .hero h1,
  .block h2 {
    font-size: 28px;
  }

  .landing {
    padding: 18px 18px 40px;
  }

  .protocol-fig {
    max-width: 520px;
    margin: 0 auto;
  }
}
</style>

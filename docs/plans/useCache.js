/**
 * useCache.js —— 通用浏览器数据持久化封装（ES6 / ESM）
 *
 * 组成：
 *   1. 工具函数层：cacheGet / cacheSet / cacheRemove ...（非 React 环境可用，命令式）
 *   2. Hook 层：useCache（组件内响应式状态）/ useCacheInstance（仅取原始 wsCache 实例）
 *
 * 依赖：react、web-storage-cache@1.x
 *
 * 设计要点：
 *   - 超时（TTL）交给 web-storage-cache：`exp` 单位是【秒】，支持 Infinity / Date / 数字。
 *   - 响应式交给 Hook：web-storage-cache 没有订阅能力，本文件用「同页自定义事件 + 跨标签 storage 事件」
 *     让同一 key 的多个组件自动保持一致。
 *   - 无 window（SSR / 存储被禁用 / 隐私模式）时自动降级为内存 Map，调用方无需判空。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WebStorageCache from 'web-storage-cache'

/* ------------------------------------------------------------------ *
 * 常量
 * ------------------------------------------------------------------ */

/** 存储介质类型 */
export const CACHE_TYPE = {
  LOCAL: 'localStorage',
  SESSION: 'sessionStorage',
}

/** 项目统一缓存键，避免魔法字符串散落各处 */
export const CACHE_KEY = {
  IS_DARK: 'isDark',
  USER: 'user',
  LANG: 'lang',
  THEME: 'theme',
  LAYOUT: 'layout',
  ROLE_ROUTERS: 'roleRouters',
  DICT_CACHE: 'dictCache',
}

/**
 * 同页面跨组件同步用的事件名。
 * 注意：原生 `storage` 事件只在【其他】标签页触发，同页面不触发，所以必须自带一个事件。
 */
const CACHE_SYNC_EVENT = 'web-storage-cache:change'

/* ------------------------------------------------------------------ *
 * 实例管理 + 无存储环境兜底
 * ------------------------------------------------------------------ */

/** 每种介质只创建一个实例，避免重复构造（构造函数会改写库内部的默认过期时间）。 */
const cachePool = new Map()

/**
 * 内存兜底实现：语义与 WebStorageCache 对齐（含 exp 过期），
 * 用于 SSR / 隐私模式 / 存储被禁用等场景，保证上层代码零判空。
 */
function createMemoryCache() {
  const store = new Map()

  const readItem = (key) => {
    const item = store.get(key)
    if (!item) return null
    if (item.e !== Infinity && Date.now() >= item.e) {
      store.delete(key)
      return null
    }
    return item
  }

  const toExpireAt = (exp) => {
    if (exp === undefined || exp === null) return Infinity
    if (exp instanceof Date) return exp.getTime()
    if (exp === Infinity) return Infinity
    return Date.now() + Number(exp) * 1000
  }

  return {
    isSupported: () => false,
    set(key, value, options) {
      if (value === undefined) return this.delete(key)
      const exp = typeof options === 'number' ? options : options && options.exp
      store.set(String(key), { v: value, e: toExpireAt(exp) })
      return value
    },
    get(key) {
      const item = readItem(String(key))
      return item ? item.v : null
    },
    delete(key) {
      store.delete(String(key))
      return key
    },
    touch(key, exp) {
      const item = readItem(String(key))
      if (!item) return false
      store.set(String(key), { v: item.v, e: toExpireAt(exp) })
      return true
    },
    deleteAllExpires() {
      const removed = []
      store.forEach((_v, k) => {
        if (!readItem(k)) removed.push(k)
      })
      return removed
    },
    clear() {
      store.clear()
    },
  }
}

/**
 * 获取（并缓存）指定介质的 wsCache 实例。
 * @param {'localStorage'|'sessionStorage'} [type='localStorage']
 * @returns {WebStorageCache} 存储不可用时返回内存兜底实例
 */
export function getCache(type = CACHE_TYPE.LOCAL) {
  if (!cachePool.has(type)) {
    let supported = false
    try {
      supported = typeof window !== 'undefined' && Boolean(window[type])
    } catch (_e) {
      supported = false
    }
    cachePool.set(type, supported ? new WebStorageCache({ storage: type }) : createMemoryCache())
  }
  return cachePool.get(type)
}

/** 广播变更，触发同页面其他组件的同步（key 为 null 表示「全部失效」） */
function notifyChange(key, type) {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(new CustomEvent(CACHE_SYNC_EVENT, { detail: { key, type } }))
}

/* ------------------------------------------------------------------ *
 * 工具函数层（命令式，组件外可用）
 * ------------------------------------------------------------------ */

/**
 * 写入缓存，可直接存对象 / 数组（库内部自动 JSON 序列化）。
 * @param {string} key
 * @param {*} value 传 undefined 等价于删除
 * @param {number|Date|{exp?: number|Date, force?: boolean}} [options]
 *        数字/Date 表示超时（数字单位：秒）；force 表示超容量时先清理过期项再重试
 * @param {'localStorage'|'sessionStorage'} [type='localStorage']
 * @returns {*} 写入的值，便于链式使用
 */
export function cacheSet(key, value, options, type = CACHE_TYPE.LOCAL) {
  getCache(type).set(key, value, options)
  notifyChange(key, type)
  return value
}

/**
 * 读取缓存；键不存在或已过期时返回 fallback。
 * @param {string} key
 * @param {*} [fallback] 兜底值，可为函数（惰性求值）
 * @param {'localStorage'|'sessionStorage'} [type='localStorage']
 */
export function cacheGet(key, fallback = undefined, type = CACHE_TYPE.LOCAL) {
  const value = getCache(type).get(key)
  if (value !== null) return value
  return typeof fallback === 'function' ? fallback() : fallback
}

/** 是否存在且未过期 */
export function cacheHas(key, type = CACHE_TYPE.LOCAL) {
  return getCache(type).get(key) !== null
}

/** 删除单个键，返回被删除的 key */
export function cacheRemove(key, type = CACHE_TYPE.LOCAL) {
  getCache(type).delete(key)
  notifyChange(key, type)
  return key
}

/**
 * 清空该介质下的全部键。
 * 注意：底层调用 storage.clear()，会一并清掉不是本库写入的数据，谨慎使用。
 */
export function cacheClear(type = CACHE_TYPE.LOCAL) {
  getCache(type).clear()
  notifyChange(null, type)
}

/** 只清理已过期的键（推荐用它做日常维护，返回被清理的 key 列表） */
export function cacheRemoveExpires(type = CACHE_TYPE.LOCAL) {
  const removed = getCache(type).deleteAllExpires()
  notifyChange(null, type)
  return removed
}

/**
 * 以当前时间为基准，为已存在且未过期的键重设超时。
 * @param {number|Date} exp 秒 或 Date
 */
export function cacheTouch(key, exp, type = CACHE_TYPE.LOCAL) {
  const ok = getCache(type).touch(key, exp)
  if (ok) notifyChange(key, type)
  return ok
}

/* ------------------------------------------------------------------ *
 * Hook 层
 * ------------------------------------------------------------------ */

/**
 * 仅获取原始 wsCache 实例（命令式用法，等价于直接使用 web-storage-cache）。
 * 实例全局复用，引用稳定，可安全放入依赖数组。
 *
 * @param {'localStorage'|'sessionStorage'} [type='localStorage']
 * @returns {{ wsCache: WebStorageCache }}
 *
 * @example
 * const { wsCache } = useCacheInstance('sessionStorage')
 * wsCache.set('token', 'xxx', { exp: 3600 })
 */
export function useCacheInstance(type = CACHE_TYPE.LOCAL) {
  return useMemo(() => ({ wsCache: getCache(type) }), [type])
}

/**
 * 响应式缓存状态：像 useState 一样用，但值会持久化到浏览器存储，并支持超时。
 *
 * @param {string} key 缓存键（建议取自 CACHE_KEY）
 * @param {object} [options]
 * @param {*} [options.defaultValue] 无缓存时的初始值，可为函数
 * @param {number|Date} [options.exp] 本 hook 写入时的默认超时（数字单位：秒）
 * @param {boolean} [options.sync=true] 是否开启多组件 / 多标签同步
 * @param {'localStorage'|'sessionStorage'} [options.type='localStorage']
 * @returns {[*, Function, Function, Function]} [value, setValue, remove, refresh]
 *   - setValue(next, options?)：next 可为值或 (prev) => next；options 覆盖 exp/force
 *   - remove()：删除缓存并回落到 defaultValue
 *   - refresh()：重新从存储读取（用于手动对账）
 *
 * @example
 * import { CACHE_KEY, useCache } from './useCache'
 *
 * const [theme, setTheme] = useCache(CACHE_KEY.THEME, { defaultValue: 'light' })
 * setTheme('dark')                    // 立即重渲染，并写入 localStorage
 *
 * const [user, setUser] = useCache(CACHE_KEY.USER, { defaultValue: null, exp: 3600 })
 * setUser({ name: 'Wu' })             // 直接存对象，1 小时后自动过期
 */
export function useCache(key, options = {}) {
  const {
    type = CACHE_TYPE.LOCAL,
    defaultValue,
    exp,
    sync = true,
  } = options

  const read = useCallback(
    () => cacheGet(key, defaultValue, type),
    [key, type, defaultValue],
  )

  const [value, setValue] = useState(read)

  /** 标记「本次事件由自己写入触发」，避免把自己的值换成反序列化后的新引用。 */
  const selfWrite = useRef(false)

  // 同页面：自定义事件；跨标签：原生 storage 事件
  useEffect(() => {
    if (!sync || typeof window === 'undefined') return undefined

    const onLocalChange = (event) => {
      const detail = event.detail
      const isSelf = selfWrite.current
      if (isSelf) selfWrite.current = false
      if (!detail || detail.type !== type) return
      if (detail.key !== null && detail.key !== key) return
      if (isSelf) return
      setValue(read())
    }

    const onStorageChange = (event) => {
      const area = type === CACHE_TYPE.SESSION ? window.sessionStorage : window.localStorage
      if (event.storageArea && event.storageArea !== area) return
      if (event.key !== null && event.key !== key) return
      setValue(read())
    }

    window.addEventListener(CACHE_SYNC_EVENT, onLocalChange)
    window.addEventListener('storage', onStorageChange)
    return () => {
      window.removeEventListener(CACHE_SYNC_EVENT, onLocalChange)
      window.removeEventListener('storage', onStorageChange)
    }
  }, [key, type, sync, read])

  const set = useCallback(
    (next, writeOptions) => {
      const prev = read()
      const resolved = typeof next === 'function' ? next(prev) : next
      const finalOptions =
        writeOptions === undefined && exp !== undefined ? { exp } : writeOptions
      selfWrite.current = true
      cacheSet(key, resolved, finalOptions, type)
      selfWrite.current = false
      setValue(resolved)
      return resolved
    },
    [key, type, exp, read],
  )

  const remove = useCallback(() => {
    selfWrite.current = true
    cacheRemove(key, type)
    selfWrite.current = false
    setValue(read())
  }, [key, type, read])

  const refresh = useCallback(() => {
    const next = read()
    setValue(next)
    return next
  }, [read])

  return [value, set, remove, refresh]
}

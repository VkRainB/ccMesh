//! 代理决策与 HTTP client 构建：统一「转发 / 获取模型 / 测试 / 更新」的代理判定。
//!
//! 真值表（地址非空时）：转发/获取模型 `proxy = use_proxy || proxy_enabled`；
//! 更新 `proxy = proxy_for_update`。地址为空 → 一律直连。

use std::time::Duration;

use crate::error::{AppError, AppResult};

/// 转发 / 获取模型是否走代理：端点 `use_proxy` 或全局 `proxy_enabled`，且代理地址非空。
pub fn should_use_proxy(use_proxy: bool, proxy_enabled: bool, proxy_url: &str) -> bool {
    (use_proxy || proxy_enabled) && !proxy_url.trim().is_empty()
}

/// 应用更新是否走代理：`proxy_for_update` 且代理地址非空。
pub fn should_proxy_update(proxy_for_update: bool, proxy_url: &str) -> bool {
    proxy_for_update && !proxy_url.trim().is_empty()
}

/// 构建 reqwest client：`want_proxy` 且地址有效 → 经代理；否则显式直连（`no_proxy`，忽略系统环境代理）。
/// 地址无效时 warn 后回落直连（不再静默）。
/// ponytail: 用 `read_timeout`（每次读重置的空闲超时）而非 `.timeout()`（总时长）——
/// 后者会截断流式 SSE 长任务（issue #13）。短请求（models/endpoint/importer）空闲与总时长等价；
/// 长流式（chat）正是需要空闲语义的场景。
pub fn build_client(
    want_proxy: bool,
    proxy_url: &str,
    timeout: Duration,
) -> AppResult<reqwest::Client> {
    let mut b = reqwest::Client::builder().read_timeout(timeout);
    let url = proxy_url.trim();
    if want_proxy && !url.is_empty() {
        match reqwest::Proxy::all(url) {
            Ok(p) => b = b.proxy(p),
            Err(e) => {
                tracing::warn!("代理地址无效，回落直连: {e}");
                b = b.no_proxy();
            }
        }
    } else {
        b = b.no_proxy();
    }
    b.build()
        .map_err(|e| AppError::Proxy(format!("构建 HTTP 客户端失败: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn use_proxy_truth_table() {
        // 地址空 → 永远直连
        assert!(!should_use_proxy(true, true, ""));
        assert!(!should_use_proxy(true, false, "   "));
        // 端点开 或 全局开 → 走代理
        assert!(should_use_proxy(true, false, "http://p"));
        assert!(should_use_proxy(false, true, "http://p"));
        assert!(should_use_proxy(true, true, "http://p"));
        // 都关 → 直连
        assert!(!should_use_proxy(false, false, "http://p"));
    }

    #[test]
    fn proxy_update_truth_table() {
        assert!(should_proxy_update(true, "http://p"));
        assert!(!should_proxy_update(false, "http://p"));
        assert!(!should_proxy_update(true, ""));
        assert!(!should_proxy_update(true, "   "));
    }

    #[test]
    fn build_client_succeeds_in_all_modes() {
        assert!(build_client(true, "http://127.0.0.1:7890", Duration::from_secs(5)).is_ok());
        assert!(build_client(false, "", Duration::from_secs(5)).is_ok());
        // 无效地址回落直连仍能构建
        assert!(build_client(true, "http://", Duration::from_secs(5)).is_ok());
    }

    // issue #13：read_timeout 是空闲超时——服务器接受连接但不回响应头时，
    // 200ms 内必须超时返回。证明 read_timeout 覆盖等响应头阶段（不只是 body 读取）。
    #[tokio::test]
    async fn read_timeout_fires_when_upstream_silent() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        // 接受连接后保持 socket 打开但不写任何字节，撑到测试结束
        tokio::spawn(async move {
            let (sock, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(2)).await;
            drop(sock);
        });
        let client = build_client(false, "", Duration::from_millis(200)).unwrap();
        let result = client.get(format!("http://127.0.0.1:{port}/")).send().await;
        let err = result.expect_err("静默上游应触发 read_timeout");
        assert!(err.is_timeout(), "应为超时错误: {err}");
    }

    // issue #13：read_timeout 每次读重置——服务器分片写 body，每片间隔 100ms（< 150ms 空闲），
    // 总时长约 200ms（> 150ms）。若 read_timeout 是总时长语义会在 150ms 处截断；
    // 能完整读出 "abc" 即证明是空闲语义（每次读重置计时）。
    #[tokio::test]
    async fn read_timeout_resets_per_chunk_allows_slow_stream() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            // 读掉客户端发来的 GET 请求行（内核缓冲，不影响后续写响应）
            let mut buf = [0u8; 1024];
            let _ = sock.read(&mut buf).await;
            // 写响应头 + 第一个字节
            sock.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\na")
                .await
                .unwrap();
            tokio::time::sleep(Duration::from_millis(100)).await;
            sock.write_all(b"b").await.unwrap();
            tokio::time::sleep(Duration::from_millis(100)).await;
            sock.write_all(b"c").await.unwrap();
        });
        let client = build_client(false, "", Duration::from_millis(150)).unwrap();
        let resp = client
            .get(format!("http://127.0.0.1:{port}/"))
            .send()
            .await
            .expect("响应头应快速到达");
        let text = resp.text().await.expect("分片 body 应在空闲超时内读完");
        assert_eq!(text, "abc");
    }
}

use std::sync::Mutex;
use std::time::Duration;

/// 瞬时网络错误的重试延迟（重试同一端点）。
pub const TRANSIENT_RETRY_DELAY: Duration = Duration::from_millis(300);
/// 同一端点连续失败达到此次数后切换到下一个端点。
pub const CONSECUTIVE_FAIL_SWITCH: u32 = 2;

/// 线程安全的轮换器：维护当前端点索引。
#[derive(Default)]
pub struct Rotation {
    current: Mutex<usize>,
}

impl Rotation {
    pub fn new() -> Self {
        Self {
            current: Mutex::new(0),
        }
    }

    /// 当前索引（对 n 取模防越界）。n == 0 返回 None。
    pub fn current_index(&self, n: usize) -> Option<usize> {
        if n == 0 {
            return None;
        }
        let mut g = self.current.lock().unwrap();
        *g %= n;
        Some(*g)
    }

    /// 前进到下一个端点：`old = cur % n; cur = (old + 1) % n`。返回新索引。
    pub fn advance(&self, n: usize) -> Option<usize> {
        if n == 0 {
            return None;
        }
        let mut g = self.current.lock().unwrap();
        let old = *g % n;
        *g = (old + 1) % n;
        Some(*g)
    }

    /// 手动设置当前索引（按端点名定位后由调用方传入）。
    pub fn set_index(&self, idx: usize) {
        *self.current.lock().unwrap() = idx;
    }
}

/// 最大重试次数 = 启用端点数 × 2（Token Pool 额外重试在本项目 Out of Scope）。
pub fn max_retries(enabled_count: usize) -> usize {
    enabled_count.saturating_mul(2)
}

/// HTTP 状态是否应重试「下一个」端点：除 200 / 400 / 401 外都重试。
pub fn should_retry_status(status: u16) -> bool {
    !matches!(status, 200 | 400 | 401)
}

/// 一次尝试结果对熔断器的归类。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// 可重试故障（5xx/429/网络错误等）：计入熔断失败。
    Retryable,
    /// 不计熔断（客户端错误 / 未知入站 path 的 404）：中性，仅释放半开许可。
    NonRetryable,
}

/// 客户端错误状态码（请求本身的问题，不应污染端点熔断）。
fn is_client_error(status: u16) -> bool {
    matches!(status, 400 | 401 | 405 | 406 | 413 | 414 | 415 | 422)
}

/// 已知业务入站 path（与 url_normalize / 入站启发式对齐）。
/// ponytail: 硬编码清单；漏加新业务 path 会将其 404 误标中性。升级=与 url_normalize 共用常量。
fn is_known_business_path(path: &str) -> bool {
    const KNOWN: &[&str] = &[
        "/v1/messages",
        "/v1/chat/completions",
        "/v1/responses",
        "/v1/models",
        "/v1/images/generations",
        "/v1/images/edits",
    ];
    // 代理根挂载：精确匹配即可；ends_with 会把 /evil/v1/messages 误判为已知。
    let lower = path.trim_end_matches('/').to_ascii_lowercase();
    KNOWN.iter().any(|k| lower == *k)
}

/// 按状态码 + 入站 path 归类熔断结果（200 由调用方单独处理；此处用于非 200）。
/// 未知入站 path 的 404 视为扫描/误配，记中性；已知业务 path 的 404 仍计失败。
pub fn categorize_status(status: u16, inbound_path: &str) -> Outcome {
    if is_client_error(status) {
        Outcome::NonRetryable
    } else if status == 404 && !is_known_business_path(inbound_path) {
        Outcome::NonRetryable
    } else {
        Outcome::Retryable
    }
}

/// 是否瞬时网络错误（重试「同一」端点 + 300ms 延迟）。
pub fn is_transient_network_error(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("eof")
        || m.contains("timeout awaiting response headers")
        || m.contains("i/o timeout")
        || m.contains("connection reset by peer")
        || m.contains("timed out")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advance_wraps_modulo_n() {
        let r = Rotation::new();
        assert_eq!(r.current_index(3), Some(0));
        assert_eq!(r.advance(3), Some(1));
        assert_eq!(r.advance(3), Some(2));
        assert_eq!(r.advance(3), Some(0)); // wrap
    }

    #[test]
    fn current_index_handles_shrunk_list() {
        let r = Rotation::new();
        r.set_index(5);
        assert_eq!(r.current_index(3), Some(2)); // 5 % 3
    }

    #[test]
    fn zero_endpoints_yields_none() {
        let r = Rotation::new();
        assert_eq!(r.current_index(0), None);
        assert_eq!(r.advance(0), None);
    }

    #[test]
    fn max_retries_is_double() {
        assert_eq!(max_retries(3), 6);
        assert_eq!(max_retries(0), 0);
    }

    #[test]
    fn status_retry_classification() {
        assert!(!should_retry_status(200));
        assert!(!should_retry_status(400));
        assert!(!should_retry_status(401));
        assert!(should_retry_status(403));
        assert!(should_retry_status(429));
        assert!(should_retry_status(500));
        assert!(should_retry_status(502));
    }

    #[test]
    fn transient_error_detection() {
        assert!(is_transient_network_error("unexpected EOF"));
        assert!(is_transient_network_error("connection reset by peer"));
        assert!(is_transient_network_error("request timed out"));
        assert!(!is_transient_network_error("400 Bad Request"));
    }

    #[test]
    fn categorize_status_separates_client_errors() {
        let known = "/v1/messages";
        // 客户端错误 → 不污染熔断
        assert_eq!(categorize_status(400, known), Outcome::NonRetryable);
        assert_eq!(categorize_status(401, known), Outcome::NonRetryable);
        assert_eq!(categorize_status(422, known), Outcome::NonRetryable);
        // 服务端/限流/网关错误 → 计入熔断
        assert_eq!(categorize_status(403, known), Outcome::Retryable);
        assert_eq!(categorize_status(429, known), Outcome::Retryable);
        assert_eq!(categorize_status(500, known), Outcome::Retryable);
        assert_eq!(categorize_status(502, known), Outcome::Retryable);
        assert_eq!(categorize_status(503, known), Outcome::Retryable);
    }

    #[test]
    fn unknown_path_404_is_neutral_known_path_404_trips() {
        assert_eq!(categorize_status(404, "/api/hello"), Outcome::NonRetryable);
        assert_eq!(categorize_status(404, "/foo"), Outcome::NonRetryable);
        assert_eq!(categorize_status(404, "/v1/messages"), Outcome::Retryable);
        assert_eq!(
            categorize_status(404, "/v1/chat/completions"),
            Outcome::Retryable
        );
        assert_eq!(categorize_status(404, "/v1/responses"), Outcome::Retryable);
        assert_eq!(categorize_status(404, "/v1/models"), Outcome::Retryable);
        assert_eq!(
            categorize_status(404, "/v1/images/generations"),
            Outcome::Retryable
        );
        assert_eq!(
            categorize_status(404, "/v1/images/edits"),
            Outcome::Retryable
        );
        assert_eq!(
            categorize_status(404, "/v1/images/variations"),
            Outcome::NonRetryable
        );
        // 尾斜杠 / 大小写仍视为已知
        assert_eq!(categorize_status(404, "/v1/messages/"), Outcome::Retryable);
        assert_eq!(categorize_status(404, "/V1/Messages"), Outcome::Retryable);
        // 带前缀的「假已知」仍算未知（根挂载精确匹配）
        assert_eq!(
            categorize_status(404, "/evil/v1/messages"),
            Outcome::NonRetryable
        );
        // 未知 path 的 5xx 仍计失败
        assert_eq!(categorize_status(500, "/api/hello"), Outcome::Retryable);
    }
}

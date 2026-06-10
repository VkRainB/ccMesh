//! 每端点熔断器（请求驱动，无后台轮询；移植自 cc-switch 模型）。
//!
//! 三态 Closed/Open/HalfOpen：失败累计/错误率触发 Open；选路用 `is_available` 跳过未到期
//! 的 Open；冷却 `timeout` 后由下一个真实请求经 `allow_request` 惰性转 HalfOpen 并放行为探测
//! （半开单许可防雪崩）；`record_*` 在请求结束回传许可并驱动状态转换。时间相关方法接收 `now:
//! Instant` 以便确定性单测。

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::models::endpoint::Endpoint;

/// 熔断器配置（默认值参考 cc-switch）。结构预留运行时热更新，本期固定常量。
#[derive(Debug, Clone, Copy)]
pub struct CircuitBreakerConfig {
    /// 连续失败达此次数 → Open。
    pub failure_threshold: u32,
    /// HalfOpen 成功达此次数 → Closed。
    pub success_threshold: u32,
    /// Open → HalfOpen 的冷却时长。
    pub timeout: Duration,
    /// 错误率阈值（0~1）。
    pub error_rate_threshold: f64,
    /// 计算错误率的最小样本数。
    pub min_requests: u32,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            failure_threshold: 4,
            success_threshold: 2,
            timeout: Duration::from_secs(60),
            error_rate_threshold: 0.6,
            min_requests: 10,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    Closed,
    Open,
    HalfOpen,
}

impl CircuitState {
    pub fn as_str(&self) -> &'static str {
        match self {
            CircuitState::Closed => "closed",
            CircuitState::Open => "open",
            CircuitState::HalfOpen => "halfOpen",
        }
    }
}

/// 发请求前的许可结果。`used_half_open_permit` 必须在请求结束回传给 `record_*` 释放半开名额。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AllowResult {
    pub allowed: bool,
    pub used_half_open_permit: bool,
}

/// 单端点熔断器内部态。
#[derive(Debug)]
struct BreakerInner {
    state: CircuitState,
    consecutive_failures: u32,
    consecutive_successes: u32,
    total_requests: u32,
    failed_requests: u32,
    half_open_in_flight: u32,
    opened_at: Option<Instant>,
    last_error: Option<String>,
    last_failure_ms: Option<i64>,
}

impl Default for BreakerInner {
    fn default() -> Self {
        Self {
            state: CircuitState::Closed,
            consecutive_failures: 0,
            consecutive_successes: 0,
            total_requests: 0,
            failed_requests: 0,
            half_open_in_flight: 0,
            opened_at: None,
            last_error: None,
            last_failure_ms: None,
        }
    }
}

impl BreakerInner {
    fn to_open(&mut self, now: Instant) {
        self.state = CircuitState::Open;
        self.opened_at = Some(now);
        self.half_open_in_flight = 0;
        self.consecutive_successes = 0;
    }

    fn to_half_open(&mut self) {
        self.state = CircuitState::HalfOpen;
        self.half_open_in_flight = 0;
        self.consecutive_successes = 0;
    }

    fn to_closed(&mut self) {
        self.state = CircuitState::Closed;
        self.consecutive_failures = 0;
        self.consecutive_successes = 0;
        self.total_requests = 0;
        self.failed_requests = 0;
        self.half_open_in_flight = 0;
        self.opened_at = None;
    }

    /// Open 且冷却到期 → 惰性转 HalfOpen。
    fn maybe_half_open(&mut self, cfg: &CircuitBreakerConfig, now: Instant) {
        if self.state == CircuitState::Open {
            if let Some(t) = self.opened_at {
                if now.saturating_duration_since(t) >= cfg.timeout {
                    self.to_half_open();
                }
            }
        }
    }

    fn to_info(&self, name: &str) -> EndpointHealthInfo {
        let success_rate = if self.total_requests == 0 {
            1.0
        } else {
            1.0 - (self.failed_requests as f64) / (self.total_requests as f64)
        };
        let status = match self.state {
            CircuitState::Closed => "healthy",
            CircuitState::Open => "unhealthy",
            CircuitState::HalfOpen => "recovering",
        };
        EndpointHealthInfo {
            name: name.to_string(),
            status: status.to_string(),
            circuit: self.state.as_str().to_string(),
            consecutive_failures: self.consecutive_failures,
            success_rate,
            last_error: self.last_error.clone(),
            last_failure_ms: self.last_failure_ms,
        }
    }
}

/// 端点健康/熔断对外信息（命令返回 + 事件 payload）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointHealthInfo {
    pub name: String,
    /// healthy | unhealthy | recovering
    pub status: String,
    /// closed | open | halfOpen
    pub circuit: String,
    pub consecutive_failures: u32,
    pub success_rate: f64,
    pub last_error: Option<String>,
    pub last_failure_ms: Option<i64>,
}

impl EndpointHealthInfo {
    /// 无熔断记录（未承接流量）的端点：视为健康/闭合。
    pub fn healthy(name: &str) -> Self {
        Self {
            name: name.to_string(),
            status: "healthy".to_string(),
            circuit: "closed".to_string(),
            consecutive_failures: 0,
            success_rate: 1.0,
            last_error: None,
            last_failure_ms: None,
        }
    }

    /// 代理未运行时按库内 test_status 粗映射（无运行期熔断态）。
    pub fn from_test_status(name: &str, test_status: &str) -> Self {
        let status = match test_status {
            "available" => "healthy",
            "unavailable" => "unhealthy",
            _ => "unknown",
        };
        Self {
            status: status.to_string(),
            ..Self::healthy(name)
        }
    }
}

/// 按端点名池化的熔断器注册表（存 `ProxyState`，运行期内存态）。
pub struct BreakerRegistry {
    config: CircuitBreakerConfig,
    inner: Mutex<HashMap<String, BreakerInner>>,
}

impl BreakerRegistry {
    pub fn new(config: CircuitBreakerConfig) -> Self {
        Self {
            config,
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// 选路过滤用：端点当前是否可选（不占半开许可）。Open 到期会惰性转 HalfOpen。
    pub fn is_available(&self, name: &str, now: Instant) -> bool {
        let mut g = self.inner.lock().unwrap();
        let b = g.entry(name.to_string()).or_default();
        b.maybe_half_open(&self.config, now);
        b.state != CircuitState::Open
    }

    /// 发请求前取许可。HalfOpen 同一时刻只放行 1 个探测。
    pub fn allow_request(&self, name: &str, now: Instant) -> AllowResult {
        let mut g = self.inner.lock().unwrap();
        let b = g.entry(name.to_string()).or_default();
        b.maybe_half_open(&self.config, now);
        match b.state {
            CircuitState::Closed => AllowResult {
                allowed: true,
                used_half_open_permit: false,
            },
            CircuitState::Open => AllowResult {
                allowed: false,
                used_half_open_permit: false,
            },
            CircuitState::HalfOpen => {
                if b.half_open_in_flight < 1 {
                    b.half_open_in_flight += 1;
                    AllowResult {
                        allowed: true,
                        used_half_open_permit: true,
                    }
                } else {
                    AllowResult {
                        allowed: false,
                        used_half_open_permit: false,
                    }
                }
            }
        }
    }

    /// 记录成功。返回是否发生状态转换（供调用方发事件）。
    pub fn record_success(&self, name: &str, used_permit: bool) -> bool {
        let mut g = self.inner.lock().unwrap();
        let b = g.entry(name.to_string()).or_default();
        if used_permit && b.half_open_in_flight > 0 {
            b.half_open_in_flight -= 1;
        }
        b.total_requests = b.total_requests.saturating_add(1);
        b.consecutive_failures = 0;
        if b.state == CircuitState::HalfOpen {
            b.consecutive_successes += 1;
            if b.consecutive_successes >= self.config.success_threshold {
                b.to_closed();
                return true;
            }
        }
        false
    }

    /// 记录失败（仅 Retryable 调用）。返回是否发生状态转换。
    pub fn record_failure(&self, name: &str, used_permit: bool, now: Instant, error: &str) -> bool {
        let mut g = self.inner.lock().unwrap();
        let b = g.entry(name.to_string()).or_default();
        if used_permit && b.half_open_in_flight > 0 {
            b.half_open_in_flight -= 1;
        }
        b.total_requests = b.total_requests.saturating_add(1);
        b.failed_requests = b.failed_requests.saturating_add(1);
        b.consecutive_successes = 0;
        b.consecutive_failures = b.consecutive_failures.saturating_add(1);
        b.last_error = Some(error.chars().take(200).collect());
        b.last_failure_ms = Some(chrono::Utc::now().timestamp_millis());
        match b.state {
            CircuitState::HalfOpen => {
                b.to_open(now);
                true
            }
            CircuitState::Closed => {
                let rate_trip = b.total_requests >= self.config.min_requests
                    && (b.failed_requests as f64) / (b.total_requests as f64)
                        >= self.config.error_rate_threshold;
                if b.consecutive_failures >= self.config.failure_threshold || rate_trip {
                    b.to_open(now);
                    true
                } else {
                    false
                }
            }
            CircuitState::Open => false,
        }
    }

    /// 记录中性结果（客户端错误/中断）：仅释放半开许可，不计入熔断。
    pub fn record_neutral(&self, name: &str, used_permit: bool) {
        if !used_permit {
            return;
        }
        let mut g = self.inner.lock().unwrap();
        if let Some(b) = g.get_mut(name) {
            if b.half_open_in_flight > 0 {
                b.half_open_in_flight -= 1;
            }
        }
    }

    /// 单端点健康信息（无记录 → 健康/闭合）。
    pub fn health_of(&self, name: &str) -> EndpointHealthInfo {
        let g = self.inner.lock().unwrap();
        match g.get(name) {
            Some(b) => b.to_info(name),
            None => EndpointHealthInfo::healthy(name),
        }
    }
}

/// 选路候选：过滤掉未到期的 Open 端点；全部 Open 时兜底放行完整列表（避免 100% 拒绝）。
pub fn select_candidates(
    enabled: &[Endpoint],
    registry: &BreakerRegistry,
    now: Instant,
) -> Vec<Endpoint> {
    let avail: Vec<Endpoint> = enabled
        .iter()
        .filter(|e| registry.is_available(&e.name, now))
        .cloned()
        .collect();
    if avail.is_empty() {
        enabled.to_vec()
    } else {
        avail
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> CircuitBreakerConfig {
        CircuitBreakerConfig {
            failure_threshold: 3,
            success_threshold: 2,
            timeout: Duration::from_secs(60),
            error_rate_threshold: 0.6,
            min_requests: 100, // 高样本门槛：本组用例只验证连续失败路径
        }
    }

    fn ep(name: &str) -> Endpoint {
        Endpoint {
            id: 1,
            name: name.to_string(),
            api_url: "https://x".into(),
            api_key: "".into(),
            auth_mode: "api_key".into(),
            enabled: true,
            use_proxy: false,
            transformer: "claude".into(),
            model: "".into(),
            models: Vec::new(),
            model_mappings: Vec::new(),
            remark: "".into(),
            sort_order: 0,
            test_status: "unknown".into(),
            created_at: "".into(),
            updated_at: "".into(),
        }
    }

    #[test]
    fn consecutive_failures_open_then_lazy_half_open_recover() {
        let reg = BreakerRegistry::new(cfg());
        let now = Instant::now();
        // 连续失败达阈值 3 → Open
        assert!(!reg.record_failure("a", false, now, "boom"));
        assert!(!reg.record_failure("a", false, now, "boom"));
        assert!(reg.record_failure("a", false, now, "boom")); // 第 3 次触发转换
        assert!(!reg.is_available("a", now)); // Open 未到期 → 选路跳过

        // 冷却到期 → 惰性转 HalfOpen，可选
        let later = now + Duration::from_secs(61);
        assert!(reg.is_available("a", later));

        // 半开单许可：只放行 1 个探测
        let r1 = reg.allow_request("a", later);
        assert!(r1.allowed && r1.used_half_open_permit);
        let r2 = reg.allow_request("a", later);
        assert!(!r2.allowed && !r2.used_half_open_permit);

        // 探测成功累计达 success_threshold=2 → Closed
        assert!(!reg.record_success("a", true)); // 1 次成功，释放许可
        let r3 = reg.allow_request("a", later);
        assert!(r3.allowed && r3.used_half_open_permit);
        assert!(reg.record_success("a", true)); // 2 次 → 转 Closed
        assert!(reg.is_available("a", later));
    }

    #[test]
    fn half_open_failure_reopens() {
        let reg = BreakerRegistry::new(cfg());
        let now = Instant::now();
        for _ in 0..3 {
            reg.record_failure("a", false, now, "boom");
        }
        let later = now + Duration::from_secs(61);
        let r = reg.allow_request("a", later);
        assert!(r.allowed && r.used_half_open_permit);
        // 半开期失败 → 立即重新 Open
        assert!(reg.record_failure("a", true, later, "again"));
        assert!(!reg.is_available("a", later));
    }

    #[test]
    fn error_rate_trips_open() {
        let reg = BreakerRegistry::new(CircuitBreakerConfig {
            failure_threshold: 100, // 连续失败门槛拉高，仅验证错误率路径
            min_requests: 10,
            error_rate_threshold: 0.6,
            ..cfg()
        });
        let now = Instant::now();
        // 交替成功/失败避免触发"连续失败"，但累计错误率达标
        for _ in 0..6 {
            reg.record_failure("a", false, now, "e");
        }
        for _ in 0..4 {
            reg.record_success("a", false);
        }
        // 此刻 total=10、failed=6 → 0.6 ≥ 阈值；再来一次失败触发
        let tripped = reg.record_failure("a", false, now, "e");
        assert!(tripped);
        assert!(!reg.is_available("a", now));
    }

    #[test]
    fn neutral_does_not_count() {
        let reg = BreakerRegistry::new(cfg());
        let now = Instant::now();
        reg.record_neutral("a", false);
        reg.record_neutral("a", false);
        reg.record_neutral("a", false);
        // 中性结果不计入失败 → 仍可用
        assert!(reg.is_available("a", now));
    }

    #[test]
    fn select_candidates_skips_open_and_falls_back_when_all_open() {
        let reg = BreakerRegistry::new(cfg());
        let now = Instant::now();
        let eps = vec![ep("a"), ep("b")];
        // a 熔断
        for _ in 0..3 {
            reg.record_failure("a", false, now, "boom");
        }
        let c = select_candidates(&eps, &reg, now);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].name, "b");

        // b 也熔断 → 全 Open → 兜底放行完整列表
        for _ in 0..3 {
            reg.record_failure("b", false, now, "boom");
        }
        let c2 = select_candidates(&eps, &reg, now);
        assert_eq!(c2.len(), 2);
    }
}

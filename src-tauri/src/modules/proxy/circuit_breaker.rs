//! 每端点熔断器（请求驱动，无后台轮询；移植自 cc-switch 模型）。
//!
//! 三态 Closed/Open/HalfOpen：失败累计/错误率触发 Open；选路用 `is_available` 跳过未到期
//! 的 Open；冷却后由下一个真实请求经 `allow_request` 惰性转 HalfOpen 并放行为探测
//! （半开单许可防雪崩）；`record_*` 在请求结束回传许可并驱动状态转换。
//! 429（限流）与 5xx/网络（端点坏了）分开：429 用短冷却（优先 Retry-After，缺省
//! `rate_limit_timeout`，上限 `max_rate_limit_timeout`）；5xx/网络用 `timeout`。阈值按入站
//! 协议区分（Claude 放宽），对齐 cc-switch per-app 策略。时间相关方法接收 `now: Instant`
//! 以便确定性单测。

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::models::endpoint::Endpoint;

/// 入站协议类别，用于选熔断阈值 preset（对齐 cc-switch per-app）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InboundKind {
    Claude,
    OpenAi,
    Responses,
}

/// 熔断器配置。结构预留运行时热更新，本期固定常量。
#[derive(Debug, Clone, Copy)]
pub struct CircuitBreakerConfig {
    /// 连续失败达此次数 → Open。
    pub failure_threshold: u32,
    /// HalfOpen 成功达此次数 → Closed。
    pub success_threshold: u32,
    /// Open(Broken) → HalfOpen 的冷却时长。
    pub timeout: Duration,
    /// 错误率阈值（0~1）。
    pub error_rate_threshold: f64,
    /// 计算错误率的最小样本数。
    pub min_requests: u32,
    /// Open(RateLimited) → HalfOpen 的缺省冷却（无 Retry-After 时）。
    pub rate_limit_timeout: Duration,
    /// Retry-After 的安全上限（防上游恶意长值锁死端点）。
    pub max_rate_limit_timeout: Duration,
}

impl Default for CircuitBreakerConfig {
    /// OpenAI/Responses 入站 preset：4/2/60s/0.6/10。
    fn default() -> Self {
        Self {
            failure_threshold: 4,
            success_threshold: 2,
            timeout: Duration::from_secs(60),
            error_rate_threshold: 0.6,
            min_requests: 10,
            rate_limit_timeout: Duration::from_secs(5),
            max_rate_limit_timeout: Duration::from_secs(60),
        }
    }
}

impl CircuitBreakerConfig {
    /// Claude 入站 preset（放宽：8/3/90s/0.7/15），对齐 cc-switch Claude 应用。
    pub fn claude() -> Self {
        Self {
            failure_threshold: 8,
            success_threshold: 3,
            timeout: Duration::from_secs(90),
            error_rate_threshold: 0.7,
            min_requests: 15,
            rate_limit_timeout: Duration::from_secs(5),
            max_rate_limit_timeout: Duration::from_secs(60),
        }
    }
}

/// 进入 Open 的原因：Broken（5xx/网络）用长冷却，RateLimited（429）用短冷却。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenReason {
    Broken,
    RateLimited,
}

/// 一次失败对熔断器的归类：Broken 计长冷却，RateLimited 计短冷却（可带 Retry-After）。
#[derive(Debug, Clone, Copy)]
pub enum FailureKind {
    Broken,
    RateLimited { retry_after: Option<Duration> },
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
    /// 进入 Open 的原因：决定冷却时长（Broken=timeout，RateLimited=Retry-After/短冷却）。
    open_reason: Option<OpenReason>,
    /// 429 携带的 Retry-After（若上游提供），仅 RateLimited 时有效。
    retry_after: Option<Duration>,
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
            open_reason: None,
            retry_after: None,
            last_error: None,
            last_failure_ms: None,
        }
    }
}

impl BreakerInner {
    fn to_open(&mut self, now: Instant, reason: OpenReason, retry_after: Option<Duration>) {
        self.state = CircuitState::Open;
        self.opened_at = Some(now);
        self.open_reason = Some(reason);
        self.retry_after = retry_after;
        self.half_open_in_flight = 0;
        self.consecutive_successes = 0;
    }

    fn to_half_open(&mut self) {
        self.state = CircuitState::HalfOpen;
        self.half_open_in_flight = 0;
        self.consecutive_successes = 0;
        self.open_reason = None;
        self.retry_after = None;
    }

    fn to_closed(&mut self) {
        self.state = CircuitState::Closed;
        self.consecutive_failures = 0;
        self.consecutive_successes = 0;
        self.total_requests = 0;
        self.failed_requests = 0;
        self.half_open_in_flight = 0;
        self.opened_at = None;
        self.open_reason = None;
        self.retry_after = None;
    }

    /// Open 且冷却到期 → 惰性转 HalfOpen。冷却时长按 open_reason 选取：
    /// Broken 用 cfg.timeout；RateLimited 用 min(retry_after 或 rate_limit_timeout, max)。
    fn maybe_half_open(&mut self, cfg: &CircuitBreakerConfig, now: Instant) {
        if self.state == CircuitState::Open {
            if let Some(t) = self.opened_at {
                let cooldown = match self.open_reason {
                    Some(OpenReason::RateLimited) => self
                        .retry_after
                        .unwrap_or(cfg.rate_limit_timeout)
                        .min(cfg.max_rate_limit_timeout),
                    _ => cfg.timeout,
                };
                if now.saturating_duration_since(t) >= cooldown {
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
/// 持两套 config preset：Claude 入站放宽，OpenAI/Responses 默认。状态按端点共享，仅阈值随入站而定。
pub struct BreakerRegistry {
    config_default: CircuitBreakerConfig,
    config_claude: CircuitBreakerConfig,
    inner: Mutex<HashMap<String, BreakerInner>>,
}

impl BreakerRegistry {
    /// 生产构造：默认 + Claude 两套 preset。
    pub fn new() -> Self {
        Self::with_configs(CircuitBreakerConfig::default(), CircuitBreakerConfig::claude())
    }

    /// 显式指定两套 preset（测试用）。
    pub fn with_configs(default: CircuitBreakerConfig, claude: CircuitBreakerConfig) -> Self {
        Self {
            config_default: default,
            config_claude: claude,
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// 测试用：两套 preset 设为同一份 config。
    #[cfg(test)]
    pub fn new_uniform(config: CircuitBreakerConfig) -> Self {
        Self::with_configs(config, config)
    }

    fn cfg_for(&self, inbound: InboundKind) -> &CircuitBreakerConfig {
        match inbound {
            InboundKind::Claude => &self.config_claude,
            _ => &self.config_default,
        }
    }

    /// 选路过滤用：端点当前是否可选（不占半开许可）。Open 到期会惰性转 HalfOpen。
    pub fn is_available(&self, name: &str, inbound: InboundKind, now: Instant) -> bool {
        let cfg = self.cfg_for(inbound);
        let mut g = self.inner.lock().unwrap();
        let b = g.entry(name.to_string()).or_default();
        b.maybe_half_open(cfg, now);
        b.state != CircuitState::Open
    }

    /// 发请求前取许可。HalfOpen 同一时刻只放行 1 个探测。
    pub fn allow_request(&self, name: &str, inbound: InboundKind, now: Instant) -> AllowResult {
        let cfg = self.cfg_for(inbound);
        let mut g = self.inner.lock().unwrap();
        let b = g.entry(name.to_string()).or_default();
        b.maybe_half_open(cfg, now);
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
    pub fn record_success(&self, name: &str, used_permit: bool, inbound: InboundKind) -> bool {
        let cfg = self.cfg_for(inbound);
        let mut g = self.inner.lock().unwrap();
        let b = g.entry(name.to_string()).or_default();
        if used_permit && b.half_open_in_flight > 0 {
            b.half_open_in_flight -= 1;
        }
        b.total_requests = b.total_requests.saturating_add(1);
        b.consecutive_failures = 0;
        if b.state == CircuitState::HalfOpen {
            b.consecutive_successes += 1;
            if b.consecutive_successes >= cfg.success_threshold {
                b.to_closed();
                return true;
            }
        }
        false
    }

    /// 记录失败（仅 Retryable 调用）。返回是否发生状态转换。
    /// `kind` 区分 Broken（长冷却）与 RateLimited（短冷却，可带 Retry-After）。
    pub fn record_failure(
        &self,
        name: &str,
        used_permit: bool,
        now: Instant,
        error: &str,
        inbound: InboundKind,
        kind: FailureKind,
    ) -> bool {
        let cfg = self.cfg_for(inbound);
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
                let (reason, retry_after) = kind_to_open(&kind);
                b.to_open(now, reason, retry_after);
                true
            }
            CircuitState::Closed => {
                let rate_trip = b.total_requests >= cfg.min_requests
                    && (b.failed_requests as f64) / (b.total_requests as f64)
                        >= cfg.error_rate_threshold;
                if b.consecutive_failures >= cfg.failure_threshold || rate_trip {
                    let (reason, retry_after) = kind_to_open(&kind);
                    b.to_open(now, reason, retry_after);
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

    /// 单端点健康信息；无熔断记录（未承接流量）返回 `None`，由调用方决定回退
    /// （避免伪造 healthy 覆盖手动测试结论）。
    pub fn health_of(&self, name: &str) -> Option<EndpointHealthInfo> {
        let g = self.inner.lock().unwrap();
        g.get(name).map(|b| b.to_info(name))
    }

    /// 强制闭合指定端点熔断器（用户手动测试确认可用时调用）。
    /// 仅在存在记录且状态非 Closed 时转换为 Closed 并返回 true（供调用方决定是否 emit 事件）；
    /// 无记录或已 Closed 返回 false，避免多余事件。复用 `to_closed` 清零全部计数。
    pub fn force_close(&self, name: &str) -> bool {
        let mut g = self.inner.lock().unwrap();
        if let Some(b) = g.get_mut(name) {
            if b.state != CircuitState::Closed {
                b.to_closed();
                return true;
            }
        }
        false
    }

    /// 候选被 Open 摘空时判断能否网关内退避：若 names 中所有「处于 Open」的端点都是因限流
    /// 而开（RateLimited），返回最近一个的剩余冷却时间；含 Broken-Open 或无任何 Open 返回 None。
    pub fn rate_limit_backoff(
        &self,
        names: &[String],
        inbound: InboundKind,
        now: Instant,
    ) -> Option<Duration> {
        let cfg = self.cfg_for(inbound);
        let g = self.inner.lock().unwrap();
        let mut soonest: Option<Duration> = None;
        let mut any_open = false;
        for name in names {
            let b = match g.get(name) {
                Some(b) => b,
                None => continue,
            };
            if b.state != CircuitState::Open {
                continue;
            }
            any_open = true;
            if b.open_reason != Some(OpenReason::RateLimited) {
                return None;
            }
            if let Some(t) = b.opened_at {
                let cooldown = b
                    .retry_after
                    .unwrap_or(cfg.rate_limit_timeout)
                    .min(cfg.max_rate_limit_timeout);
                let remaining = cooldown.saturating_sub(now.saturating_duration_since(t));
                soonest = Some(soonest.map_or(remaining, |cur| cur.min(remaining)));
            }
        }
        if !any_open {
            None
        } else {
            soonest.or(Some(Duration::ZERO))
        }
    }
}

fn kind_to_open(kind: &FailureKind) -> (OpenReason, Option<Duration>) {
    match kind {
        FailureKind::Broken => (OpenReason::Broken, None),
        FailureKind::RateLimited { retry_after } => (OpenReason::RateLimited, *retry_after),
    }
}

/// 选路候选：过滤掉未到期的 Open 端点。全 Open 时返回空（调用方应返回 502 或退避重试），
/// 不再兜底放行完整列表——模型过滤后的候选若被级联扩大，会误伤不支持该模型的端点。
pub fn select_candidates(
    enabled: &[Endpoint],
    registry: &BreakerRegistry,
    inbound: InboundKind,
    now: Instant,
) -> Vec<Endpoint> {
    enabled
        .iter()
        .filter(|e| registry.is_available(&e.name, inbound, now))
        .cloned()
        .collect()
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
            rate_limit_timeout: Duration::from_secs(5),
            max_rate_limit_timeout: Duration::from_secs(60),
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
            active_models: Vec::new(),
            model_mappings: Vec::new(),
            model_mappings_enabled: true,
            remark: "".into(),
            sort_order: 0,
            fast: false,
            fast_sort_order: 0,
            test_status: "unknown".into(),
            created_at: "".into(),
            updated_at: "".into(),
            archived: false,
        }
    }

    #[test]
    fn consecutive_failures_open_then_lazy_half_open_recover() {
        let reg = BreakerRegistry::new_uniform(cfg());
        let now = Instant::now();
        // 连续失败达阈值 3 → Open
        assert!(!reg.record_failure("a", false, now, "boom", InboundKind::OpenAi, FailureKind::Broken));
        assert!(!reg.record_failure("a", false, now, "boom", InboundKind::OpenAi, FailureKind::Broken));
        assert!(reg.record_failure("a", false, now, "boom", InboundKind::OpenAi, FailureKind::Broken)); // 第 3 次触发转换
        assert!(!reg.is_available("a", InboundKind::OpenAi, now)); // Open 未到期 → 选路跳过

        // 冷却到期 → 惰性转 HalfOpen，可选
        let later = now + Duration::from_secs(61);
        assert!(reg.is_available("a", InboundKind::OpenAi, later));

        // 半开单许可：只放行 1 个探测
        let r1 = reg.allow_request("a", InboundKind::OpenAi, later);
        assert!(r1.allowed && r1.used_half_open_permit);
        let r2 = reg.allow_request("a", InboundKind::OpenAi, later);
        assert!(!r2.allowed && !r2.used_half_open_permit);

        // 探测成功累计达 success_threshold=2 → Closed
        assert!(!reg.record_success("a", true, InboundKind::OpenAi)); // 1 次成功，释放许可
        let r3 = reg.allow_request("a", InboundKind::OpenAi, later);
        assert!(r3.allowed && r3.used_half_open_permit);
        assert!(reg.record_success("a", true, InboundKind::OpenAi)); // 2 次 → 转 Closed
        assert!(reg.is_available("a", InboundKind::OpenAi, later));
    }

    #[test]
    fn half_open_failure_reopens() {
        let reg = BreakerRegistry::new_uniform(cfg());
        let now = Instant::now();
        for _ in 0..3 {
            reg.record_failure("a", false, now, "boom", InboundKind::OpenAi, FailureKind::Broken);
        }
        let later = now + Duration::from_secs(61);
        let r = reg.allow_request("a", InboundKind::OpenAi, later);
        assert!(r.allowed && r.used_half_open_permit);
        // 半开期失败 → 立即重新 Open
        assert!(reg.record_failure("a", true, later, "again", InboundKind::OpenAi, FailureKind::Broken));
        assert!(!reg.is_available("a", InboundKind::OpenAi, later));
    }

    #[test]
    fn error_rate_trips_open() {
        let reg = BreakerRegistry::new_uniform(CircuitBreakerConfig {
            failure_threshold: 100, // 连续失败门槛拉高，仅验证错误率路径
            min_requests: 10,
            error_rate_threshold: 0.6,
            ..cfg()
        });
        let now = Instant::now();
        // 交替成功/失败避免触发"连续失败"，但累计错误率达标
        for _ in 0..6 {
            reg.record_failure("a", false, now, "e", InboundKind::OpenAi, FailureKind::Broken);
        }
        for _ in 0..4 {
            reg.record_success("a", false, InboundKind::OpenAi);
        }
        // 此刻 total=10、failed=6 → 0.6 ≥ 阈值；再来一次失败触发
        let tripped = reg.record_failure("a", false, now, "e", InboundKind::OpenAi, FailureKind::Broken);
        assert!(tripped);
        assert!(!reg.is_available("a", InboundKind::OpenAi, now));
    }

    #[test]
    fn neutral_does_not_count() {
        let reg = BreakerRegistry::new_uniform(cfg());
        let now = Instant::now();
        reg.record_neutral("a", false);
        reg.record_neutral("a", false);
        reg.record_neutral("a", false);
        // 中性结果不计入失败 → 仍可用
        assert!(reg.is_available("a", InboundKind::OpenAi, now));
    }

    #[test]
    fn select_candidates_skips_open_returns_empty_when_all_open() {
        let reg = BreakerRegistry::new_uniform(cfg());
        let now = Instant::now();
        let eps = vec![ep("a"), ep("b")];
        // a 熔断
        for _ in 0..3 {
            reg.record_failure("a", false, now, "boom", InboundKind::OpenAi, FailureKind::Broken);
        }
        let c = select_candidates(&eps, &reg, InboundKind::OpenAi, now);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].name, "b");

        // b 也熔断 → 全 Open → 返回空（不再兜底放行）
        for _ in 0..3 {
            reg.record_failure("b", false, now, "boom", InboundKind::OpenAi, FailureKind::Broken);
        }
        let c2 = select_candidates(&eps, &reg, InboundKind::OpenAi, now);
        assert!(c2.is_empty());
    }

    #[test]
    fn force_close_resets_open_and_half_open() {
        let reg = BreakerRegistry::new_uniform(cfg());
        let now = Instant::now();
        // 无记录 → false（不伪造转换）
        assert!(!reg.force_close("a"));
        // 累计失败达阈值 → Open
        for _ in 0..3 {
            reg.record_failure("a", false, now, "boom", InboundKind::OpenAi, FailureKind::Broken);
        }
        assert!(!reg.is_available("a", InboundKind::OpenAi, now)); // Open 未到期 → 选路跳过
        // force_close → Closed，返回 true；计数清零、health 反映 healthy/closed
        assert!(reg.force_close("a"));
        let h = reg.health_of("a").unwrap();
        assert_eq!(h.circuit, "closed");
        assert_eq!(h.status, "healthy");
        assert_eq!(h.consecutive_failures, 0);
        assert!(reg.is_available("a", InboundKind::OpenAi, now));
        // 已 Closed 再 force_close → false（无转换，不 emit）
        assert!(!reg.force_close("a"));

        // HalfOpen 也能强制闭合
        let reg2 = BreakerRegistry::new_uniform(cfg());
        for _ in 0..3 {
            reg2.record_failure("b", false, now, "boom", InboundKind::OpenAi, FailureKind::Broken);
        }
        let later = now + Duration::from_secs(61);
        assert!(reg2.allow_request("b", InboundKind::OpenAi, later).allowed); // 惰性转 HalfOpen 并占许可
        assert!(reg2.force_close("b"));
        assert_eq!(reg2.health_of("b").unwrap().circuit, "closed");
    }

    /// 429 触发熔断后用短冷却（rate_limit_timeout=5s），而非 60s。
    #[test]
    fn rate_limited_uses_short_cooldown() {
        let reg = BreakerRegistry::new_uniform(cfg());
        let now = Instant::now();
        for _ in 0..3 {
            reg.record_failure("a", false, now, "429", InboundKind::OpenAi, FailureKind::RateLimited { retry_after: None });
        }
        assert!(!reg.is_available("a", InboundKind::OpenAi, now)); // Open
        // 5s 缺省冷却到期 → 惰性转 HalfOpen（60s 仍未到期，验证不是长冷却）
        let soon = now + Duration::from_secs(6);
        assert!(reg.is_available("a", InboundKind::OpenAi, soon));
    }

    /// 429 带 Retry-After 时按 Retry-After 冷却（受 max 上限约束）。
    #[test]
    fn retry_after_is_honored_and_capped() {
        let reg = BreakerRegistry::new_uniform(cfg());
        let now = Instant::now();
        // Retry-After=10s → 10s 后恢复（< max 60s，不截断）
        for _ in 0..3 {
            reg.record_failure("a", false, now, "429", InboundKind::OpenAi, FailureKind::RateLimited { retry_after: Some(Duration::from_secs(10)) });
        }
        assert!(!reg.is_available("a", InboundKind::OpenAi, now + Duration::from_secs(9)));
        assert!(reg.is_available("a", InboundKind::OpenAi, now + Duration::from_secs(11)));

        // Retry-After=120s → 截断到 max 60s
        let reg2 = BreakerRegistry::new_uniform(cfg());
        for _ in 0..3 {
            reg2.record_failure("b", false, now, "429", InboundKind::OpenAi, FailureKind::RateLimited { retry_after: Some(Duration::from_secs(120)) });
        }
        assert!(!reg2.is_available("b", InboundKind::OpenAi, now + Duration::from_secs(59)));
        assert!(reg2.is_available("b", InboundKind::OpenAi, now + Duration::from_secs(61)));
    }

    /// 半开探测收到 429 → 重新 Open，且仍用短冷却。
    #[test]
    fn half_open_429_reopens_with_short_cooldown() {
        let reg = BreakerRegistry::new_uniform(cfg());
        let now = Instant::now();
        for _ in 0..3 {
            reg.record_failure("a", false, now, "429", InboundKind::OpenAi, FailureKind::RateLimited { retry_after: None });
        }
        // 5s 后惰性转 HalfOpen 并占许可
        let soon = now + Duration::from_secs(6);
        let r = reg.allow_request("a", InboundKind::OpenAi, soon);
        assert!(r.allowed && r.used_half_open_permit);
        // 探测又 429 → 重新 Open（短冷却）
        assert!(reg.record_failure("a", true, soon, "429", InboundKind::OpenAi, FailureKind::RateLimited { retry_after: None }));
        assert!(!reg.is_available("a", InboundKind::OpenAi, soon));
        // 再次 5s 后恢复（验证仍是短冷却，非 60s）
        assert!(reg.is_available("a", InboundKind::OpenAi, soon + Duration::from_secs(6)));
    }

    /// Claude 入站阈值放宽：8 次连续失败才 trip；OpenAI 入站 4 次即 trip。
    #[test]
    fn claude_inbound_threshold_looser_than_default() {
        let reg = BreakerRegistry::new(); // 生产 preset：default 4，claude 8
        let now = Instant::now();
        // OpenAI 入站：4 次 Broken 失败 → 第 4 次 trip
        for _ in 0..3 {
            assert!(!reg.record_failure("a", false, now, "boom", InboundKind::OpenAi, FailureKind::Broken));
        }
        assert!(reg.record_failure("a", false, now, "boom", InboundKind::OpenAi, FailureKind::Broken));
        assert!(!reg.is_available("a", InboundKind::OpenAi, now));

        // Claude 入站：8 次才 trip
        for i in 0..7 {
            assert!(
                !reg.record_failure("c", false, now, "boom", InboundKind::Claude, FailureKind::Broken),
                "第 {} 次 Claude 失败不应 trip",
                i + 1
            );
        }
        assert!(reg.record_failure("c", false, now, "boom", InboundKind::Claude, FailureKind::Broken)); // 第 8 次
        assert!(!reg.is_available("c", InboundKind::Claude, now));
        // Claude Broken 冷却 90s
        assert!(!reg.is_available("c", InboundKind::Claude, now + Duration::from_secs(89)));
        assert!(reg.is_available("c", InboundKind::Claude, now + Duration::from_secs(91)));
    }

    /// rate_limit_backoff：全 Open 且皆 RateLimited → 返回最近剩余冷却。
    #[test]
    fn rate_limit_backoff_all_rate_limited() {
        let reg = BreakerRegistry::new_uniform(cfg());
        let now = Instant::now();
        // a：429，retry_after=10s
        for _ in 0..3 {
            reg.record_failure("a", false, now, "429", InboundKind::OpenAi, FailureKind::RateLimited { retry_after: Some(Duration::from_secs(10)) });
        }
        // b：429，缺省 5s
        for _ in 0..3 {
            reg.record_failure("b", false, now, "429", InboundKind::OpenAi, FailureKind::RateLimited { retry_after: None });
        }
        let names = vec!["a".to_string(), "b".to_string()];
        // now 时：a 剩 10s，b 剩 5s → 最近是 b 的 ~5s
        let backoff = reg.rate_limit_backoff(&names, InboundKind::OpenAi, now).unwrap();
        assert!(backoff <= Duration::from_secs(5));
        assert!(backoff > Duration::from_secs(4));
        // 3s 后：a 剩 7s，b 剩 2s → 最近是 b 的 ~2s
        let mid = now + Duration::from_secs(3);
        let backoff2 = reg.rate_limit_backoff(&names, InboundKind::OpenAi, mid).unwrap();
        assert!(backoff2 <= Duration::from_secs(2));
        assert!(backoff2 > Duration::from_secs(1));
        // 5s 后：b 已到期（剩 0）→ 返回 0，调用方应立即重选
        let after_b = now + Duration::from_secs(5);
        assert_eq!(
            reg.rate_limit_backoff(&names, InboundKind::OpenAi, after_b),
            Some(Duration::ZERO)
        );
    }

    /// rate_limit_backoff：含 Broken-Open → 返回 None（不退避，走 502）。
    #[test]
    fn rate_limit_backoff_with_broken_returns_none() {
        let reg = BreakerRegistry::new_uniform(cfg());
        let now = Instant::now();
        for _ in 0..3 {
            reg.record_failure("a", false, now, "429", InboundKind::OpenAi, FailureKind::RateLimited { retry_after: None });
        }
        for _ in 0..3 {
            reg.record_failure("b", false, now, "boom", InboundKind::OpenAi, FailureKind::Broken);
        }
        let names = vec!["a".to_string(), "b".to_string()];
        assert_eq!(reg.rate_limit_backoff(&names, InboundKind::OpenAi, now), None);
    }

    /// rate_limit_backoff：无任何 Open → 返回 None。
    #[test]
    fn rate_limit_backoff_no_open_returns_none() {
        let reg = BreakerRegistry::new_uniform(cfg());
        let now = Instant::now();
        let names = vec!["a".to_string()];
        assert_eq!(reg.rate_limit_backoff(&names, InboundKind::OpenAi, now), None);
    }
}

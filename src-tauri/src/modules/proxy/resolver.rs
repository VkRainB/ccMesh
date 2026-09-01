use std::collections::HashMap;

use crate::models::endpoint::Endpoint;

/// 端点指定头部（项目决策：`X-CCmomo-Endpoint`），及兼容别名。
pub const ENDPOINT_HEADER: &str = "x-ccmomo-endpoint";
pub const ENDPOINT_HEADER_ALT: &str = "x-endpoint-name";
pub const ENDPOINT_QUERY: &str = "endpoint";
pub const ENDPOINT_QUERY_ALT: &str = "ep";

/// 解析结果：命中的指定端点（None = 走轮换）+ 可选模型覆盖 + 未找到错误。
#[derive(Debug, Default, Clone)]
pub struct Resolution {
    pub endpoint: Option<Endpoint>,
    /// 每请求模型覆盖（`@端点/模型` 语法解析所得，已有单测）；转发侧应用待接入，暂保留。
    #[allow(dead_code)]
    pub model_override: Option<String>,
    /// 指定了端点名但未找到/未启用 → 错误信息（调用方应返回 400）。
    pub not_found: Option<String>,
}

impl Resolution {
    /// 是否使用了「指定端点」（命中后不轮换）。
    pub fn use_specific(&self) -> bool {
        self.endpoint.is_some()
    }
}

/// 按优先级解析端点：① HTTP 头部 ② 模型名 `@端点名/模型名` ③ 查询参数。
/// `headers` 与 `query` 的键应为小写。`enabled` 为当前启用端点列表（大小写不敏感匹配）。
pub fn resolve_endpoint(
    headers: &HashMap<String, String>,
    model: Option<&str>,
    query: &HashMap<String, String>,
    enabled: &[Endpoint],
) -> Resolution {
    // ① 头部
    if let Some(name) = headers
        .get(ENDPOINT_HEADER)
        .or_else(|| headers.get(ENDPOINT_HEADER_ALT))
    {
        let name = name.trim();
        if !name.is_empty() {
            return by_name(name, None, enabled);
        }
    }

    // ② 模型名 @端点/模型
    if let Some(m) = model {
        if let Some(stripped) = m.strip_prefix('@') {
            let (ep_name, model_override) = match stripped.split_once('/') {
                Some((e, mo)) => (e.trim(), Some(mo.to_string())),
                None => (stripped.trim(), None),
            };
            if !ep_name.is_empty() {
                return by_name(ep_name, model_override, enabled);
            }
        }
    }

    // ③ 查询参数
    if let Some(name) = query
        .get(ENDPOINT_QUERY)
        .or_else(|| query.get(ENDPOINT_QUERY_ALT))
    {
        let name = name.trim();
        if !name.is_empty() {
            return by_name(name, None, enabled);
        }
    }

    Resolution::default()
}

fn by_name(name: &str, model_override: Option<String>, enabled: &[Endpoint]) -> Resolution {
    match enabled
        .iter()
        .find(|e| e.name.trim().eq_ignore_ascii_case(name))
    {
        Some(e) => Resolution {
            endpoint: Some(e.clone()),
            model_override,
            not_found: None,
        },
        None => Resolution {
            endpoint: None,
            model_override: None,
            not_found: Some(format!("指定的端点 '{name}' 不存在或未启用")),
        },
    }
}

/// 端点对外公布/可路由匹配的模型集合：基础可用模型（锁定 `model` 优先，否则 `models` 清单）
/// 并入映射入站名（`model_mappings[].from`，仅当 `model_mappings_enabled`）。大小写不敏感去重、保留首次出现的原样写法。
///
/// 点亮过滤：当 `active_models` 非空时，基础集合仅取点亮子集（其余视为保留不公布）；
/// 空集表示全部公布（向后兼容旧端点）。锁定 `model` 优先于清单，不受点亮影响。
pub fn advertised_models(ep: &Endpoint) -> Vec<String> {
    let base: Vec<String> = if !ep.model.trim().is_empty() {
        vec![ep.model.clone()]
    } else if !ep.active_models.is_empty() {
        ep.active_models.clone()
    } else {
        ep.models.clone()
    };
    let mapping_from = if ep.model_mappings_enabled {
        ep.model_mappings
            .iter()
            .map(|mm| mm.from.clone())
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let mut out: Vec<String> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for m in base.into_iter().chain(mapping_from) {
        let key = m.trim().to_ascii_lowercase();
        if key.is_empty() || seen.contains(&key) {
            continue;
        }
        seen.push(key);
        out.push(m);
    }
    out
}

/// 解析转发上游应使用的出站模型：① 映射开启且入站名命中 → 映射出站名；② 否则锁定 `model` 非空 → 锁定模型；
/// ③ 否则 `None`（透传客户端原始 model）。大小写不敏感匹配入站名。
pub fn resolve_outbound(ep: &Endpoint, inbound: Option<&str>) -> Option<String> {
    if ep.model_mappings_enabled {
        if let Some(m) = inbound {
            let m = m.trim();
            if !m.is_empty() {
                if let Some(map) = ep
                    .model_mappings
                    .iter()
                    .find(|mm| mm.from.trim().eq_ignore_ascii_case(m) && !mm.to.trim().is_empty())
                {
                    return Some(map.to.clone());
                }
            }
        }
    }
    if !ep.model.trim().is_empty() {
        return Some(ep.model.clone());
    }
    None
}

/// 按请求模型过滤候选端点（轮换/熔断前）：
/// 若有端点的「公布模型集合（含映射入站名）」包含该模型，则只保留这些端点（故障隔离：不含该模型的端点不参与轮换/熔断）；
/// 若无任一端点声明（或未带 model），回退完整列表以保向后兼容。大小写不敏感。
pub fn filter_by_model(enabled: &[Endpoint], model: Option<&str>) -> Vec<Endpoint> {
    let m = match model {
        Some(m) if !m.trim().is_empty() => m.trim(),
        _ => return enabled.to_vec(),
    };
    let with_model: Vec<Endpoint> = enabled
        .iter()
        .filter(|e| {
            advertised_models(e)
                .iter()
                .any(|mm| mm.trim().eq_ignore_ascii_case(m))
        })
        .cloned()
        .collect();
    if with_model.is_empty() {
        enabled.to_vec()
    } else {
        with_model
    }
}

/// 严格按模型过滤（不回退全量）：只保留声明该模型的端点。
/// 返回 `Some(vec)` 表示已按模型过滤（vec 可能为空 = 无端点声明）；返回 `None` 表示无模型信号（调用方自行决定）。
/// 供 Images 入站使用：避免把图片请求送到未声明该图片模型的不兼容端点。
pub fn filter_by_model_strict(enabled: &[Endpoint], model: Option<&str>) -> Option<Vec<Endpoint>> {
    let m = match model {
        Some(m) if !m.trim().is_empty() => m.trim(),
        _ => return None,
    };
    Some(
        enabled
            .iter()
            .filter(|e| advertised_models(e).iter().any(|mm| mm.trim().eq_ignore_ascii_case(m)))
            .cloned()
            .collect(),
    )
}

/// 跨端点聚合的对外公布模型去重（大小写不敏感，保留首次出现）。
/// 入参 `(模型名, 端点名)`；多个端点公布同名模型时只保留首次出现项，
/// 使 `/v1/models` 与对外可用模型列表口径一致。
pub fn dedup_advertised_pairs(pairs: Vec<(String, String)>) -> Vec<(String, String)> {
    let mut seen = std::collections::HashSet::new();
    pairs
        .into_iter()
        .filter(|(id, _)| seen.insert(id.to_lowercase()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
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

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn resolves_by_header() {
        let eps = vec![ep("alpha"), ep("beta")];
        let r = resolve_endpoint(
            &map(&[("x-ccmomo-endpoint", "beta")]),
            None,
            &HashMap::new(),
            &eps,
        );
        assert_eq!(r.endpoint.unwrap().name, "beta");
    }

    #[test]
    fn resolves_by_model_with_override() {
        let eps = vec![ep("alpha")];
        let r = resolve_endpoint(
            &HashMap::new(),
            Some("@alpha/gpt-4o"),
            &HashMap::new(),
            &eps,
        );
        assert_eq!(r.endpoint.unwrap().name, "alpha");
        assert_eq!(r.model_override.as_deref(), Some("gpt-4o"));
    }

    #[test]
    fn resolves_by_model_without_slash() {
        let eps = vec![ep("alpha")];
        let r = resolve_endpoint(&HashMap::new(), Some("@alpha"), &HashMap::new(), &eps);
        assert_eq!(r.endpoint.unwrap().name, "alpha");
        assert!(r.model_override.is_none());
    }

    #[test]
    fn resolves_by_query() {
        let eps = vec![ep("alpha")];
        let r = resolve_endpoint(&HashMap::new(), None, &map(&[("ep", "alpha")]), &eps);
        assert_eq!(r.endpoint.unwrap().name, "alpha");
    }

    #[test]
    fn header_takes_priority_over_model() {
        let eps = vec![ep("alpha"), ep("beta")];
        let r = resolve_endpoint(
            &map(&[("x-ccmomo-endpoint", "alpha")]),
            Some("@beta/m"),
            &HashMap::new(),
            &eps,
        );
        assert_eq!(r.endpoint.unwrap().name, "alpha");
    }

    #[test]
    fn unknown_name_yields_not_found_and_no_rotation_endpoint() {
        let eps = vec![ep("alpha")];
        let r = resolve_endpoint(
            &map(&[("x-ccmomo-endpoint", "ghost")]),
            None,
            &HashMap::new(),
            &eps,
        );
        assert!(r.endpoint.is_none());
        assert!(r.not_found.is_some());
    }

    #[test]
    fn no_hint_falls_back_to_rotation() {
        let eps = vec![ep("alpha")];
        let r = resolve_endpoint(&HashMap::new(), Some("gpt-4o"), &HashMap::new(), &eps);
        assert!(r.endpoint.is_none());
        assert!(r.not_found.is_none());
        assert!(!r.use_specific());
    }

    fn ep_with_models(name: &str, models: &[&str]) -> Endpoint {
        Endpoint {
            models: models.iter().map(|s| s.to_string()).collect(),
            ..ep(name)
        }
    }

    #[test]
    fn filter_by_model_keeps_only_declaring_endpoints() {
        let eps = vec![
            ep_with_models("max", &["claude-opus-4-8", "claude-sonnet-4"]),
            ep_with_models("max2", &["claude-opus-4-8"]),
            ep_with_models("cc", &["mimo-v2.5-pro"]),
        ];
        let got = filter_by_model(&eps, Some("claude-opus-4-8"));
        let names: Vec<&str> = got.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["max", "max2"]); // cc 被排除，熔断不受影响
    }

    #[test]
    fn filter_by_model_is_case_insensitive() {
        let eps = vec![ep_with_models("max", &["Claude-Opus-4-8"])];
        let got = filter_by_model(&eps, Some("claude-opus-4-8"));
        assert_eq!(got.len(), 1);
    }

    #[test]
    fn filter_by_model_falls_back_when_no_endpoint_declares_it() {
        let eps = vec![ep_with_models("cc", &["mimo-v2.5-pro"]), ep("bare")];
        // 无端点声明该模型 → 回退全量（向后兼容）
        let got = filter_by_model(&eps, Some("unknown-model"));
        assert_eq!(got.len(), 2);
    }

    #[test]
    fn filter_by_model_falls_back_when_model_absent() {
        let eps = vec![ep_with_models("max", &["claude-opus-4-8"]), ep("bare")];
        assert_eq!(filter_by_model(&eps, None).len(), 2);
        assert_eq!(filter_by_model(&eps, Some("  ")).len(), 2);
    }

    #[test]
    fn filter_by_model_strict_no_fallback_no_signal() {
        let eps = vec![
            ep_with_models("cc", &["mimo-v2.5-pro"]),
            ep_with_models("img", &["gpt-image-2"]),
            ep("bare"),
        ];
        // 有声明端点 → 只留声明者，不回退全量
        let got = filter_by_model_strict(&eps, Some("gpt-image-2")).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "img");
        // 无端点声明 → 空 vec（调用方据此 400），不回退全量
        let got = filter_by_model_strict(&eps, Some("unknown")).unwrap();
        assert!(got.is_empty());
        // 无模型信号 → None（调用方自行决定）
        assert!(filter_by_model_strict(&eps, None).is_none());
        assert!(filter_by_model_strict(&eps, Some("  ")).is_none());
    }

    fn ep_mapped(name: &str, models: &[&str], mappings: &[(&str, &str)]) -> Endpoint {
        Endpoint {
            model_mappings: mappings
                .iter()
                .map(|(f, t)| crate::models::endpoint::ModelMapping {
                    from: f.to_string(),
                    to: t.to_string(),
                })
                .collect(),
            ..ep_with_models(name, models)
        }
    }

    #[test]
    fn advertised_models_unions_models_and_mapping_inbound_dedup_ci() {
        let e = ep_mapped(
            "max",
            &["claude-opus-4-8", "Claude-Opus-4-8"],
            &[("gpt-5", "claude-opus-4-8"), ("GPT-5", "claude-opus-4-8")],
        );
        let adv = advertised_models(&e);
        // 大小写去重：claude-opus-4-8 与 gpt-5 各保留一次
        assert_eq!(adv.len(), 2);
        assert!(adv
            .iter()
            .any(|m| m.eq_ignore_ascii_case("claude-opus-4-8")));
        assert!(adv.iter().any(|m| m.eq_ignore_ascii_case("gpt-5")));
    }

    #[test]
    fn advertised_models_active_subset_filters_base() {
        // 点亮 a、c：仅公布点亮子集 + 映射入站名；b 保留不公布
        let e = Endpoint {
            active_models: vec!["a".into(), "c".into()],
            ..ep_mapped("ep", &["a", "b", "c"], &[("alias", "a")])
        };
        let adv = advertised_models(&e);
        assert!(adv.iter().any(|m| m == "a"));
        assert!(adv.iter().any(|m| m == "c"));
        assert!(adv.iter().any(|m| m == "alias"));
        assert!(!adv.iter().any(|m| m == "b")); // 未点亮 → 不公布
    }

    #[test]
    fn advertised_models_empty_active_publishes_all() {
        // 空点亮集 → 全量公布（向后兼容）
        let e = ep_with_models("ep", &["a", "b", "c"]);
        let adv = advertised_models(&e);
        assert_eq!(adv.len(), 3);
    }

    #[test]
    fn advertised_models_locked_model_takes_base() {
        let e = Endpoint {
            model: "locked-x".into(),
            ..ep_mapped("ep", &["ignored"], &[("alias", "locked-x")])
        };
        let adv = advertised_models(&e);
        assert!(adv.iter().any(|m| m == "locked-x"));
        assert!(adv.iter().any(|m| m == "alias"));
        assert!(!adv.iter().any(|m| m == "ignored")); // models 被锁定 model 取代
    }

    #[test]
    fn dedup_advertised_pairs_removes_cross_endpoint_dups_ci() {
        // 多端点公布同名模型（含大小写差异）→ 只保留首次出现，归属首个端点。
        let pairs = vec![
            ("mimo-v2.5".to_string(), "gpt端点".to_string()),
            ("mimo-v2.5-pro".to_string(), "gpt端点".to_string()),
            ("gpt-5.5".to_string(), "gpt端点".to_string()),
            ("MIMO-v2.5".to_string(), "cc端点".to_string()),
            ("mimo-v2.5-pro".to_string(), "cc端点".to_string()),
        ];
        let got = dedup_advertised_pairs(pairs);
        assert_eq!(
            got,
            vec![
                ("mimo-v2.5".to_string(), "gpt端点".to_string()),
                ("mimo-v2.5-pro".to_string(), "gpt端点".to_string()),
                ("gpt-5.5".to_string(), "gpt端点".to_string()),
            ]
        );
    }

    #[test]
    fn filter_by_model_matches_mapping_inbound_name() {
        let eps = vec![
            ep_mapped("max", &["claude-opus-4-8"], &[("gpt-5", "claude-opus-4-8")]),
            ep_with_models("cc", &["mimo-v2.5-pro"]),
        ];
        // 请求入站映射名 gpt-5 → 只命中声明该映射的 max
        let got = filter_by_model(&eps, Some("gpt-5"));
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "max");
    }

    #[test]
    fn resolve_outbound_mapping_then_locked_then_passthrough() {
        let mapped = ep_mapped("e", &["claude-opus-4-8"], &[("gpt-5", "claude-opus-4-8")]);
        // 命中映射
        assert_eq!(
            resolve_outbound(&mapped, Some("GPT-5")).as_deref(),
            Some("claude-opus-4-8")
        );
        // 未命中映射且无锁定 → 透传（None）
        assert_eq!(resolve_outbound(&mapped, Some("claude-opus-4-8")), None);
        // 锁定 model 优先于透传
        let locked = Endpoint {
            model: "lk".into(),
            ..ep("e2")
        };
        assert_eq!(
            resolve_outbound(&locked, Some("anything")).as_deref(),
            Some("lk")
        );
        // 映射优先于锁定
        let both = Endpoint {
            model: "lk".into(),
            ..ep_mapped("e3", &[], &[("a", "mapped-to")])
        };
        assert_eq!(
            resolve_outbound(&both, Some("a")).as_deref(),
            Some("mapped-to")
        );
    }

    #[test]
    fn mappings_disabled_skips_advertise_and_rewrite() {
        let off = Endpoint {
            model_mappings_enabled: false,
            ..ep_mapped("e", &["claude-opus-4-8"], &[("gpt-5", "claude-opus-4-8")])
        };
        let adv = advertised_models(&off);
        assert!(adv.iter().any(|m| m == "claude-opus-4-8"));
        assert!(!adv.iter().any(|m| m.eq_ignore_ascii_case("gpt-5")));
        // 配置仍在，但不改写
        assert_eq!(off.model_mappings.len(), 1);
        assert_eq!(resolve_outbound(&off, Some("gpt-5")), None);
        // 关闭映射后按入站名过滤也不再命中该端点（回退全列表）
        let eps = vec![off.clone(), ep_with_models("cc", &["mimo"])];
        let got = filter_by_model(&eps, Some("gpt-5"));
        assert_eq!(got.len(), 2);
    }
}

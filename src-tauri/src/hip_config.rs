//! HipConfig / TOML mirror types and serde conversions for ~/.hip/config/hip.toml.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Unified TOML config types (wave 1) ──

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct BoundModel {
    // Protocol (packages/protocol) uses capital-ID keys, not plain camelCase.
    #[serde(rename = "providerID")]
    pub(crate) provider_id: String,
    #[serde(rename = "modelID")]
    pub(crate) model_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct ActiveModel {
    // Protocol (packages/protocol) uses capital-ID/URL keys, not plain camelCase.
    #[serde(rename = "providerID")]
    pub(crate) provider_id: String,
    #[serde(rename = "modelID")]
    pub(crate) model_id: String,
    #[serde(rename = "baseURL")]
    pub(crate) base_url: String,
}

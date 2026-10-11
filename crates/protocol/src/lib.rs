//! Public discovery contract. No credentials, SDP or media belong in discovery.

pub mod signaling;

use serde::Serialize;

pub const PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BackendStage {
    Scaffold,
}

#[derive(Debug, Serialize)]
pub struct Capabilities {
    pub protocol_version: u16,
    pub stage: BackendStage,
    pub ready: bool,
    pub signaling_available: bool,
    pub control_plane_available: bool,
    pub authentication_available: bool,
    pub media_available: bool,
    pub e2ee_available: bool,
    pub insecure_local_development: bool,
    pub limits: ControlLimits,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct ControlLimits {
    pub max_concurrent_requests: usize,
    pub max_control_message_bytes: usize,
}

impl Capabilities {
    pub fn scaffold(limits: ControlLimits) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            stage: BackendStage::Scaffold,
            ready: false,
            signaling_available: false,
            control_plane_available: false,
            authentication_available: false,
            media_available: false,
            e2ee_available: false,
            insecure_local_development: true,
            limits,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_does_not_advertise_unimplemented_security_or_media() {
        let value = serde_json::to_value(Capabilities::scaffold(ControlLimits {
            max_concurrent_requests: 128,
            max_control_message_bytes: 16_384,
        }))
        .unwrap();
        assert_eq!(value["protocol_version"], 1);
        assert_eq!(value["stage"], "scaffold");
        for field in [
            "ready",
            "signaling_available",
            "control_plane_available",
            "authentication_available",
            "media_available",
            "e2ee_available",
        ] {
            assert_eq!(value[field], false);
        }
        assert_eq!(value["insecure_local_development"], true);
        assert_eq!(value["limits"]["max_control_message_bytes"], 16_384);
        let plugin_fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/plugin/fixtures/scaffold-capabilities.json"
        ))
        .unwrap();
        assert_eq!(value, plugin_fixture);
    }
}

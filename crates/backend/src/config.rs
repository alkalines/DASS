use std::{net::SocketAddr, time::Duration};

use dass_protocol::ControlLimits;

#[derive(Clone, Debug)]
pub struct Config {
    pub listen_addr: SocketAddr,
    pub limits: ControlLimits,
    pub request_timeout: Duration,
}

impl Config {
    pub fn from_env() -> Result<Self, &'static str> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, &'static str> {
        if lookup("DASS_INSECURE_LOCAL_DEV").as_deref() != Some("true") {
            return Err(
                "TLS and authenticated signaling are not implemented; set DASS_INSECURE_LOCAL_DEV=true only for isolated local development",
            );
        }

        let listen_addr = lookup("DASS_LISTEN_ADDR")
            .unwrap_or_else(|| "127.0.0.1:8080".into())
            .parse()
            .map_err(|_| "DASS_LISTEN_ADDR must be an IP address and port")?;

        Ok(Self {
            listen_addr,
            limits: ControlLimits {
                max_concurrent_requests: bounded_integer(
                    lookup("DASS_MAX_CONCURRENT_REQUESTS"),
                    128,
                    1024,
                )?,
                max_control_message_bytes: bounded_integer(
                    lookup("DASS_MAX_CONTROL_MESSAGE_BYTES"),
                    16_384,
                    65_536,
                )?,
            },
            request_timeout: Duration::from_secs(5),
        })
    }
}

fn bounded_integer(
    value: Option<String>,
    default: usize,
    maximum: usize,
) -> Result<usize, &'static str> {
    let value = match value {
        Some(value) => value.parse().map_err(|_| "invalid numeric limit")?,
        None => default,
    };
    if value == 0 || value > maximum {
        return Err("configured limit is outside the supported range");
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with(entries: &[(&str, &str)]) -> Result<Config, &'static str> {
        Config::from_lookup(|name| {
            entries
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| (*value).into())
        })
    }

    #[test]
    fn refuses_production_and_ambiguous_development_flags() {
        assert!(config_with(&[]).is_err());
        for value in ["false", "1", "TRUE", ""] {
            assert!(config_with(&[("DASS_INSECURE_LOCAL_DEV", value)]).is_err());
        }
    }

    #[test]
    fn local_defaults_are_bounded_and_loopback_only() {
        let config = config_with(&[("DASS_INSECURE_LOCAL_DEV", "true")]).unwrap();
        assert!(config.listen_addr.ip().is_loopback());
        assert_eq!(config.limits.max_concurrent_requests, 128);
        assert_eq!(config.limits.max_control_message_bytes, 16_384);
    }

    #[test]
    fn rejects_invalid_addresses_and_limits_without_echoing_input() {
        for (key, value) in [
            ("DASS_LISTEN_ADDR", "secret.invalid"),
            ("DASS_MAX_CONCURRENT_REQUESTS", "0"),
            ("DASS_MAX_CONCURRENT_REQUESTS", "1025"),
            ("DASS_MAX_CONCURRENT_REQUESTS", "-1"),
            ("DASS_MAX_CONTROL_MESSAGE_BYTES", "65537"),
            ("DASS_MAX_CONTROL_MESSAGE_BYTES", "secret"),
        ] {
            let error =
                config_with(&[("DASS_INSECURE_LOCAL_DEV", "true"), (key, value)]).unwrap_err();
            assert!(!error.contains(value));
        }
    }

    #[test]
    fn accepts_container_bind_and_explicit_limits() {
        let config = config_with(&[
            ("DASS_INSECURE_LOCAL_DEV", "true"),
            ("DASS_LISTEN_ADDR", "0.0.0.0:8080"),
            ("DASS_MAX_CONCURRENT_REQUESTS", "32"),
            ("DASS_MAX_CONTROL_MESSAGE_BYTES", "8192"),
        ])
        .unwrap();
        assert!(config.listen_addr.ip().is_unspecified());
        assert_eq!(config.limits.max_concurrent_requests, 32);
        assert_eq!(config.limits.max_control_message_bytes, 8192);
    }
}

use std::{fmt, net::SocketAddr, path::PathBuf, time::Duration};

use dass_protocol::ControlLimits;

use crate::auth::{InviteStore, MAX_USERS_FILE_BYTES};
use crate::transport::TransportMode;

/// Bounded, short-lived login handshakes; anonymous service access is never allowed.
pub const DEFAULT_MAX_LOGIN_HANDSHAKES: usize = 16;

/// Bounded service resources. Every queue, socket and worker pool has an
/// explicit limit so one account or one source cannot monopolize the service.
#[derive(Clone, Copy, Debug)]
pub struct ResourceLimits {
    /// Authenticated signaling sessions.
    pub max_sessions: usize,
    /// Signaling sessions that have not authenticated yet.
    pub max_login_handshakes: usize,
    /// Accepted TCP connections, including the ones still handshaking.
    pub max_tcp_connections: usize,
    /// Concurrent password verifications.
    pub max_password_verifications: usize,
}

impl Default for ResourceLimits {
    fn default() -> Self {
        Self {
            max_sessions: 128,
            max_login_handshakes: DEFAULT_MAX_LOGIN_HANDSHAKES,
            max_tcp_connections: 128,
            max_password_verifications: 2,
        }
    }
}

#[derive(Clone)]
pub struct Config {
    pub listen_addr: SocketAddr,
    pub limits: ControlLimits,
    pub resources: ResourceLimits,
    pub transport_mode: TransportMode,
    pub request_timeout: Duration,
    pub tls: Option<TlsFiles>,
    pub invite_file: Option<PathBuf>,
    pub users_json: Option<String>,
}

impl fmt::Debug for Config {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Config")
            .field("listen_addr", &self.listen_addr)
            .field("limits", &self.limits)
            .field("resources", &self.resources)
            .field("transport_mode", &self.transport_mode)
            .field("request_timeout", &self.request_timeout)
            .field("tls", &self.tls)
            .field("invite_file", &self.invite_file)
            .field(
                "users_json",
                &self.users_json.as_ref().map(|_| "[REDACTED]"),
            )
            .finish()
    }
}

#[derive(Clone, Debug)]
pub struct TlsFiles {
    pub certificate: PathBuf,
    pub private_key: PathBuf,
}

impl Config {
    pub fn from_env() -> Result<Self, &'static str> {
        if std::env::var_os("DASS_USERS").is_some() && std::env::var("DASS_USERS").is_err() {
            return Err("DASS_USERS must be UTF-8 JSON");
        }
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, &'static str> {
        if lookup("DASS_MAX_UNAUTHENTICATED_SESSIONS").is_some_and(|value| value != "0") {
            return Err("anonymous access is disabled; unauthenticated sessions must remain 0");
        }
        let insecure = match lookup("DASS_INSECURE_LOCAL_DEV").as_deref() {
            None | Some("false") => false,
            Some("true") => true,
            _ => return Err("DASS_INSECURE_LOCAL_DEV must be true or false"),
        };
        let transport_mode = match lookup("DASS_TRANSPORT_MODE").as_deref() {
            None | Some("local") => TransportMode::Local,
            Some(value) => TransportMode::parse(value)?,
        };
        // A public deployment is never allowed to fall back to plaintext
        // development configuration: it would expose credentials and media
        // keys to the network.
        if insecure && transport_mode == TransportMode::Public {
            return Err("a public deployment must not use insecure local development mode");
        }
        let tls = match (lookup("DASS_TLS_CERT_FILE"), lookup("DASS_TLS_KEY_FILE")) {
            (Some(certificate), Some(private_key))
                if !certificate.is_empty() && !private_key.is_empty() =>
            {
                Some(TlsFiles {
                    certificate: certificate.into(),
                    private_key: private_key.into(),
                })
            }
            (None, None) if insecure => None,
            _ => {
                return Err(
                    "provide both TLS certificate and key files; plaintext requires explicit isolated local development",
                );
            }
        };
        if insecure && tls.is_some() {
            return Err("do not combine TLS with insecure development mode");
        }

        let listen_addr: SocketAddr = lookup("DASS_LISTEN_ADDR")
            .unwrap_or_else(|| "127.0.0.1:8080".into())
            .parse()
            .map_err(|_| "DASS_LISTEN_ADDR must be an IP address and port")?;
        // Unspecified container binds are allowed only behind loopback host publication.
        if insecure && !listen_addr.ip().is_loopback() && !listen_addr.ip().is_unspecified() {
            return Err("plaintext development requires a loopback or isolated container bind");
        }
        let invite_file = lookup("DASS_INVITE_FILE").map(PathBuf::from);
        if invite_file
            .as_ref()
            .is_some_and(|path| path.as_os_str().is_empty())
        {
            return Err("empty invite file path");
        }
        let users_json = lookup("DASS_USERS");
        if users_json
            .as_ref()
            .is_some_and(|users| users.is_empty() || users.len() > MAX_USERS_FILE_BYTES)
        {
            return Err("DASS_USERS is empty or exceeds its size limit");
        }
        if let Some(users) = users_json.as_ref() {
            InviteStore::from_users_bytes(users.as_bytes())
                .map_err(|_| "invalid DASS_USERS configuration")?;
        }
        if invite_file.is_some() && users_json.is_some() {
            return Err("configure only one of DASS_INVITE_FILE or DASS_USERS");
        }
        if !insecure && invite_file.is_none() && users_json.is_none() {
            return Err("TLS mode requires DASS_INVITE_FILE or DASS_USERS");
        }
        let mut max_control_message_bytes =
            bounded_integer(lookup("DASS_MAX_CONTROL_MESSAGE_BYTES"), 16_384, 65_536)?;
        if invite_file.is_some() || users_json.is_some() {
            if max_control_message_bytes < 1024 {
                return Err("authenticated control messages require at least 1024 bytes");
            }
            max_control_message_bytes =
                max_control_message_bytes.min(dass_protocol::signaling::MAX_MESSAGE_BYTES);
        }

        Ok(Self {
            listen_addr,
            limits: ControlLimits {
                max_concurrent_requests: bounded_integer(
                    lookup("DASS_MAX_CONCURRENT_REQUESTS"),
                    128,
                    1024,
                )?,
                max_control_message_bytes,
            },
            resources: ResourceLimits {
                max_sessions: bounded_integer(lookup("DASS_MAX_SESSIONS"), 128, 4096)?,
                max_login_handshakes: bounded_integer(
                    lookup("DASS_MAX_LOGIN_HANDSHAKES"),
                    16,
                    256,
                )?,
                max_tcp_connections: bounded_integer(
                    lookup("DASS_MAX_TCP_CONNECTIONS"),
                    128,
                    4096,
                )?,
                max_password_verifications: bounded_integer(
                    lookup("DASS_MAX_PASSWORD_VERIFICATIONS"),
                    2,
                    16,
                )?,
            },
            transport_mode,
            request_timeout: Duration::from_secs(5),
            tls,
            invite_file,
            users_json,
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

    #[test]
    fn tls_configuration_is_required_outside_development() {
        let entries = [
            ("DASS_TLS_CERT_FILE", "/run/secrets/cert.pem"),
            ("DASS_TLS_KEY_FILE", "/run/secrets/key.pem"),
            ("DASS_INVITE_FILE", "/run/secrets/invites.json"),
        ];
        assert!(config_with(&entries).unwrap().tls.is_some());
        assert!(
            config_with(&[
                ("DASS_TLS_CERT_FILE", "/run/secrets/cert.pem"),
                ("DASS_TLS_KEY_FILE", "/run/secrets/key.pem"),
                ("DASS_USERS", r#"{"version":2,"users":[]}"#),
            ])
            .unwrap()
            .users_json
            .is_some()
        );
        assert!(config_with(&entries[..1]).is_err());
        assert!(config_with(&entries[..2]).is_err());
        assert!(
            config_with(&[
                ("DASS_INSECURE_LOCAL_DEV", "true"),
                ("DASS_LISTEN_ADDR", "192.0.2.1:8080"),
            ])
            .is_err()
        );
        assert!(
            config_with(&[
                ("DASS_INSECURE_LOCAL_DEV", "true"),
                ("DASS_INVITE_FILE", "/run/secrets/invites.json"),
                ("DASS_MAX_CONTROL_MESSAGE_BYTES", "512"),
            ])
            .is_err()
        );
    }

    #[test]
    fn public_mode_rejects_plaintext_development_and_bounds_resources() {
        // A public deployment never runs without TLS.
        assert!(
            config_with(&[
                ("DASS_INSECURE_LOCAL_DEV", "true"),
                ("DASS_TRANSPORT_MODE", "public"),
            ])
            .is_err()
        );
        assert!(
            config_with(&[
                ("DASS_TRANSPORT_MODE", "public"),
                ("DASS_TLS_CERT_FILE", "/run/secrets/cert.pem"),
                ("DASS_TLS_KEY_FILE", "/run/secrets/key.pem"),
                ("DASS_INVITE_FILE", "/run/secrets/invites.json"),
            ])
            .unwrap()
            .transport_mode
                == TransportMode::Public
        );
        assert!(config_with(&[("DASS_TRANSPORT_MODE", "peer")]).is_err());

        let resources = config_with(&[
            ("DASS_INSECURE_LOCAL_DEV", "true"),
            ("DASS_MAX_SESSIONS", "32"),
            ("DASS_MAX_UNAUTHENTICATED_SESSIONS", "0"),
            ("DASS_MAX_LOGIN_HANDSHAKES", "4"),
            ("DASS_MAX_TCP_CONNECTIONS", "64"),
            ("DASS_MAX_PASSWORD_VERIFICATIONS", "8"),
        ])
        .unwrap()
        .resources;
        assert_eq!(resources.max_sessions, 32);
        assert_eq!(resources.max_login_handshakes, 4);
        assert_eq!(resources.max_tcp_connections, 64);
        assert_eq!(resources.max_password_verifications, 8);

        for (key, value) in [
            ("DASS_MAX_SESSIONS", "0"),
            ("DASS_MAX_SESSIONS", "4097"),
            ("DASS_MAX_UNAUTHENTICATED_SESSIONS", "257"),
            ("DASS_MAX_LOGIN_HANDSHAKES", "0"),
            ("DASS_MAX_LOGIN_HANDSHAKES", "257"),
            ("DASS_MAX_TCP_CONNECTIONS", "-1"),
            ("DASS_MAX_PASSWORD_VERIFICATIONS", "17"),
        ] {
            assert!(
                config_with(&[("DASS_INSECURE_LOCAL_DEV", "true"), (key, value)]).is_err(),
                "accepted {key}={value}"
            );
        }
    }

    #[test]
    fn user_env_is_validated_bounded_and_exclusive_with_invite_file() {
        let valid_users = r#"{"version":2,"users":[]}"#;
        assert!(
            config_with(&[
                ("DASS_INSECURE_LOCAL_DEV", "true"),
                ("DASS_USERS", valid_users),
            ])
            .unwrap()
            .users_json
            .is_some()
        );
        for users in ["", "not-json", r#"{"version":1,"users":[]}"#] {
            assert!(
                config_with(&[("DASS_INSECURE_LOCAL_DEV", "true"), ("DASS_USERS", users)]).is_err()
            );
        }
        assert!(
            config_with(&[
                ("DASS_INSECURE_LOCAL_DEV", "true"),
                ("DASS_INVITE_FILE", "/run/secrets/invites.json"),
                ("DASS_USERS", valid_users),
            ])
            .is_err()
        );
        assert!(
            config_with(&[
                ("DASS_INSECURE_LOCAL_DEV", "true"),
                ("DASS_USERS", &"x".repeat(MAX_USERS_FILE_BYTES + 1)),
            ])
            .is_err()
        );

        let secret_bearing_config = config_with(&[
            ("DASS_INSECURE_LOCAL_DEV", "true"),
            ("DASS_USERS", valid_users),
        ])
        .unwrap();
        assert!(!format!("{secret_bearing_config:?}").contains(valid_users));
    }
}

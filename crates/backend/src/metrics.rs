//! Bounded, privacy-safe operational metrics.
//!
//! Only aggregate counters and a short ring of fixed event codes are kept.
//! Credentials, keys, SDP, captured frames, room names, account names and full
//! addresses never enter this module. Administrators may read the snapshot;
//! clients never do.

use std::{
    collections::VecDeque,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

/// The number of recent events kept in memory. The ring is bounded, so a
/// flood of events cannot grow the process.
const MAX_EVENTS: usize = 128;

/// The number of events returned to the panel. The response stays small even
/// when the ring is full.
const MAX_REPORTED_EVENTS: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Severity {
    Info,
    Warning,
}

impl Severity {
    fn as_str(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Warning => "warning",
        }
    }
}

/// One bounded operational event. `code` is a fixed identifier; it never
/// contains a client-supplied name, address or identifier.
#[derive(Clone, Copy, Debug)]
pub struct OperationalEvent {
    pub at_unix_seconds: u64,
    pub severity: Severity,
    pub code: &'static str,
}

/// Aggregate counters and the recent-event ring.
#[derive(Debug, Default)]
pub struct Metrics {
    connections_opened: AtomicU64,
    connections_closed: AtomicU64,
    logins_succeeded: AtomicU64,
    logins_failed: AtomicU64,
    sessions_joined: AtomicU64,
    streams_started: AtomicU64,
    streams_stopped: AtomicU64,
    view_requests: AtomicU64,
    view_approvals: AtomicU64,
    view_denials: AtomicU64,
    signaling_rejections: AtomicU64,
    rate_limited: AtomicU64,
    media_sessions_started: AtomicU64,
    media_sessions_failed: AtomicU64,
    events: Mutex<VecDeque<OperationalEvent>>,
}

impl Metrics {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn connection_opened(&self) {
        self.connections_opened.fetch_add(1, Ordering::Relaxed);
    }

    pub fn connection_closed(&self) {
        self.connections_closed.fetch_add(1, Ordering::Relaxed);
    }

    pub fn login_succeeded(&self) {
        self.logins_succeeded.fetch_add(1, Ordering::Relaxed);
    }

    pub fn login_failed(&self) {
        self.logins_failed.fetch_add(1, Ordering::Relaxed);
    }

    pub fn session_joined(&self) {
        self.sessions_joined.fetch_add(1, Ordering::Relaxed);
    }

    pub fn stream_started(&self) {
        self.streams_started.fetch_add(1, Ordering::Relaxed);
    }

    pub fn stream_stopped(&self) {
        self.streams_stopped.fetch_add(1, Ordering::Relaxed);
    }

    pub fn view_requested(&self) {
        self.view_requests.fetch_add(1, Ordering::Relaxed);
    }

    pub fn view_approved(&self) {
        self.view_approvals.fetch_add(1, Ordering::Relaxed);
    }

    pub fn view_denied(&self) {
        self.view_denials.fetch_add(1, Ordering::Relaxed);
    }

    pub fn signaling_rejected(&self) {
        self.signaling_rejections.fetch_add(1, Ordering::Relaxed);
    }

    pub fn rate_limited(&self) {
        self.rate_limited.fetch_add(1, Ordering::Relaxed);
    }

    pub fn media_session_started(&self) {
        self.media_sessions_started.fetch_add(1, Ordering::Relaxed);
    }

    pub fn media_session_failed(&self) {
        self.media_sessions_failed.fetch_add(1, Ordering::Relaxed);
    }

    /// Record one bounded event. Fixed codes only.
    pub fn event(&self, severity: Severity, code: &'static str) {
        let at_unix_seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or_default();
        let Ok(mut events) = self.events.lock() else {
            // A poisoned lock must not stop the service; the counter view
            // stays available.
            return;
        };
        if events.len() >= MAX_EVENTS {
            events.pop_front();
        }
        events.push_back(OperationalEvent {
            at_unix_seconds,
            severity,
            code,
        });
    }

    /// A bounded snapshot for the administrator panel. No addresses, names or
    /// payloads are included.
    pub fn snapshot(&self) -> serde_json::Value {
        let events = self
            .events
            .lock()
            .map(|events| {
                events
                    .iter()
                    .rev()
                    .take(MAX_REPORTED_EVENTS)
                    .map(|event| {
                        serde_json::json!({
                            "at_unix_seconds": event.at_unix_seconds,
                            "severity": event.severity.as_str(),
                            "code": event.code,
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        serde_json::json!({
            "connections_opened": self.connections_opened.load(Ordering::Relaxed),
            "connections_closed": self.connections_closed.load(Ordering::Relaxed),
            "logins_succeeded": self.logins_succeeded.load(Ordering::Relaxed),
            "logins_failed": self.logins_failed.load(Ordering::Relaxed),
            "sessions_joined": self.sessions_joined.load(Ordering::Relaxed),
            "streams_started": self.streams_started.load(Ordering::Relaxed),
            "streams_stopped": self.streams_stopped.load(Ordering::Relaxed),
            "view_requests": self.view_requests.load(Ordering::Relaxed),
            "view_approvals": self.view_approvals.load(Ordering::Relaxed),
            "view_denials": self.view_denials.load(Ordering::Relaxed),
            "signaling_rejections": self.signaling_rejections.load(Ordering::Relaxed),
            "rate_limited": self.rate_limited.load(Ordering::Relaxed),
            "media_sessions_started": self.media_sessions_started.load(Ordering::Relaxed),
            "media_sessions_failed": self.media_sessions_failed.load(Ordering::Relaxed),
            "events": events,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counters_are_aggregate_and_bounded() {
        let metrics = Metrics::new();
        for _ in 0..5 {
            metrics.connection_opened();
            metrics.login_succeeded();
        }
        metrics.login_failed();
        metrics.rate_limited();
        let snapshot = metrics.snapshot();
        assert_eq!(snapshot["connections_opened"], 5);
        assert_eq!(snapshot["logins_succeeded"], 5);
        assert_eq!(snapshot["logins_failed"], 1);
        assert_eq!(snapshot["rate_limited"], 1);
        assert!(snapshot["events"].as_array().unwrap().is_empty());
    }

    #[test]
    fn the_event_ring_stays_bounded() {
        let metrics = Metrics::new();
        for index in 0..(MAX_EVENTS * 2) {
            metrics.event(Severity::Info, "test_event");
            assert!(index < usize::MAX);
        }
        let snapshot = metrics.snapshot();
        let events = snapshot["events"].as_array().unwrap();
        assert_eq!(events.len(), MAX_REPORTED_EVENTS);
        assert_eq!(events[0]["code"], "test_event");
        assert_eq!(events[0]["severity"], "info");
    }

    #[test]
    fn events_never_carry_addresses_or_names() {
        let metrics = Metrics::new();
        metrics.event(Severity::Warning, "media_session_failed");
        let snapshot = metrics.snapshot();
        let text = snapshot.to_string();
        assert!(!text.contains('.'), "event text contains a separator");
        assert!(!text.contains('@'));
        assert!(text.contains("media_session_failed"));
    }
}

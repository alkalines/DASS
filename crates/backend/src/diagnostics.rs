//! Small, volatile administrator-only diagnostic timeline. Never a raw console sink.
use serde_json::{Map, Value, json};
use std::{
    collections::VecDeque,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tracing::{
    Event, Subscriber,
    field::{Field, Visit},
    span::{Attributes, Id},
};
use tracing_subscriber::{Layer, layer::Context, registry::LookupSpan};

const MAX_ENTRIES: usize = 512;
static ENTRIES: OnceLock<Mutex<VecDeque<Value>>> = OnceLock::new();

fn append(mut entry: Value) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    entry["received_at_unix_ms"] = json!(now.as_millis() as u64);
    if let Ok(mut entries) = ENTRIES.get_or_init(Mutex::default).lock() {
        if entries.len() >= MAX_ENTRIES {
            entries.pop_front();
        }
        entries.push_back(entry);
    }
}

pub fn snapshot() -> Value {
    let entries = ENTRIES
        .get_or_init(Mutex::default)
        .lock()
        .map(|entries| entries.iter().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    json!({ "entries": entries, "capacity": MAX_ENTRIES })
}

// Fixed application events only. Unrecognized events/fields are not retained.
const CLIENT_EVENTS: &[&str] = &[
    "signaling connecting",
    "signaling authenticated",
    "signaling response",
    "signaling request",
    "signaling closed",
    "peer prepared",
    "peer preparation failed",
    "media stats pending",
    "media stats",
    "media stats unavailable",
    "peer failed",
    "peer connection state",
    "viewer track received",
    "E2EE frame stats",
    "E2EE key installation",
    "viewer phase",
    "viewer setup failed",
    "viewer reconnect scheduled",
    "viewer reconnect stopped",
    "epoch key unwrap failed",
    "publisher phase",
    "publisher signaling closed",
    "publisher setup failed",
    "view request trust evaluation failed",
    "publisher activation failed",
    "publisher decision failed",
    "viewer identity pin persistence failed",
    "epoch rekey failed; publishing stopped",
    "viewer removal failed",
    "plugin started",
    "plugin stopped",
    "share action intercepted",
    "transport selected",
    "capture unavailable",
    "capture picker requested",
    "capture acquired",
    "capture failed or cancelled",
    "account login failed",
    "account state",
    "native stream sounds unavailable",
];

fn safe_details(text: &str) -> Value {
    let Ok(Value::Object(details)) = serde_json::from_str::<Value>(text) else {
        return json!({});
    };
    let mut safe = Map::new();
    for (key, value) in details.into_iter().take(48) {
        let numeric = matches!(
            key.as_str(),
            "candidateCount"
                | "payloadType"
                | "clockRate"
                | "channels"
                | "bytesReceived"
                | "packetsReceived"
                | "packetsLost"
                | "framesReceived"
                | "framesDecoded"
                | "keyFramesDecoded"
                | "framesDropped"
                | "pliCount"
                | "firCount"
                | "nackCount"
                | "bytesSent"
                | "packetsSent"
                | "framesEncoded"
                | "keyFramesEncoded"
                | "framesSent"
                | "frameWidth"
                | "frameHeight"
                | "framesPerSecond"
                | "jitter"
                | "totalDecodeTime"
                | "totalEncodeTime"
                | "inputFrames"
                | "outputFrames"
                | "missingKeyFrames"
                | "malformedFrames"
                | "authenticationFailures"
                | "headerMismatches"
                | "replayDrops"
                | "attempt"
        );
        let flag = matches!(
            key.as_str(),
            "publisher"
                | "accountLogin"
                | "audioSelected"
                | "configured"
                | "defaultDass"
                | "pluginActive"
                | "powerEfficientDecoder"
                | "pipelineFailed"
        );
        let label = matches!(
            key.as_str(),
            "role"
                | "kind"
                | "codec"
                | "phase"
                | "connection"
                | "ice"
                | "stage"
                | "status"
                | "transport"
                | "type"
                | "code"
                | "pendingType"
                | "requestType"
                | "encoderImplementation"
                | "decoderImplementation"
        );
        if (numeric && value.is_number()) || (flag && value.is_boolean()) {
            safe.insert(key, value);
        } else if label && let Some(label) = value.as_str() {
            // Do not retain arbitrary browser strings, errors or client-supplied text.
            let allowed = matches!(
                label,
                "publisher"
                    | "viewer"
                    | "video"
                    | "audio"
                    | "video/vp8"
                    | "video/vp9"
                    | "video/h264"
                    | "video/av1"
                    | "audio/opus"
                    | "video/rtx"
                    | "idle"
                    | "loading"
                    | "ready"
                    | "failed"
                    | "unauthorized"
                    | "stopped"
                    | "starting"
                    | "authenticating"
                    | "capturing"
                    | "preparing"
                    | "prepared"
                    | "activating"
                    | "connection"
                    | "capture"
                    | "capture_tracks"
                    | "stale"
                    | "publishing"
                    | "watching"
                    | "connecting"
                    | "connected"
                    | "disconnected"
                    | "closed"
                    | "new"
                    | "checking"
                    | "completed"
                    | "gathering"
                    | "complete"
                    | "accepted"
                    | "rejected"
                    | "installed"
                    | "dass"
                    | "discord"
                    | "none"
                    | "unknown"
                    | "cancelled"
                    | "socket"
                    | "protocol"
                    | "timeout"
                    | "expired"
                    | "overloaded"
                    | "join"
                    | "joined"
                    | "publish"
                    | "subscribe"
                    | "offer"
                    | "answer"
                    | "ice"
                    | "leave"
                    | "authenticated"
                    | "login"
                    | "account_login"
                    | "request_view"
                    | "view_request_pending"
                    | "view_decision"
                    | "remove_viewer"
                    | "enable_viewer_presence"
                    | "key_relay"
                    | "AbortError"
                    | "NotAllowedError"
                    | "NotFoundError"
                    | "NotReadableError"
                    | "OverconstrainedError"
                    | "SecurityError"
                    | "InvalidStateError"
                    | "NotSupportedError"
                    | "TypeError"
                    | "bridge_missing_or_incompatible"
                    | "libvpx"
                    | "libvpx vp8"
                    | "libvpx vp9"
                    | "openh264"
                    | "ffmpeg"
                    | "external"
                    | "other"
                    | "rejected:unauthorized"
                    | "rejected:replay"
                    | "rejected:overloaded"
                    | "server:revoked"
                    | "server:expired"
                    | "server:transport_failed"
                    | "server:setup_timeout"
                    | "server:left"
                    | "server:overloaded"
                    | "rejected:invalid_state"
                    | "rejected:invalid_message"
                    | "rejected:denied"
                    | "rejected:e2ee_unavailable"
                    | "rejected:transport_unavailable"
                    | "preparation"
                    | "signaling"
                    | "viewer_presence"
                    | "approval_timeout"
                    | "denied"
                    | "disconnected_timeout"
                    | "connection:failed"
                    | "connection:closed"
                    | "connection:disconnected_timeout"
            );
            safe.insert(key, json!(if allowed { label } else { "other" }));
        }
    }
    Value::Object(safe)
}

pub fn record_client(
    client_id: &str,
    connection: u64,
    entries: &[dass_protocol::signaling::DiagnosticEntry],
) {
    for entry in entries {
        if !CLIENT_EVENTS.contains(&entry.event.as_str()) {
            continue;
        }
        append(json!({
            "source": "client", "client_id": client_id, "connection": connection,
            "at_unix_ms": u64::from(entry.at_unix_seconds) * 1000 + u64::from(entry.milliseconds),
            "level": if entry.failed { "error" } else { "info" },
            "event": entry.event, "details": safe_details(&entry.details),
        }));
    }
}

#[derive(Default, Clone)]
struct Fields(Map<String, Value>);
impl Visit for Fields {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            let value = format!("{value:?}");
            self.0.insert(
                "event".into(),
                json!(value.chars().take(160).collect::<String>()),
            );
        }
    }
    fn record_str(&mut self, field: &Field, value: &str) {
        if matches!(
            field.name(),
            "code" | "stage" | "operation" | "transport_mode"
        ) {
            self.0.insert(
                field.name().into(),
                json!(value.chars().take(64).collect::<String>()),
            );
        }
    }
    fn record_u64(&mut self, field: &Field, value: u64) {
        if field.name() == "connection" {
            self.0.insert("connection".into(), json!(value));
        }
    }
    fn record_bool(&mut self, field: &Field, value: bool) {
        if matches!(field.name(), "tls" | "signaling" | "joined" | "rejected") {
            self.0.insert(field.name().into(), json!(value));
        }
    }
}

pub struct DiagnosticLayer;
impl<S: Subscriber + for<'a> LookupSpan<'a>> Layer<S> for DiagnosticLayer {
    fn on_new_span(&self, attrs: &Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
        let mut fields = Fields::default();
        attrs.record(&mut fields);
        if let Some(span) = ctx.span(id) {
            span.extensions_mut().insert(fields);
        }
    }
    fn on_event(&self, event: &Event<'_>, ctx: Context<'_, S>) {
        if !event.metadata().target().starts_with("dass_backend") {
            return;
        }
        let mut fields = Fields::default();
        if let Some(scope) = ctx.event_scope(event) {
            for span in scope.from_root() {
                if let Some(values) = span.extensions().get::<Fields>() {
                    fields.0.extend(values.0.clone());
                }
            }
        }
        event.record(&mut fields);
        let message = fields.0.remove("event").unwrap_or(json!("backend event"));
        let at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        append(
            json!({ "source": "server", "at_unix_ms": at, "level": event.metadata().level().as_str().to_lowercase(),
            "event": message, "details": fields.0 }),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    static TEST_LOCK: Mutex<()> = Mutex::new(());
    #[test]
    fn details_never_retain_unknown_fields_or_arbitrary_strings() {
        assert_eq!(
            safe_details(
                r#"{"password":"secret","code":"secret","role":"viewer","packetsLost":3,"sdp":"secret"}"#
            ),
            json!({"code":"other","role":"viewer","packetsLost":3})
        );
        assert_eq!(safe_details("not json"), json!({}));
    }

    #[test]
    fn server_layer_preserves_connection_but_not_unknown_fields() {
        use tracing_subscriber::layer::SubscriberExt;
        let _guard = TEST_LOCK.lock().unwrap();
        let subscriber = tracing_subscriber::registry().with(DiagnosticLayer);
        tracing::subscriber::with_default(subscriber, || {
            let span = tracing::info_span!("signaling", connection = 987654_u64);
            let _entered = span.enter();
            tracing::info!(
                code = "timeout",
                password = "never retain this",
                "diagnostic layer test"
            );
            let snapshot = snapshot();
            let entry = snapshot["entries"]
                .as_array()
                .unwrap()
                .iter()
                .find(|entry| entry["event"] == "diagnostic layer test")
                .unwrap();
            assert_eq!(
                entry["details"],
                json!({"connection": 987654, "code": "timeout"})
            );
        });
    }

    #[test]
    fn diagnostic_ring_is_bounded() {
        let _guard = TEST_LOCK.lock().unwrap();
        for _ in 0..MAX_ENTRIES + 10 {
            append(json!({"source": "server"}));
        }
        assert!(snapshot()["entries"].as_array().unwrap().len() <= MAX_ENTRIES);
    }
}

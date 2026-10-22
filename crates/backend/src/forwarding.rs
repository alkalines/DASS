//! Resource-bounded multi-publisher packet fan-out; not a production SFU.
//! Media stays in bounded, in-process channels, never signaling JSON or IPC.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use str0m::format::Codec;
use tokio::sync::{OwnedSemaphorePermit, Semaphore, mpsc};

pub const PACKET_QUEUE_CAPACITY: usize = 32;
const MAX_PAYLOAD_BYTES: usize = 2_048;

#[derive(Clone)]
pub struct ForwardPacket {
    pub codec: Codec,
    pub timestamp: u32,
    pub marker: bool,
    pub payload: Arc<[u8]>,
}

pub struct MediaHub {
    publishers: Mutex<HashMap<String, Arc<PublisherRegistration>>>,
    admission: Arc<Semaphore>,
}

struct PublisherRegistration {
    room_id: String,
    publisher_id: String,
    state: Mutex<PublisherState>,
    keyframes: mpsc::Sender<()>,
}

struct PublisherState {
    active: bool,
    viewers: HashMap<String, ViewerRegistration>,
}

struct ViewerRegistration {
    identity: Arc<()>,
    packets: mpsc::Sender<ForwardPacket>,
    ready: bool,
}

pub struct PublisherEndpoint {
    hub: Arc<MediaHub>,
    publisher: Arc<PublisherRegistration>,
    keyframes: mpsc::Receiver<()>,
    _admission: OwnedSemaphorePermit,
}

pub struct SubscriberEndpoint {
    publisher: Arc<PublisherRegistration>,
    identity: Arc<()>,
    subscriber_id: String,
    packets: mpsc::Receiver<ForwardPacket>,
    _admission: OwnedSemaphorePermit,
}

#[derive(Debug)]
pub struct RouteFailure;

impl Default for MediaHub {
    fn default() -> Self {
        Self::new(4)
    }
}

impl PublisherRegistration {
    fn close(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.active = false;
            state.viewers.clear();
        }
    }
}

impl MediaHub {
    pub fn new(max_sessions: usize) -> Self {
        Self {
            publishers: Mutex::new(HashMap::new()),
            admission: Arc::new(Semaphore::new(max_sessions)),
        }
    }

    pub fn publish(
        self: &Arc<Self>,
        room_id: &str,
        publisher_id: &str,
    ) -> Result<PublisherEndpoint, RouteFailure> {
        let admission = self
            .admission
            .clone()
            .try_acquire_owned()
            .map_err(|_| RouteFailure)?;
        let mut registration = self.publishers.lock().map_err(|_| RouteFailure)?;
        if registration.contains_key(publisher_id) {
            return Err(RouteFailure);
        }
        let (sender, receiver) = mpsc::channel(1);
        let publisher = Arc::new(PublisherRegistration {
            room_id: room_id.into(),
            publisher_id: publisher_id.into(),
            state: Mutex::new(PublisherState {
                active: true,
                viewers: HashMap::new(),
            }),
            keyframes: sender,
        });
        registration.insert(publisher_id.into(), publisher.clone());
        Ok(PublisherEndpoint {
            hub: self.clone(),
            publisher,
            keyframes: receiver,
            _admission: admission,
        })
    }

    pub fn subscribe(
        self: &Arc<Self>,
        room_id: &str,
        publisher_id: &str,
        subscriber_id: &str,
    ) -> Result<SubscriberEndpoint, RouteFailure> {
        let admission = self
            .admission
            .clone()
            .try_acquire_owned()
            .map_err(|_| RouteFailure)?;
        let publisher = self
            .publishers
            .lock()
            .map_err(|_| RouteFailure)?
            .get(publisher_id)
            .cloned()
            .ok_or(RouteFailure)?;
        let mut state = publisher.state.lock().map_err(|_| RouteFailure)?;
        if !state.active
            || publisher.room_id != room_id
            || publisher_id == subscriber_id
            || state.viewers.contains_key(subscriber_id)
        {
            return Err(RouteFailure);
        }
        let (sender, receiver) = mpsc::channel(PACKET_QUEUE_CAPACITY);
        let identity = Arc::new(());
        state.viewers.insert(
            subscriber_id.into(),
            ViewerRegistration {
                identity: identity.clone(),
                packets: sender,
                ready: false,
            },
        );
        drop(state);
        Ok(SubscriberEndpoint {
            publisher,
            identity,
            subscriber_id: subscriber_id.into(),
            packets: receiver,
            _admission: admission,
        })
    }

    /// Immediate route teardown: drop the registration and every queued media
    /// packet so publisher stop/withdrawal leaves nothing to forward.
    pub fn close_publisher(&self, publisher_id: &str) {
        if let Ok(mut registration) = self.publishers.lock()
            && let Some(publisher) = registration.remove(publisher_id)
        {
            publisher.close();
        }
    }

    /// Drop one viewer's route and its queued packets without waiting for the
    /// viewer's connection loop. Used for publisher removal and blocking.
    pub fn drop_viewer(&self, publisher_id: &str, subscriber_id: &str) {
        if let Ok(registration) = self.publishers.lock()
            && let Some(publisher) = registration.get(publisher_id)
            && let Ok(mut state) = publisher.state.lock()
        {
            state.viewers.remove(subscriber_id);
        }
    }
}

impl PublisherEndpoint {
    pub fn forward(&self, packet: ForwardPacket) -> Result<(), RouteFailure> {
        if packet.payload.len() > MAX_PAYLOAD_BYTES
            || !matches!(packet.codec, Codec::Opus | Codec::Vp8)
        {
            return Err(RouteFailure);
        }
        let mut state = self.publisher.state.lock().map_err(|_| RouteFailure)?;
        if !state.active {
            return Err(RouteFailure);
        }
        // Only Arc-backed payload handles are cloned. Never wait for a viewer:
        // a full/closed queue removes that viewer, not the other recipients.
        // No registry/global media lock is held while fanning out a packet.
        state
            .viewers
            .retain(|_, viewer| !viewer.ready || viewer.packets.try_send(packet.clone()).is_ok());
        Ok(())
    }

    pub fn take_keyframe_request(&mut self) -> bool {
        self.keyframes.try_recv().is_ok()
    }

    pub fn has_ready_viewer(&self) -> bool {
        self.publisher
            .state
            .lock()
            .ok()
            .is_some_and(|state| state.active && state.viewers.values().any(|viewer| viewer.ready))
    }
}

impl SubscriberEndpoint {
    pub fn try_packet(&mut self) -> Result<Option<ForwardPacket>, RouteFailure> {
        // Check liveness before draining queued media: source teardown invalidates
        // cached packets instead of playing them after authorization has ended.
        let state = self.publisher.state.lock().map_err(|_| RouteFailure)?;
        if !state.active
            || !state
                .viewers
                .get(&self.subscriber_id)
                .is_some_and(|viewer| Arc::ptr_eq(&viewer.identity, &self.identity))
        {
            return Err(RouteFailure);
        }
        match self.packets.try_recv() {
            Ok(packet) => Ok(Some(packet)),
            Err(mpsc::error::TryRecvError::Empty) => Ok(None),
            Err(mpsc::error::TryRecvError::Disconnected) => Err(RouteFailure),
        }
    }

    pub fn request_keyframe(&self) {
        // A capacity-one queue coalesces requests; no unbounded feedback traffic.
        if let Ok(state) = self.publisher.state.lock()
            && state.active
            && state
                .viewers
                .get(&self.subscriber_id)
                .is_some_and(|viewer| Arc::ptr_eq(&viewer.identity, &self.identity))
        {
            let _ = self.publisher.keyframes.try_send(());
        }
    }

    pub fn set_ready(&self) -> Result<(), RouteFailure> {
        let mut state = self.publisher.state.lock().map_err(|_| RouteFailure)?;
        if !state.active {
            return Err(RouteFailure);
        }
        let viewer = state
            .viewers
            .get_mut(&self.subscriber_id)
            .filter(|viewer| Arc::ptr_eq(&viewer.identity, &self.identity))
            .ok_or(RouteFailure)?;
        viewer.ready = true;
        drop(state);
        self.request_keyframe();
        Ok(())
    }
}

impl Drop for PublisherEndpoint {
    fn drop(&mut self) {
        if let Ok(mut registration) = self.hub.publishers.lock()
            && registration
                .get(&self.publisher.publisher_id)
                .is_some_and(|publisher| Arc::ptr_eq(publisher, &self.publisher))
        {
            registration.remove(&self.publisher.publisher_id);
        }
        self.publisher.close();
    }
}

impl Drop for SubscriberEndpoint {
    fn drop(&mut self) {
        if let Ok(mut state) = self.publisher.state.lock()
            && state
                .viewers
                .get(&self.subscriber_id)
                .is_some_and(|viewer| Arc::ptr_eq(&viewer.identity, &self.identity))
        {
            state.viewers.remove(&self.subscriber_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet() -> ForwardPacket {
        ForwardPacket {
            codec: Codec::Opus,
            timestamp: 960,
            marker: false,
            payload: vec![0x78, 0].into(),
        }
    }

    #[test]
    fn arbitrary_publisher_viewer_mix_is_limited_by_total_admission_not_topology() {
        let hub = Arc::new(MediaHub::new(16));
        let mut publishers = Vec::new();
        let mut subscribers = Vec::new();
        // Publishers can have zero, one or many viewers, in different rooms.
        for (index, count) in [0, 1, 5, 3].into_iter().enumerate() {
            let room = format!("room_{index}");
            let source = format!("source_{index}");
            let publisher = hub.publish(&room, &source).unwrap();
            let viewers: Vec<_> = (0..count)
                .map(|viewer| {
                    let endpoint = hub
                        .subscribe(&room, &source, &format!("viewer_{viewer}"))
                        .unwrap();
                    endpoint.set_ready().unwrap();
                    endpoint
                })
                .collect();
            publishers.push(publisher);
            subscribers.push(viewers);
        }
        for (index, publisher) in publishers.iter().enumerate() {
            let mut input = packet();
            input.timestamp = index as u32;
            publisher.forward(input.clone()).unwrap();
            for viewer in &mut subscribers[index] {
                let output = viewer.try_packet().unwrap().unwrap();
                assert_eq!(output.timestamp, index as u32);
                assert!(Arc::ptr_eq(&input.payload, &output.payload));
                assert!(viewer.try_packet().unwrap().is_none());
            }
        }
        let extra: Vec<_> = (0..3)
            .map(|index| {
                hub.publish("another_room", &format!("extra_{index}"))
                    .unwrap()
            })
            .collect();
        assert!(hub.publish("another_room", "over_budget").is_err());
        assert!(hub.subscribe("room_1", "source_1", "over_budget").is_err());
        drop(extra);
        assert!(hub.subscribe("room_1", "source_1", "within_budget").is_ok());
    }

    #[test]
    fn fanout_shares_payloads_and_isolates_slow_unready_and_removed_viewers() {
        let hub = Arc::new(MediaHub::new(8));
        let publisher = hub.publish("room", "source").unwrap();
        let mut fast = hub.subscribe("room", "source", "fast").unwrap();
        let mut slow = hub.subscribe("room", "source", "slow").unwrap();
        let mut unready = hub.subscribe("room", "source", "unready").unwrap();
        fast.set_ready().unwrap();
        slow.set_ready().unwrap();
        for _ in 0..=PACKET_QUEUE_CAPACITY {
            let input = packet();
            publisher.forward(input.clone()).unwrap();
            assert!(Arc::ptr_eq(
                &input.payload,
                &fast.try_packet().unwrap().unwrap().payload
            ));
        }
        assert!(slow.try_packet().is_err());
        assert!(unready.try_packet().unwrap().is_none());
        unready.set_ready().unwrap();
        publisher.forward(packet()).unwrap();
        let output = fast.try_packet().unwrap().unwrap();
        let other = unready.try_packet().unwrap().unwrap();
        assert!(Arc::ptr_eq(&output.payload, &other.payload));

        // Removing one viewer invalidates its cached output, not its peers.
        publisher.forward(packet()).unwrap();
        hub.drop_viewer("source", "fast");
        assert!(fast.try_packet().is_err());
        assert!(unready.try_packet().unwrap().is_some());
        let mut replacement = hub.subscribe("room", "source", "fast").unwrap();
        replacement.set_ready().unwrap();
        drop(fast);
        publisher.forward(packet()).unwrap();
        assert!(replacement.try_packet().unwrap().is_some());
        assert!(unready.try_packet().unwrap().is_some());
        hub.close_publisher("source");
        assert!(replacement.try_packet().is_err());
        assert!(unready.try_packet().is_err());
    }

    #[test]
    fn packet_forwarding_does_not_acquire_the_registry_or_another_publishers_lock() {
        let hub = Arc::new(MediaHub::new(4));
        let first = hub.publish("room", "first").unwrap();
        let second = hub.publish("room", "second").unwrap();
        let mut viewer = hub.subscribe("room", "second", "viewer").unwrap();
        viewer.set_ready().unwrap();
        let registry = hub.publishers.lock().unwrap();
        let first_state = first.publisher.state.lock().unwrap();
        // Both unrelated locks stay held while the data path completes.
        second.forward(packet()).unwrap();
        assert!(viewer.try_packet().unwrap().is_some());
        drop(first_state);
        drop(registry);
    }

    #[test]
    fn two_publishers_forward_independently_and_teardown_is_stream_scoped() {
        let hub = Arc::new(MediaHub::default());
        let mut alice = hub.publish("call", "alice_stream").unwrap();
        let mut bob = hub.publish("call", "bob_stream").unwrap();
        let mut bob_watching = hub.subscribe("call", "alice_stream", "bob_viewer").unwrap();
        let mut alice_watching = hub.subscribe("call", "bob_stream", "alice_viewer").unwrap();
        assert!(hub.publish("other_call", "third_stream").is_err());
        bob_watching.set_ready().unwrap();
        alice_watching.set_ready().unwrap();
        assert!(alice.take_keyframe_request());
        assert!(bob.take_keyframe_request());

        alice.forward(packet()).unwrap();
        assert!(alice_watching.try_packet().unwrap().is_none());
        assert!(bob_watching.try_packet().unwrap().is_some());
        bob.forward(packet()).unwrap();
        assert!(alice_watching.try_packet().unwrap().is_some());
        assert!(bob_watching.try_packet().unwrap().is_none());

        // A full queue invalidates only its own viewer.
        for _ in 0..=PACKET_QUEUE_CAPACITY {
            alice.forward(packet()).unwrap();
        }
        assert!(bob_watching.try_packet().is_err());
        bob.forward(packet()).unwrap();
        assert!(alice_watching.try_packet().unwrap().is_some());
        hub.close_publisher("alice_stream");
        drop(alice);
        bob.forward(packet()).unwrap();
        assert!(alice_watching.try_packet().unwrap().is_some());
        assert!(hub.publish("other_call", "replacement").is_ok());
        drop(bob);
        assert!(alice_watching.try_packet().is_err());
    }

    #[test]
    fn routes_are_room_scoped_unique_bounded_and_drop_owned() {
        let hub = Arc::new(MediaHub::default());
        let mut publisher = hub.publish("room", "source").unwrap();
        assert!(hub.publish("other_room", "source").is_err());
        assert!(hub.subscribe("other_room", "source", "viewer").is_err());
        assert!(hub.subscribe("room", "wrong_source", "viewer").is_err());
        assert!(hub.subscribe("room", "source", "source").is_err());
        let mut viewer = hub.subscribe("room", "source", "viewer").unwrap();
        viewer.set_ready().unwrap();
        assert!(hub.subscribe("room", "source", "viewer").is_err());
        viewer.request_keyframe();
        viewer.request_keyframe();
        assert!(publisher.take_keyframe_request());
        assert!(!publisher.take_keyframe_request());
        publisher.forward(packet()).unwrap();
        assert_eq!(&*viewer.try_packet().unwrap().unwrap().payload, &[0x78, 0]);
        for _ in 0..PACKET_QUEUE_CAPACITY {
            publisher.forward(packet()).unwrap();
        }
        publisher.forward(packet()).unwrap();
        assert!(viewer.try_packet().is_err());
        drop(viewer);
        let mut replacement = hub.subscribe("room", "source", "replacement").unwrap();
        replacement.set_ready().unwrap();
        publisher.forward(packet()).unwrap();
        drop(publisher);
        assert!(replacement.try_packet().is_err());
        assert!(hub.publish("room", "new_source").is_ok());
    }

    #[test]
    fn stale_endpoints_cannot_mutate_replacement_routes_with_reused_ids() {
        let hub = Arc::new(MediaHub::default());
        let stale_publisher = hub.publish("room", "source").unwrap();
        let stale_viewer = hub.subscribe("room", "source", "viewer").unwrap();
        hub.close_publisher("source");

        let replacement_publisher = hub.publish("room", "source").unwrap();
        let mut replacement_viewer = hub.subscribe("room", "source", "viewer").unwrap();
        assert!(stale_publisher.forward(packet()).is_err());
        assert!(stale_viewer.set_ready().is_err());
        drop(stale_publisher);
        drop(stale_viewer);

        replacement_viewer.set_ready().unwrap();
        replacement_publisher.forward(packet()).unwrap();
        assert!(replacement_viewer.try_packet().unwrap().is_some());
    }

    #[test]
    fn stale_viewer_identity_cannot_read_or_mutate_same_publisher_replacement() {
        let hub = Arc::new(MediaHub::default());
        let mut publisher = hub.publish("room", "source").unwrap();
        let mut stale_viewer = hub.subscribe("room", "source", "viewer").unwrap();
        stale_viewer.set_ready().unwrap();
        assert!(publisher.take_keyframe_request());
        publisher.forward(packet()).unwrap();

        hub.drop_viewer("source", "viewer");
        let mut replacement_viewer = hub.subscribe("room", "source", "viewer").unwrap();
        assert!(stale_viewer.try_packet().is_err());
        assert!(stale_viewer.set_ready().is_err());
        stale_viewer.request_keyframe();
        assert!(!publisher.has_ready_viewer());
        assert!(!publisher.take_keyframe_request());
        drop(stale_viewer);

        replacement_viewer.set_ready().unwrap();
        assert!(publisher.has_ready_viewer());
        assert!(publisher.take_keyframe_request());
        publisher.forward(packet()).unwrap();
        assert!(replacement_viewer.try_packet().unwrap().is_some());
    }
}

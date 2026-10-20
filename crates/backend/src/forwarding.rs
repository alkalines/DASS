//! One publisher/one viewer feasibility routing; not a production SFU.
//! Media stays in bounded, in-process channels, never signaling JSON or IPC.

use std::sync::{Arc, Mutex};
use str0m::format::Codec;
use tokio::sync::mpsc;

pub const PACKET_QUEUE_CAPACITY: usize = 32;
const MAX_PAYLOAD_BYTES: usize = 2_048;

pub struct ForwardPacket {
    pub codec: Codec,
    pub timestamp: u32,
    pub marker: bool,
    pub payload: Arc<[u8]>,
}

#[derive(Default)]
pub struct MediaHub {
    publisher: Mutex<Option<PublisherRegistration>>,
}

struct PublisherRegistration {
    room_id: String,
    publisher_id: String,
    viewer: Option<(String, mpsc::Sender<ForwardPacket>, bool)>,
    keyframes: mpsc::Sender<()>,
}

pub struct PublisherEndpoint {
    hub: Arc<MediaHub>,
    publisher_id: String,
    keyframes: mpsc::Receiver<()>,
}

pub struct SubscriberEndpoint {
    hub: Arc<MediaHub>,
    publisher_id: String,
    subscriber_id: String,
    packets: mpsc::Receiver<ForwardPacket>,
    keyframes: mpsc::Sender<()>,
}

#[derive(Debug)]
pub struct RouteFailure;

impl MediaHub {
    pub fn publish(
        self: &Arc<Self>,
        room_id: &str,
        publisher_id: &str,
    ) -> Result<PublisherEndpoint, RouteFailure> {
        let mut registration = self.publisher.lock().map_err(|_| RouteFailure)?;
        if registration.is_some() {
            return Err(RouteFailure);
        }
        let (sender, receiver) = mpsc::channel(1);
        *registration = Some(PublisherRegistration {
            room_id: room_id.into(),
            publisher_id: publisher_id.into(),
            viewer: None,
            keyframes: sender,
        });
        Ok(PublisherEndpoint {
            hub: self.clone(),
            publisher_id: publisher_id.into(),
            keyframes: receiver,
        })
    }

    pub fn subscribe(
        self: &Arc<Self>,
        room_id: &str,
        publisher_id: &str,
        subscriber_id: &str,
    ) -> Result<SubscriberEndpoint, RouteFailure> {
        let mut registration = self.publisher.lock().map_err(|_| RouteFailure)?;
        let publisher = registration
            .as_mut()
            .filter(|publisher| {
                publisher.room_id == room_id
                    && publisher.publisher_id == publisher_id
                    && publisher_id != subscriber_id
                    && publisher.viewer.is_none()
            })
            .ok_or(RouteFailure)?;
        let (sender, receiver) = mpsc::channel(PACKET_QUEUE_CAPACITY);
        publisher.viewer = Some((subscriber_id.into(), sender, false));
        Ok(SubscriberEndpoint {
            hub: self.clone(),
            publisher_id: publisher_id.into(),
            subscriber_id: subscriber_id.into(),
            packets: receiver,
            keyframes: publisher.keyframes.clone(),
        })
    }

    /// Immediate route teardown: drop the registration and every queued media
    /// packet so publisher stop/withdrawal leaves nothing to forward.
    pub fn close_publisher(&self, publisher_id: &str) {
        if let Ok(mut registration) = self.publisher.lock()
            && registration
                .as_ref()
                .is_some_and(|publisher| publisher.publisher_id == publisher_id)
        {
            *registration = None;
        }
    }

    /// Drop one viewer's route and its queued packets without waiting for the
    /// viewer's connection loop. Used for publisher removal and blocking.
    pub fn drop_viewer(&self, publisher_id: &str, subscriber_id: &str) {
        if let Ok(mut registration) = self.publisher.lock()
            && let Some(publisher) = registration.as_mut()
            && publisher.publisher_id == publisher_id
            && publisher
                .viewer
                .as_ref()
                .is_some_and(|(id, _, _)| id == subscriber_id)
        {
            publisher.viewer = None;
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
        let mut registration = self.hub.publisher.lock().map_err(|_| RouteFailure)?;
        let publisher = registration
            .as_mut()
            .filter(|publisher| publisher.publisher_id == self.publisher_id)
            .ok_or(RouteFailure)?;
        if let Some((_, sender, true)) = &publisher.viewer {
            match sender.try_send(packet) {
                Ok(()) => {}
                // A slow viewer loses its route rather than growing a queue or
                // holding up the publisher. It will close on the next owner tick.
                Err(_) => publisher.viewer = None,
            }
        }
        Ok(())
    }

    pub fn take_keyframe_request(&mut self) -> bool {
        self.keyframes.try_recv().is_ok()
    }

    pub fn has_ready_viewer(&self) -> bool {
        self.hub.publisher.lock().ok().is_some_and(|registration| {
            registration.as_ref().is_some_and(|publisher| {
                publisher.publisher_id == self.publisher_id
                    && publisher
                        .viewer
                        .as_ref()
                        .is_some_and(|(_, _, ready)| *ready)
            })
        })
    }
}

impl SubscriberEndpoint {
    pub fn try_packet(&mut self) -> Result<Option<ForwardPacket>, RouteFailure> {
        // Check liveness before draining queued media: source teardown invalidates
        // cached packets instead of playing them after authorization has ended.
        let registration = self.hub.publisher.lock().map_err(|_| RouteFailure)?;
        if !registration.as_ref().is_some_and(|publisher| {
            publisher.publisher_id == self.publisher_id
                && publisher
                    .viewer
                    .as_ref()
                    .is_some_and(|(id, _, _)| id == &self.subscriber_id)
        }) {
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
        let _ = self.keyframes.try_send(());
    }

    pub fn set_ready(&self) -> Result<(), RouteFailure> {
        let mut registration = self.hub.publisher.lock().map_err(|_| RouteFailure)?;
        let publisher = registration
            .as_mut()
            .filter(|publisher| publisher.publisher_id == self.publisher_id)
            .ok_or(RouteFailure)?;
        let (_, _, ready) = publisher
            .viewer
            .as_mut()
            .filter(|(id, _, _)| id == &self.subscriber_id)
            .ok_or(RouteFailure)?;
        *ready = true;
        self.request_keyframe();
        Ok(())
    }
}

impl Drop for PublisherEndpoint {
    fn drop(&mut self) {
        if let Ok(mut registration) = self.hub.publisher.lock()
            && registration
                .as_ref()
                .is_some_and(|publisher| publisher.publisher_id == self.publisher_id)
        {
            *registration = None;
        }
    }
}

impl Drop for SubscriberEndpoint {
    fn drop(&mut self) {
        if let Ok(mut registration) = self.hub.publisher.lock()
            && let Some(publisher) = registration.as_mut()
            && publisher.publisher_id == self.publisher_id
            && publisher
                .viewer
                .as_ref()
                .is_some_and(|(id, _, _)| id == &self.subscriber_id)
        {
            publisher.viewer = None;
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
    fn routes_are_room_scoped_exclusive_bounded_and_drop_owned() {
        let hub = Arc::new(MediaHub::default());
        let mut publisher = hub.publish("room", "source").unwrap();
        assert!(hub.publish("other_room", "other_source").is_err());
        assert!(hub.subscribe("other_room", "source", "viewer").is_err());
        assert!(hub.subscribe("room", "wrong_source", "viewer").is_err());
        assert!(hub.subscribe("room", "source", "source").is_err());
        let mut viewer = hub.subscribe("room", "source", "viewer").unwrap();
        viewer.set_ready().unwrap();
        assert!(hub.subscribe("room", "source", "another_viewer").is_err());
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
}

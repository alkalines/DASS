//! Socket admission, timed TLS handshakes and lifetime bounds before HTTP routing.

use crate::config::TlsFiles;
use axum::serve::Listener;
use rustls_pki_types::{CertificateDer, PrivateKeyDer, pem::PemObject};
use std::{
    future::Future,
    io,
    io::Read,
    net::SocketAddr,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    net::{TcpListener, TcpStream},
    sync::{OwnedSemaphorePermit, Semaphore},
    task::JoinSet,
    time::{Instant, Sleep},
};
use tokio_rustls::{TlsAcceptor, server::TlsStream};

pub const MAX_TCP_CONNECTIONS: usize = 128;
const MAX_PENDING_HANDSHAKES: usize = 16;
const INITIAL_IO_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_CONNECTION_LIFETIME: Duration = Duration::from_secs(600);

fn bounded_file(path: &std::path::Path) -> Result<Vec<u8>, &'static str> {
    const MAX_PEM_BYTES: usize = 65_536;
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|_| "cannot open TLS material")?
        .take((MAX_PEM_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "cannot read TLS material")?;
    if bytes.len() > MAX_PEM_BYTES {
        return Err("TLS material too large");
    }
    Ok(bytes)
}

pub fn tls_acceptor(files: &TlsFiles) -> Result<TlsAcceptor, &'static str> {
    let certificates = CertificateDer::pem_slice_iter(&bounded_file(&files.certificate)?)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "invalid TLS certificate")?;
    let key = PrivateKeyDer::from_pem_slice(&bounded_file(&files.private_key)?)
        .map_err(|_| "invalid TLS private key")?;
    tls_acceptor_from_der(certificates, key)
}

pub(crate) fn tls_acceptor_from_der(
    certificates: Vec<CertificateDer<'static>>,
    key: PrivateKeyDer<'static>,
) -> Result<TlsAcceptor, &'static str> {
    let mut config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_protocol_versions(&[&rustls::version::TLS13])
    .map_err(|_| "TLS provider unavailable")?
    .with_no_client_auth()
    .with_single_cert(certificates, key)
    .map_err(|_| "invalid TLS material")?;
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    // Do not enable TLS early data: it is replayable.
    Ok(TlsAcceptor::from(Arc::new(config)))
}

pub struct BoundedListener {
    tcp: TcpListener,
    tls: Option<TlsAcceptor>,
    connections: Arc<Semaphore>,
    pending: JoinSet<Option<(ConnectionIo, SocketAddr)>>,
}

impl BoundedListener {
    pub fn new(tcp: TcpListener, tls: Option<TlsAcceptor>) -> Self {
        Self {
            tcp,
            tls,
            connections: Arc::new(Semaphore::new(MAX_TCP_CONNECTIONS)),
            pending: JoinSet::new(),
        }
    }
}

impl Listener for BoundedListener {
    type Io = ConnectionIo;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        loop {
            tokio::select! {
                biased;
                completed = self.pending.join_next(), if !self.pending.is_empty() => {
                    if let Some(Ok(Some(connection))) = completed { return connection; }
                }
                accepted = self.tcp.accept() => {
                    let Ok((stream, address)) = accepted else {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        continue;
                    };
                    let Ok(permit) = self.connections.clone().try_acquire_owned() else { continue; };
                    let _ = stream.set_nodelay(true);
                    if let Some(tls) = self.tls.clone() {
                        if self.pending.len() >= MAX_PENDING_HANDSHAKES { continue; }
                        self.pending.spawn(async move {
                            match tokio::time::timeout(INITIAL_IO_TIMEOUT, tls.accept(stream)).await {
                                Ok(Ok(stream)) => Some((ConnectionIo::new(Stream::Tls(Box::new(stream)), permit), address)),
                                _ => None,
                            }
                        });
                    } else {
                        return (ConnectionIo::new(Stream::Plain(stream), permit), address);
                    }
                }
            }
        }
    }

    fn local_addr(&self) -> io::Result<Self::Addr> {
        self.tcp.local_addr()
    }
}

enum Stream {
    Plain(TcpStream),
    Tls(Box<TlsStream<TcpStream>>),
}

pub struct ConnectionIo {
    stream: Stream,
    // Held through HTTP upgrade: slow sockets and WebSockets consume the same budget.
    _permit: OwnedSemaphorePermit,
    deadline: Pin<Box<Sleep>>,
    lifetime_deadline: Instant,
    response_started: bool,
}

impl ConnectionIo {
    fn new(stream: Stream, permit: OwnedSemaphorePermit) -> Self {
        Self {
            stream,
            _permit: permit,
            deadline: Box::pin(tokio::time::sleep(INITIAL_IO_TIMEOUT)),
            lifetime_deadline: Instant::now() + MAX_CONNECTION_LIFETIME,
            response_started: false,
        }
    }

    fn expired(&mut self, cx: &mut Context<'_>) -> bool {
        self.deadline.as_mut().poll(cx).is_ready()
    }
}

fn timeout_error() -> io::Error {
    io::Error::new(io::ErrorKind::TimedOut, "connection deadline")
}

impl AsyncRead for ConnectionIo {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        if this.expired(cx) {
            return Poll::Ready(Err(timeout_error()));
        }
        match &mut this.stream {
            Stream::Plain(stream) => Pin::new(stream).poll_read(cx, buffer),
            Stream::Tls(stream) => Pin::new(stream.as_mut()).poll_read(cx, buffer),
        }
    }
}

impl AsyncWrite for ConnectionIo {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = self.get_mut();
        if this.expired(cx) {
            return Poll::Ready(Err(timeout_error()));
        }
        if !this.response_started {
            this.response_started = true;
            this.deadline.as_mut().reset(this.lifetime_deadline);
        }
        match &mut this.stream {
            Stream::Plain(stream) => Pin::new(stream).poll_write(cx, bytes),
            Stream::Tls(stream) => Pin::new(stream.as_mut()).poll_write(cx, bytes),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        if this.expired(cx) {
            return Poll::Ready(Err(timeout_error()));
        }
        match &mut this.stream {
            Stream::Plain(stream) => Pin::new(stream).poll_flush(cx),
            Stream::Tls(stream) => Pin::new(stream.as_mut()).poll_flush(cx),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        if this.expired(cx) {
            return Poll::Ready(Err(timeout_error()));
        }
        match &mut this.stream {
            Stream::Plain(stream) => Pin::new(stream).poll_shutdown(cx),
            Stream::Tls(stream) => Pin::new(stream.as_mut()).poll_shutdown(cx),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncReadExt;

    #[tokio::test]
    async fn socket_permit_is_owned_until_io_drop_and_initial_read_times_out() {
        let tcp = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let _client = TcpStream::connect(tcp.local_addr().unwrap()).await.unwrap();
        let (stream, _) = tcp.accept().await.unwrap();
        let budget = Arc::new(Semaphore::new(1));
        let mut io = ConnectionIo::new(
            Stream::Plain(stream),
            budget.clone().try_acquire_owned().unwrap(),
        );
        assert!(budget.clone().try_acquire_owned().is_err());
        io.deadline.as_mut().reset(Instant::now());
        let mut byte = [0];
        assert_eq!(
            io.read(&mut byte).await.unwrap_err().kind(),
            io::ErrorKind::TimedOut
        );
        drop(io);
        assert!(budget.try_acquire_owned().is_ok());
    }
}

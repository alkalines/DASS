# All Rust compilation, formatting and tests run in this stage, never on the host.
FROM rust:1.90.0-bookworm AS tooling
RUN rustup component add rustfmt clippy
ENV CARGO_HOME=/opt/cargo
WORKDIR /workspace
RUN mkdir -p /opt/cargo /workspace/target && chmod 1777 /opt/cargo /workspace/target

FROM tooling AS builder
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --locked --release -p dass-backend

FROM debian:bookworm-slim AS runtime
RUN groupadd --gid 10001 dass && useradd --uid 10001 --gid dass --no-create-home dass
COPY --from=builder /workspace/target/release/dass-backend /usr/local/bin/dass-backend
USER 10001:10001
EXPOSE 8080/tcp
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/dass-backend"]

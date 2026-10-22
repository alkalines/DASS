# All Rust compilation, formatting and tests run in this stage, never on the host.
FROM rust:1.90.0-bookworm AS tooling
RUN rustup component add rustfmt clippy
RUN apt-get update && apt-get install -y --no-install-recommends cmake && apt-get clean
ENV CARGO_HOME=/opt/cargo
WORKDIR /workspace
RUN mkdir -p /opt/cargo /workspace/target && chmod 1777 /opt/cargo /workspace/target

FROM tooling AS builder
ARG DASS_RELEASE_VERSION=0.1.0-dev
ENV DASS_RELEASE_VERSION=${DASS_RELEASE_VERSION}
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY tests/plugin/fixtures/scaffold-capabilities.json ./tests/plugin/fixtures/scaffold-capabilities.json
RUN cargo fmt --all -- --check
RUN cargo clippy --workspace --all-targets --locked -- -D warnings
RUN cargo test --workspace --locked
RUN cargo build --locked --release -p dass-backend

# Optional Wings image. Keep runtime last so existing unqualified builds are unchanged.
FROM debian:bookworm-slim AS pterodactyl
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --home-dir /home/container --shell /bin/bash container
COPY --from=builder /workspace/target/release/dass-backend /usr/local/bin/dass-backend
COPY docker/pterodactyl/entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh
ENV USER=container HOME=/home/container TZ=UTC \
    DASS_DATABASE_FILE=/home/container/data/dass.sqlite3 \
    DASS_ADMIN_DATA_FILE=/home/container/data/policy.json \
    STARTUP=/usr/local/bin/dass-backend
USER container
WORKDIR /home/container
EXPOSE 8080/tcp 50000/udp 50001/udp
STOPSIGNAL SIGINT
ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]

FROM debian:bookworm-slim AS runtime
RUN groupadd --gid 10001 dass && useradd --uid 10001 --gid dass --no-create-home dass
RUN mkdir -p /var/lib/dass && chown 10001:10001 /var/lib/dass && chmod 700 /var/lib/dass
COPY --from=builder /workspace/target/release/dass-backend /usr/local/bin/dass-backend
USER 10001:10001
EXPOSE 8080/tcp 50000/udp 50001/udp
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/dass-backend"]

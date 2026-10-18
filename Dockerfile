ARG ZIG_VERSION=0.16.0
ARG DEBIAN_IMAGE=debian:stable-slim
ARG BUN_IMAGE=oven/bun:1
ARG MODEL_FILE=LFM2.5-2.6B-Q5_K_M.gguf
ARG MODEL_FAMILY=lfm2.5

FROM --platform=$BUILDPLATFORM ${DEBIAN_IMAGE} AS engine
ARG TARGETARCH
ARG BUILDARCH
ARG ZIG_VERSION
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
 && rm -rf /var/lib/apt/lists/*
RUN case "${BUILDARCH}" in \
      amd64) zig_arch=x86_64 ;; \
      arm64) zig_arch=aarch64 ;; \
      *) echo "unsupported BUILDARCH=${BUILDARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL "https://ziglang.org/download/${ZIG_VERSION}/zig-${zig_arch}-linux-${ZIG_VERSION}.tar.xz" -o /tmp/zig.tar.xz \
 && mkdir -p /opt/zig \
 && tar -xJf /tmp/zig.tar.xz -C /opt/zig --strip-components=1 \
 && rm -f /tmp/zig.tar.xz
COPY elthur /src/elthur
RUN case "${TARGETARCH}" in \
      amd64) zig_target=x86_64-linux-gnu ;; \
      arm64) zig_target=aarch64-linux-gnu ;; \
      *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && cd /src/elthur \
 && /opt/zig/zig build dylib -Doptimize=ReleaseFast -Dtarget="${zig_target}" \
 && mkdir -p /out \
 && cp outputs/lib/libelthur.so "/out/${TARGETARCH}.dylib"

FROM --platform=$BUILDPLATFORM ${BUN_IMAGE} AS builder
ARG TARGETARCH
ARG MODEL_FAMILY
ARG QUEEN_BEE_SHA=docker
ARG QUEEN_ELTHUR_SHA=docker
WORKDIR /src
COPY bee-cli /src/bee-cli
COPY tui /src/tui
COPY --from=engine /out/${TARGETARCH}.dylib /src/tui/libelthur.dylib
RUN cd /src/tui && bun install --os="*" --cpu="*" \
 && cd /src/bee-cli && bun install --os="*" --cpu="*"
RUN case "${TARGETARCH}" in \
      amd64) bun_target=bun-linux-x64 ;; \
      arm64) bun_target=bun-linux-arm64 ;; \
      *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && cd /src/tui \
 && bun build --compile index.tsx \
      --target "${bun_target}" \
      --outfile /out/queen \
      --define "process.env.QUEEN_BEE_SHA=\"${QUEEN_BEE_SHA}\"" \
      --define "process.env.QUEEN_ELTHUR_SHA=\"${QUEEN_ELTHUR_SHA}\"" \
      --define "process.env.QUEEN_MODEL_FAMILY=\"${MODEL_FAMILY}\""

FROM ${DEBIAN_IMAGE} AS runtime
ARG MODEL_FILE
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data
COPY --from=builder /out/queen /usr/local/bin/queen
COPY models/${MODEL_FILE} /opt/model.gguf
ENV ELTHUR_MODEL=/opt/model.gguf
WORKDIR /data
ENTRYPOINT ["/usr/local/bin/queen"]

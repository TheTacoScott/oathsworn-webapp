# Pull Java from the official Eclipse Temurin image (avoids apt package availability issues)
FROM eclipse-temurin:17-jre AS java

FROM python:3.12-slim

# Copy the JRE into the Python image
COPY --from=java /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"

# Install utilities needed to download and extract jadx
RUN apt-get update && apt-get install -y --no-install-recommends \
        wget \
        unzip \
    && rm -rf /var/lib/apt/lists/*

# Download jadx, verify SHA256, and install
ARG JADX_VERSION=1.5.5
ARG JADX_SHA256=38a5766d3c8170c41566b4b13ea0ede2430e3008421af4927235c2880234d51a

RUN wget -q "https://github.com/skylot/jadx/releases/download/v${JADX_VERSION}/jadx-${JADX_VERSION}.zip" \
    && echo "${JADX_SHA256}  jadx-${JADX_VERSION}.zip" | sha256sum -c - \
    && unzip "jadx-${JADX_VERSION}.zip" -d /opt/jadx \
    && rm "jadx-${JADX_VERSION}.zip" \
    && chmod +x /opt/jadx/bin/jadx

ENV PATH="/opt/jadx/bin:${PATH}"

# Cache directory for the downloaded APK - bind-mount a host path here
# to persist the APK across runs and skip re-downloading.
ENV PYTHONUNBUFFERED=1
ENV APK_CACHE_DIR=/cache
RUN mkdir -p /cache

WORKDIR /repo

RUN pip install --no-cache-dir gdown

COPY scripts/ scripts/

CMD ["python3", "scripts/setup.py"]

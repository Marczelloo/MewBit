# Environment of the analysis pipeline, the Ubuntu setup of HANDOFF.md as an image: run_pipeline.py cannot run natively on
# Windows (fcntl), and a named volume is much faster than a checkout under /mnt/c.
#
#   docker build -t mewbeat-ma -f mapping-analysis/pipeline/Dockerfile mapping-analysis
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-21-jdk-headless ffmpeg python3-venv git ca-certificates curl xz-utils libsndfile1 \
 && rm -rf /var/lib/apt/lists/*

# Ubuntu's own Node is 18; the generator needs 20 or newer.
RUN curl -fsSL https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.xz | tar -xJ --strip-components=1 -C /usr/local

COPY requirements.txt /opt/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r /opt/requirements.txt

ENV PATH=/opt/venv/bin:$PATH
WORKDIR /work/MewBit

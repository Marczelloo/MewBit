# The melody decoder service (service.py): Basic Pitch on onnxruntime, answering over HTTP on port 8090.
#
#   docker build -t mewbeat-decoder-svc scripts/mewbeat-melody/decoder                       (this machine's architecture)
#   docker buildx build --platform linux/arm64 -t mewbeat-decoder-svc scripts/mewbeat-melody/decoder   (Raspberry Pi 5)
#
# The packages are not installed by running pip in the target image: the build stage always runs on the build machine's own
# architecture and downloads the wheels of the TARGET architecture (manylinux, Python 3.12), so an arm64 image builds on an amd64
# machine without emulation. Only wheels are accepted (no compiling), and the model file is checked against the sha256 of the
# one the first image used, so a decode gives the same numbers on both.

FROM --platform=$BUILDPLATFORM python:3.12-slim-bookworm AS build
ARG TARGETARCH
ARG BASIC_PITCH=0.4.0
ARG MODEL_SHA256=2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec
WORKDIR /build
COPY requirements.txt .
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) tags="--platform manylinux_2_28_x86_64 --platform manylinux_2_17_x86_64 --platform manylinux2014_x86_64" ;; \
      arm64) tags="--platform manylinux_2_28_aarch64 --platform manylinux_2_17_aarch64 --platform manylinux2014_aarch64" ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    pip install --no-cache-dir --no-deps --only-binary=:all: $tags --python-version 3.12 --implementation cp --abi cp312 \
        --target /site -r requirements.txt; \
    pip download --no-cache-dir --no-deps --only-binary=:all: --dest /bp "basic-pitch==$BASIC_PITCH"; \
    python -c "import glob, zipfile; z = zipfile.ZipFile(glob.glob('/bp/*.whl')[0]); open('/nmp.onnx', 'wb').write(z.read('basic_pitch/saved_models/icassp_2022/nmp.onnx'))"; \
    echo "$MODEL_SHA256  /nmp.onnx" | sha256sum -c -; \
    find /site -name '__pycache__' -type d -prune -exec rm -rf {} +; \
    rm -rf /site/bin /site/numpy/tests /site/numpy/*/tests /site/onnxruntime/tools /site/onnxruntime/transformers /site/onnxruntime/quantization

FROM python:3.12-slim-bookworm
# `python -I` (as the old image ran decode.py) ignores PYTHONPATH, so the packages go where the interpreter looks anyway.
COPY --from=build /site /usr/local/lib/python3.12/site-packages
COPY --from=build /nmp.onnx /opt/mewbeat/nmp.onnx
COPY bp.py decode.py notes.py offset.py service.py /opt/mewbeat/
ENV MEWBEAT_BP_MODEL=/opt/mewbeat/nmp.onnx \
    OMP_NUM_THREADS=1 \
    PYTHONUNBUFFERED=1 \
    MEWBEAT_DECODER_PORT=8090
USER 65534:65534
EXPOSE 8090
CMD ["python", "-I", "/opt/mewbeat/service.py"]

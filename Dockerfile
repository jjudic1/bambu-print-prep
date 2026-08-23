# The API, for Cloud Run.
#
# There is no slicer in here and that is the point: MakerWorld accepts the
# container prep/write3mf.py builds directly (transport-findings §A2b), so the
# Bambu Studio dependency that would have forced a desktop-class VM is gone and
# this is an ordinary Python service.
#
# Image size is the thing to watch. scipy alone is ~115 MB and Cloud Run scales
# to zero, so every megabyte is paid again on each cold start. Hence: slim base,
# no build toolchain in the final layer, no test dependencies, and --no-compile
# to skip .pyc that would be written on first import anyway.

FROM python:3.12-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-api.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements-api.txt


FROM python:3.12-slim

# libGL and friends: trimesh pulls them in transitively even though nothing here
# renders with OpenGL. prep/render.py rasterises in numpy on purpose.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /install /usr/local

WORKDIR /app
COPY prep/ ./prep/
COPY api/ ./api/

# Jobs are ephemeral here, and the sweep in api/limits.py keeps them that way.
# Cloud Run gives each instance a writable tmpfs; anything that must outlive an
# instance needs a bucket, which is the next thing to build if it matters.
ENV JOBS_ROOT=/tmp/jobs \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Cloud Run injects PORT and it is not always 8080. Honour it.
ENV PORT=8080
EXPOSE 8080
CMD exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT} --workers 1

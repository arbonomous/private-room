#!/bin/sh
# Fetches the face-tracking files into public/mp (they are big, so they are not committed). Pinned and checked.
set -e
mkdir -p public/mp/wasm /tmp/mp && cd /tmp/mp
npm pack @mediapipe/tasks-vision@1.1.0 >/dev/null && tar xzf mediapipe-tasks-vision-1.1.0.tgz
curl -sfo face_landmarker.task https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
cd - >/dev/null
cp /tmp/mp/package/vision_bundle.mjs public/mp/
cp /tmp/mp/package/wasm/vision_wasm_internal.* /tmp/mp/package/wasm/vision_wasm_nosimd_internal.* public/mp/wasm/
cp /tmp/mp/face_landmarker.task public/mp/
cd public/mp && sha256sum -c ../../mp.sha256

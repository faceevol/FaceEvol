import { put } from "@vercel/blob";

/*
 * FaceEvol chunk upload route
 * Save as: /api/video-upload-chunk.js
 *
 * Browser sends ~3 MB binary pieces here.
 * This intentionally avoids Vercel Blob client-token uploads.
 */

export const config = {
  api: {
    bodyParser: false
  }
};

const MAX_CHUNK_BYTES =
  3.25 * 1024 * 1024;

const MAX_CHUNK_INDEX = 109;

function validUploadId(value) {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9_-]{8,64}$/.test(value)
  );
}

function chunkPath(uploadId, index) {
  return `faceevol-chunks/${uploadId}/part-${String(index).padStart(4, "0")}.bin`;
}

async function readBinaryBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer =
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk);

    total += buffer.length;

    if (total > MAX_CHUNK_BYTES) {
      const error =
        new Error(
          "Chunk exceeds FaceEvol upload limit."
        );

      error.code =
        "CHUNK_TOO_LARGE";

      throw error;
    }

    chunks.push(buffer);
  }

  if (!total) {
    throw new Error(
      "Empty video chunk."
    );
  }

  return Buffer.concat(
    chunks,
    total
  );
}

export default async function handler(
  req,
  res
) {
  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  if (req.method !== "POST") {
    res.setHeader(
      "Allow",
      "POST"
    );

    return res
      .status(405)
      .json({
        error:
          "Method not allowed"
      });
  }

  const uploadId =
    typeof req.query?.uploadId ===
      "string"
      ? req.query.uploadId
      : "";

  const index =
    Number(
      req.query?.index
    );

  if (
    !validUploadId(
      uploadId
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          "Invalid upload session."
      });
  }

  if (
    !Number.isInteger(
      index
    ) ||
    index < 0 ||
    index >
      MAX_CHUNK_INDEX
  ) {
    return res
      .status(400)
      .json({
        error:
          "Invalid upload chunk index."
      });
  }

  try {
    const body =
      await readBinaryBody(
        req
      );

    const arrayBuffer =
      body.buffer.slice(
        body.byteOffset,
        body.byteOffset +
          body.byteLength
      );

    const pathname =
      chunkPath(
        uploadId,
        index
      );

    const blob =
      await put(
        pathname,
        arrayBuffer,
        {
          access:
            "private",

          contentType:
            "application/octet-stream",

          addRandomSuffix:
            false,

          allowOverwrite:
            true,

          cacheControlMaxAge:
            60
        }
      );

    return res
      .status(200)
      .json({
        success:
          true,

        index,

        size:
          body.length,

        pathname:
          blob.pathname
      });

  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(
            error
          );

    console.error(
      "FaceEvol chunk upload failed:",
      uploadId,
      index,
      message
    );

    const status =
      error?.code ===
      "CHUNK_TOO_LARGE"
        ? 413
        : 500;

    return res
      .status(status)
      .json({
        error:
          status === 413
            ? "Video chunk was too large."
            : "Could not upload video chunk.",

        details:
          message.slice(
            0,
            1200
          )
      });
  }
}

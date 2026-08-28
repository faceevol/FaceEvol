import { put } from "@vercel/blob";

/*
 * FaceEvol private server upload route
 * File location in the repo: /api/private-upload.js
 *
 * Why this route exists:
 * - The browser first trims/compresses the selected clip below ~3.2 MB.
 * - The browser POSTs the raw file body to this same-origin API route.
 * - This route writes it server-to-server into your PRIVATE Vercel Blob store.
 *
 * Vercel Functions have a 4.5 MB request-body ceiling, so we reject anything
 * above 4 MiB here. The browser intentionally targets a smaller size.
 */

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

function cleanFilename(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-160);
}

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return sendJson(res, 405, {
      error: "Method not allowed",
    });
  }

  try {
    const rawFilename = Array.isArray(req.query.filename)
      ? req.query.filename[0]
      : req.query.filename;

    const filename = cleanFilename(rawFilename);

    if (!filename) {
      return sendJson(res, 400, {
        error: "Missing upload filename.",
      });
    }

    const isVideo = filename.startsWith(
      "faceevol-video-"
    );

    const isFace = filename.startsWith(
      "faceevol-face-"
    );

    if (!isVideo && !isFace) {
      return sendJson(res, 400, {
        error:
          "Invalid FaceEvol upload pathname.",
      });
    }

    const contentLength = Number(
      req.headers["content-length"] || 0
    );

    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_REQUEST_BYTES
    ) {
      return sendJson(res, 413, {
        error:
          "Private upload is too large. Please use the browser-prepared clip below 4 MB.",
      });
    }

    const contentType = String(
      req.headers["content-type"] || ""
    ).split(";")[0];

    if (
      isVideo &&
      contentType !== "video/mp4"
    ) {
      return sendJson(res, 415, {
        error:
          "Video uploads must be MP4.",
      });
    }

    if (
      isFace &&
      contentType !== "image/jpeg"
    ) {
      return sendJson(res, 415, {
        error:
          "Face uploads must be JPEG.",
      });
    }

    const blob = await put(
      filename,
      req,
      {
        access: "private",
        contentType,
        addRandomSuffix: true,
        multipart: false,
      }
    );

    return sendJson(res, 200, {
      url: blob.url,
      pathname: blob.pathname,
      contentType:
        blob.contentType || contentType,
      size:
        blob.size ||
        contentLength ||
        null,
    });
  } catch (error) {
    console.error(
      "FaceEvol private upload error:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Private upload failed.";

    return sendJson(res, 500, {
      error:
        "FaceEvol could not save the upload to private storage.",
      details: message,
    });
  }
}

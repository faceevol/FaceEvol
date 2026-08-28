import { put, get, del } from "@vercel/blob";

/*
 * FaceEvol private upload route
 * Save as: /api/private-upload.js
 *
 * Why it is chunked:
 * Vercel Functions have a request-body ceiling. The browser therefore sends
 * large trimmed videos as small raw parts. Every part is written to the PRIVATE
 * Blob store. The "complete" action then reads those private parts as streams
 * and streams them into one final private MP4.
 *
 * No browser-side video compression is required.
 */

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_RAW_REQUEST_BYTES = Math.floor(3.9 * 1024 * 1024);
const MAX_JSON_BYTES = 512 * 1024;
const MAX_CHUNKS = 120;

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(payload));
}

function cleanFilename(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-180);
}

function cleanUploadId(value) {
  const id = String(value || "")
    .replace(/[^a-zA-Z0-9_-]+/g, "")
    .slice(0, 80);

  return id;
}

function isAllowedFinalFilename(filename) {
  return (
    filename.startsWith("faceevol-video-") ||
    filename.startsWith("faceevol-face-")
  );
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer =
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk);

    total += buffer.length;

    if (total > MAX_JSON_BYTES) {
      throw new Error(
        "Completion request is too large."
      );
    }

    chunks.push(buffer);
  }

  const text =
    Buffer.concat(chunks)
      .toString("utf8");

  if (!text) return {};

  return JSON.parse(text);
}

function validateRawSize(req) {
  const contentLength =
    Number(
      req.headers["content-length"] || 0
    );

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_RAW_REQUEST_BYTES
  ) {
    const error =
      new Error(
        "Private upload request is too large."
      );

    error.statusCode = 413;

    throw error;
  }
}

async function createCombinedPrivateStream(
  pathnames
) {
  let index = 0;
  let reader = null;

  return new ReadableStream({
    async pull(controller) {
      try {
        while (true) {
          if (!reader) {
            if (index >= pathnames.length) {
              controller.close();
              return;
            }

            const result =
              await get(
                pathnames[index],
                {
                  access: "private",
                }
              );

            if (
              !result ||
              result.statusCode !== 200 ||
              !result.stream
            ) {
              throw new Error(
                `Could not read private upload part ${
                  index + 1
                }.`
              );
            }

            reader =
              result.stream.getReader();
          }

          const {
            done,
            value
          } =
            await reader.read();

          if (done) {
            try {
              reader.releaseLock();
            } catch {}

            reader = null;
            index += 1;
            continue;
          }

          controller.enqueue(value);
          return;
        }
      } catch (error) {
        controller.error(error);
      }
    },

    async cancel() {
      if (reader) {
        try {
          await reader.cancel();
        } catch {}

        try {
          reader.releaseLock();
        } catch {}

        reader = null;
      }
    },
  });
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    res.setHeader(
      "Allow",
      "POST"
    );

    return sendJson(
      res,
      405,
      {
        error: "Method not allowed",
      }
    );
  }

  const action =
    String(
      req.query.action || "single"
    ).toLowerCase();

  try {

    /*
     * Small face photo or
     * already-small MP4.
     */
    if (action === "single") {
      validateRawSize(req);

      const rawFilename =
        Array.isArray(
          req.query.filename
        )
          ? req.query.filename[0]
          : req.query.filename;

      const filename =
        cleanFilename(
          rawFilename
        );

      if (
        !filename ||
        !isAllowedFinalFilename(
          filename
        )
      ) {
        return sendJson(
          res,
          400,
          {
            error:
              "Invalid FaceEvol upload filename.",
          }
        );
      }

      const isVideo =
        filename.startsWith(
          "faceevol-video-"
        );

      const isFace =
        filename.startsWith(
          "faceevol-face-"
        );

      const incomingContentType =
        String(
          req.headers[
            "content-type"
          ] || ""
        ).split(";")[0];

      /*
       * Some browsers report MP4
       * screen recordings as
       * video/quicktime,
       * application/octet-stream,
       * or even an empty MIME type.
       *
       * The filename is already
       * restricted by FaceEvol,
       * so normalize
       * faceevol-video-*.mp4
       * uploads to video/mp4.
       */
      if (
        isVideo &&
        !filename
          .toLowerCase()
          .endsWith(".mp4")
      ) {
        return sendJson(
          res,
          415,
          {
            error:
              "Video uploads must be MP4.",
          }
        );
      }

      if (
        isFace &&
        incomingContentType !==
          "image/jpeg"
      ) {
        return sendJson(
          res,
          415,
          {
            error:
              "Face uploads must be JPEG.",
          }
        );
      }

      const contentType =
        isVideo
          ? "video/mp4"
          : incomingContentType;

      const blob =
        await put(
          filename,
          req,
          {
            access: "private",
            contentType,
            addRandomSuffix: true,
            multipart: false,
          }
        );

      return sendJson(
        res,
        200,
        {
          url: blob.url,

          pathname:
            blob.pathname,

          contentType:
            blob.contentType ||
            contentType,
        }
      );
    }


    /*
     * One raw video part,
     * always comfortably below
     * the Function body limit.
     */
    if (action === "chunk") {
      validateRawSize(req);

      const uploadId =
        cleanUploadId(
          Array.isArray(
            req.query.uploadId
          )
            ? req.query.uploadId[0]
            : req.query.uploadId
        );

      const part =
        Number(
          Array.isArray(
            req.query.part
          )
            ? req.query.part[0]
            : req.query.part
        );

      const total =
        Number(
          Array.isArray(
            req.query.total
          )
            ? req.query.total[0]
            : req.query.total
        );

      if (!uploadId) {
        return sendJson(
          res,
          400,
          {
            error:
              "Missing private upload id.",
          }
        );
      }

      if (
        !Number.isInteger(part) ||
        part < 1 ||
        part > MAX_CHUNKS
      ) {
        return sendJson(
          res,
          400,
          {
            error:
              "Invalid private upload part number.",
          }
        );
      }

      if (
        !Number.isInteger(total) ||
        total < 1 ||
        total > MAX_CHUNKS ||
        part > total
      ) {
        return sendJson(
          res,
          400,
          {
            error:
              "Invalid private upload part count.",
          }
        );
      }

      const pathname =
        `faceevol-temp/${uploadId}/part-${
          String(part)
            .padStart(4, "0")
        }.bin`;

      const blob =
        await put(
          pathname,
          req,
          {
            access: "private",

            contentType:
              "application/octet-stream",

            addRandomSuffix:
              false,

            allowOverwrite:
              true,

            multipart:
              false,
          }
        );

      return sendJson(
        res,
        200,
        {
          pathname:
            blob.pathname,

          part,
        }
      );
    }


    /*
     * Join the private temporary
     * parts into one private MP4.
     */
    if (action === "complete") {
      const body =
        await readJsonBody(req);

      const uploadId =
        cleanUploadId(
          body.uploadId
        );

      const filename =
        cleanFilename(
          body.filename
        );

      const chunks =
        Array.isArray(
          body.chunks
        )
          ? body.chunks.map(
              String
            )
          : [];

      if (!uploadId) {
        return sendJson(
          res,
          400,
          {
            error:
              "Missing private upload id.",
          }
        );
      }

      if (
        !filename ||
        !filename.startsWith(
          "faceevol-video-"
        ) ||
        !filename.endsWith(
          ".mp4"
        )
      ) {
        return sendJson(
          res,
          400,
          {
            error:
              "Invalid final video filename.",
          }
        );
      }

      if (
        !chunks.length ||
        chunks.length >
          MAX_CHUNKS
      ) {
        return sendJson(
          res,
          400,
          {
            error:
              "Invalid private upload part list.",
          }
        );
      }

      const expectedPrefix =
        `faceevol-temp/${uploadId}/`;

      if (
        chunks.some(
          (pathname) =>
            !pathname.startsWith(
              expectedPrefix
            )
        )
      ) {
        return sendJson(
          res,
          400,
          {
            error:
              "Private upload part path mismatch.",
          }
        );
      }

      const stream =
        await createCombinedPrivateStream(
          chunks
        );

      const blob =
        await put(
          filename,
          stream,
          {
            access: "private",

            contentType:
              "video/mp4",

            addRandomSuffix:
              true,

            multipart:
              true,
          }
        );

      /*
       * The final private video
       * now exists, so temporary
       * private parts can go.
       */
      try {
        await del(
          chunks
        );
      } catch (
        cleanupError
      ) {
        console.warn(
          "FaceEvol temporary Blob cleanup warning:",
          cleanupError
        );
      }

      return sendJson(
        res,
        200,
        {
          url:
            blob.url,

          pathname:
            blob.pathname,

          contentType:
            blob.contentType ||
            "video/mp4",
        }
      );
    }


    /*
     * Best-effort cleanup when
     * a browser upload fails
     * halfway through.
     */
    if (action === "abort")

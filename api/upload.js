import { handleUpload } from "@vercel/blob/client";
import { del, get, put } from "@vercel/blob";

/*
 * FaceEvol unified upload route
 * Save as: /api/upload.js
 *
 * ONE Serverless Function handles:
 *
 * 1. Existing FaceEvol Vercel Blob uploads
 * 2. Video Enhancement chunk uploads
 * 3. Joining chunks into one private MP4
 */

const MAX_CHUNK_BYTES =
  Math.floor(
    3.25 * 1024 * 1024
  );

const MAX_CHUNKS =
  110;


/*
 * Query parameters can occasionally
 * arrive as arrays.
 */
function firstQueryValue(value) {
  return Array.isArray(value)
    ? value[0]
    : value;
}


/*
 * Validate temporary upload session ID.
 */
function validUploadId(value) {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9_-]{8,64}$/.test(
      value
    )
  );
}


/*
 * Keep generated filenames safe.
 */
function safeFileName(value) {
  const cleaned =
    String(
      value ||
      "enhance.mp4"
    )
      .replace(
        /[^a-zA-Z0-9._-]+/g,
        "-"
      )
      .replace(
        /^-+|-+$/g,
        ""
      )
      .slice(-120) ||
    "enhance.mp4";


  return cleaned
    .toLowerCase()
    .endsWith(".mp4")
      ? cleaned
      : `${cleaned}.mp4`;
}


/*
 * Temporary private Blob pathname
 * for each uploaded piece.
 */
function chunkPath(
  uploadId,
  index
) {

  return (
    `faceevol-chunks/${uploadId}/` +
    `part-${String(index).padStart(
      4,
      "0"
    )}.bin`
  );
}


function buildChunkPaths(
  uploadId,
  chunkCount
) {

  return Array.from(
    {
      length:
        chunkCount
    },

    (
      _,
      index
    ) =>
      chunkPath(
        uploadId,
        index
      )
  );
}


/*
 * Vercel normally parses application/json
 * automatically.
 *
 * This helper also safely handles a Buffer
 * or string if one is received.
 */
function normalizeJsonBody(body) {

  if (!body) {
    return {};
  }


  if (
    typeof body === "object" &&
    !Buffer.isBuffer(body)
  ) {
    return body;
  }


  try {

    return JSON.parse(
      Buffer.isBuffer(body)
        ? body.toString(
            "utf8"
          )
        : String(
            body
          )
    );

  } catch {

    return {};
  }
}


/*
 * Delete temporary upload pieces.
 *
 * Cleanup failure must not hide
 * a successful upload.
 */
async function cleanupChunks(
  paths
) {

  if (
    !Array.isArray(paths) ||
    !paths.length
  ) {
    return;
  }


  try {

    await del(
      paths
    );


  } catch (error) {

    console.warn(
      "FaceEvol temporary chunk cleanup failed:",

      error instanceof Error
        ? error.message
        : String(
            error
          )
    );
  }
}


/*
 * Join private chunk Blobs together
 * as one continuous stream.
 *
 * We deliberately do NOT load the
 * entire video into Function memory.
 */
function createJoinedPrivateBlobStream(
  paths
) {

  let pathIndex =
    0;

  let reader =
    null;


  return new ReadableStream({

    async pull(
      controller
    ) {

      try {

        while (true) {

          /*
           * Open the next temporary
           * private chunk.
           */
          if (!reader) {

            if (
              pathIndex >=
              paths.length
            ) {

              controller.close();

              return;
            }


            const pathname =
              paths[
                pathIndex++
              ];


            const result =
              await get(
                pathname,
                {
                  access:
                    "private"
                }
              );


            if (
              !result ||
              result.statusCode !==
                200 ||
              !result.stream
            ) {

              throw new Error(
                `Missing temporary upload chunk: ${pathname}`
              );
            }


            reader =
              result.stream
                .getReader();
          }


          /*
           * Read from the currently
           * opened Blob stream.
           */
          const next =
            await reader.read();


          if (
            next.done
          ) {

            try {

              reader.releaseLock();

            } catch {}


            reader =
              null;

            continue;
          }


          controller.enqueue(
            next.value
          );

          return;
        }


      } catch (error) {

        controller.error(
          error
        );
      }
    },


    async cancel(
      reason
    ) {

      if (!reader) {
        return;
      }


      try {

        await reader.cancel(
          reason
        );

      } catch {}
    }

  });
}


/*
 * =========================================================
 * VIDEO ENHANCEMENT CHUNK UPLOAD
 * =========================================================
 *
 * POST:
 *
 * /api/upload?action=chunk
 *   &uploadId=...
 *   &index=...
 *
 * Content-Type:
 * application/octet-stream
 */
async function handleVideoChunk(
  req,
  res
) {

  const uploadId =
    String(
      firstQueryValue(
        req.query?.uploadId
      ) ||
      ""
    );


  const index =
    Number(
      firstQueryValue(
        req.query?.index
      )
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
    index >=
      MAX_CHUNKS
  ) {

    return res
      .status(400)
      .json({
        error:
          "Invalid upload chunk index."
      });
  }


  let body;


  try {

    body =
      req.body;


  } catch (error) {

    return res
      .status(400)
      .json({
        error:
          "Could not read video chunk.",

        details:
          error instanceof Error
            ? error.message
            : String(
                error
              )
      });
  }


  /*
   * Vercel parses
   * application/octet-stream
   * request bodies as Buffer.
   */
  if (
    !Buffer.isBuffer(
      body
    )
  ) {

    return res
      .status(400)
      .json({
        error:
          "Video chunks must use application/octet-stream."
      });
  }


  if (
    !body.length
  ) {

    return res
      .status(400)
      .json({
        error:
          "Empty video chunk."
      });
  }


  /*
   * Keep every request comfortably
   * below the Function payload ceiling.
   */
  if (
    body.length >
      MAX_CHUNK_BYTES
  ) {

    return res
      .status(413)
      .json({
        error:
          "Video chunk was too large."
      });
  }


  try {

    const pathname =
      chunkPath(
        uploadId,
        index
      );


    const blob =
      await put(
        pathname,
        body,
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


    return res
      .status(500)
      .json({
        error:
          "Could not upload video chunk.",

        details:
          message.slice(
            0,
            1200
          )
      });
  }
}


/*
 * =========================================================
 * VIDEO ENHANCEMENT UPLOAD FINALIZER
 * =========================================================
 *
 * POST:
 *
 * /api/upload?action=complete
 *
 * JSON:
 *
 * {
 *   uploadId,
 *   chunkCount,
 *   fileName
 * }
 */
async function handleVideoComplete(
  req,
  res
) {

  let rawBody;


  try {

    rawBody =
      req.body;


  } catch (error) {

    return res
      .status(400)
      .json({
        error:
          "Could not read upload completion request.",

        details:
          error instanceof Error
            ? error.message
            : String(
                error
              )
      });
  }


  const body =
    normalizeJsonBody(
      rawBody
    );


  const uploadId =
    body.uploadId;


  const chunkCount =
    Number(
      body.chunkCount
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
      chunkCount
    ) ||
    chunkCount < 1 ||
    chunkCount >
      MAX_CHUNKS
  ) {

    return res
      .status(400)
      .json({
        error:
          "Invalid chunk count."
      });
  }


  const chunkPaths =
    buildChunkPaths(
      uploadId,
      chunkCount
    );


  /*
   * Browser can request cleanup
   * after a failed upload.
   */
  if (
    body.abort ===
    true
  ) {

    await cleanupChunks(
      chunkPaths
    );


    return res
      .status(200)
      .json({
        success:
          true,

        aborted:
          true
      });
  }


  const fileName =
    safeFileName(
      body.fileName
    );


  /*
   * Keep FaceEvol's existing
   * faceevol-video-* prefix.
   *
   * /api/video.mp4 and
   * /api/video-enhance.js
   * already expect this.
   */
  const finalPathname =
    `faceevol-video-${Date.now()}-` +
    `${uploadId.slice(
      0,
      12
    )}-${fileName}`;


  try {

    const joinedStream =
      createJoinedPrivateBlobStream(
        chunkPaths
      );


    /*
     * Store the complete video.
     *
     * multipart:true allows the Blob SDK
     * to safely upload the larger final
     * stream in multiple parts.
     */
    const blob =
      await put(
        finalPathname,
        joinedStream,
        {
          access:
            "private",

          contentType:
            "video/mp4",

          addRandomSuffix:
            false,

          cacheControlMaxAge:
            60,

          multipart:
            true
        }
      );


    /*
     * Final MP4 now exists.
     * Remove temporary chunks.
     */
    await cleanupChunks(
      chunkPaths
    );


    return res
      .status(200)
      .json({
        success:
          true,

        blob
      });


  } catch (error) {

    const message =
      error instanceof Error
        ? error.message
        : String(
            error
          );


    console.error(
      "FaceEvol video upload finalization failed:",
      uploadId,
      message
    );


    /*
     * Do not immediately delete the
     * chunks here.
     *
     * This allows the browser to retry
     * finalization. If it ultimately
     * gives up, it sends abort:true.
     */
    return res
      .status(500)
      .json({
        error:
          "Could not finalize secure video upload.",

        details:
          message.slice(
            0,
            1600
          )
      });
  }
}


/*
 * =========================================================
 * EXISTING FACEVOL CLIENT UPLOAD
 * =========================================================
 *
 * No ?action= parameter.
 *
 * This preserves your existing FaceEvol
 * upload behavior for face photos,
 * Video Face Swap, etc.
 */
async function handleExistingBlobClient(
  req,
  res
) {

  let body;


  try {

    body =
      req.body;


  } catch (error) {

    return res
      .status(400)
      .json({
        error:
          "Invalid upload request.",

        details:
          error instanceof Error
            ? error.message
            : String(
                error
              )
      });
  }


  body =
    normalizeJsonBody(
      body
    );


  try {

    const jsonResponse =
      await handleUpload({
        body,

        request:
          req,


        onBeforeGenerateToken:
          async (
            pathname
          ) => {

            if (
              typeof pathname !==
              "string"
            ) {

              throw new Error(
                "Invalid upload pathname"
              );
            }


            /*
             * Optimized temporary
             * face photo.
             */
            if (
              pathname.startsWith(
                "faceevol-face-"
              )
            ) {

              return {
                allowedContentTypes: [
                  "image/jpeg"
                ],

                maximumSizeInBytes:
                  8 *
                  1024 *
                  1024,

                addRandomSuffix:
                  true
              };
            }


            /*
             * Temporary source video.
             */
            if (
              pathname.startsWith(
                "faceevol-video-"
              )
            ) {

              return {
                allowedContentTypes: [
                  "video/mp4",
                  "video/quicktime",
                  "video/webm"
                ],

                maximumSizeInBytes:
                  300 *
                  1024 *
                  1024,

                addRandomSuffix:
                  true
              };
            }


            throw new Error(
              "Invalid FaceEvol upload type"
            );
          },


        onUploadCompleted:
          async ({
            blob
          }) => {

            console.log(
              "FaceEvol temporary upload completed:",
              blob.pathname
            );
          }
      });


    return res
      .status(200)
      .json(
        jsonResponse
      );


  } catch (error) {

    console.error(
      "Blob upload error:",
      error
    );


    return res
      .status(500)
      .json({
        error:
          "Could not prepare upload",

        details:
          error instanceof Error
            ? error.message
            : String(
                error
              )
      });
  }
}


/*
 * =========================================================
 * MAIN ROUTER
 * =========================================================
 */
export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Cache-Control",
    "no-store"
  );


  if (
    req.method !==
    "POST"
  ) {

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


  const action =
    String(
      firstQueryValue(
        req.query?.action
      ) ||
      ""
    )
      .toLowerCase();


  /*
   * Enhancement chunk.
   */
  if (
    action ===
    "chunk"
  ) {

    return handleVideoChunk(
      req,
      res
    );
  }


  /*
   * Finish / abort enhancement upload.
   */
  if (
    action ===
    "complete"
  ) {

    return handleVideoComplete(
      req,
      res
    );
  }


  /*
   * Everything else continues using
   * FaceEvol's original upload system.
   */
  return handleExistingBlobClient(
    req,
    res
  );
}

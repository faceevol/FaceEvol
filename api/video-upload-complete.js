import {
  del,
  get,
  put
} from "@vercel/blob";

/*
 * FaceEvol chunk finalizer
 * Save as:
 * /api/video-upload-complete.js
 *
 * Reads the private temporary chunks
 * in order and streams them into one
 * final private MP4.
 *
 * Temporary chunks are then deleted.
 */

const MAX_CHUNKS =
  110;


function validUploadId(value) {
  return (
    typeof value ===
      "string" &&
    /^[a-zA-Z0-9_-]{8,64}$/.test(
      value
    )
  );
}


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
      .slice(
        -120
      );


  return cleaned
    .toLowerCase()
    .endsWith(".mp4")
      ? cleaned
      : `${cleaned}.mp4`;
}


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
 * Stream all private temporary chunks
 * together without loading the complete
 * video into server memory.
 */
function joinedPrivateBlobStream(
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
           * Open next temporary chunk.
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
           * Read one piece from the
           * current Blob chunk.
           */
          const next =
            await reader.read();


          if (
            next.done
          ) {

            reader =
              null;

            continue;
          }


          controller.enqueue(
            next.value
          );

          return;
        }


      } catch (
        error
      ) {

        controller.error(
          error
        );
      }
    },


    async cancel(
      reason
    ) {

      if (reader) {

        try {

          await reader.cancel(
            reason
          );

        } catch {}
      }
    }

  });
}


/*
 * Delete temporary chunks.
 *
 * Cleanup errors must not overwrite
 * an otherwise successful operation.
 */
async function cleanup(
  paths
) {

  if (
    !paths.length
  ) {
    return;
  }


  try {

    await del(
      paths
    );


  } catch (
    error
  ) {

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


  /*
   * Read JSON request body.
   */
  const body =
    typeof req.body ===
      "string"

      ? (() => {

          try {

            return JSON.parse(
              req.body
            );

          } catch {

            return {};
          }

        })()

      : (
          req.body ||
          {}
        );


  const uploadId =
    body.uploadId;


  const chunkCount =
    Number(
      body.chunkCount
    );


  /*
   * Validate upload session.
   */
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


  /*
   * Maximum:
   *
   * 110 × about 3 MB
   * ≈ 330 MB
   */
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
   * Allow the frontend to request
   * cleanup if an upload is cancelled.
   */
  if (
    body.abort ===
    true
  ) {

    await cleanup(
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
   * Final private video pathname.
   *
   * This matches FaceEvol's existing
   * faceevol-video-* security checks.
   */
  const finalPathname =
    `faceevol-video-${Date.now()}-${uploadId.slice(
      0,
      12
    )}-${fileName}`;


  try {

    /*
     * Join all temporary private
     * chunk Blobs as one stream.
     */
    const stream =
      joinedPrivateBlobStream(
        chunkPaths
      );


    /*
     * Save assembled MP4 into
     * private Vercel Blob storage.
     */
    const blob =
      await put(
        finalPathname,
        stream,
        {
          access:
            "private",

          contentType:
            "video/mp4",

          addRandomSuffix:
            false,

          cacheControlMaxAge:
            60
        }
      );


    /*
     * Final video exists now,
     * so remove temporary chunks.
     */
    await cleanup(
      chunkPaths
    );


    return res
      .status(200)
      .json({
        success:
          true,

        blob
      });


  } catch (
    error
  ) {

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
     * Avoid leaving temporary
     * chunks behind after failure.
     */
    await cleanup(
      chunkPaths
    );


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

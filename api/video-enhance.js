import {
  head,
  issueSignedToken,
  presignUrl
} from "@vercel/blob";

/*
 * FaceEvol Video Enhance
 * Save as:
 * /api/video-enhance.js
 *
 * Model:
 * bytedance/video-upscaler
 *
 * Flow:
 * 1. FaceEvol uploads the MP4 to PRIVATE Vercel Blob.
 * 2. This API verifies that private Blob exists.
 * 3. FaceEvol creates a temporary GET-only signed URL.
 * 4. Replicate receives that signed URL.
 * 5. Replicate starts ByteDance Video Upscaler asynchronously.
 * 6. The frontend polls /api/prediction.js until completion.
 */

const ALLOWED_RESOLUTIONS =
  new Set([
    "1080p",
    "2k",
    "4k"
  ]);

const ALLOWED_FPS =
  new Set([
    30,
    60
  ]);

const ALLOWED_SCENES =
  new Set([
    "common",
    "aigc",
    "ugc",
    "short_series",
    "old_film"
  ]);


/*
 * Replicate gets temporary access
 * to this one private video for 2 hours.
 */
const SIGNED_URL_LIFETIME_MS =
  2 * 60 * 60 * 1000;


/*
 * Only allow temporary FaceEvol MP4s.
 */
function cleanPathname(
  value
) {
  const pathname =
    typeof value === "string"
      ? value.trim()
      : "";


  if (
    !pathname ||
    !pathname.startsWith(
      "faceevol-video-"
    ) ||
    !pathname
      .toLowerCase()
      .endsWith(
        ".mp4"
      ) ||
    !/^[a-zA-Z0-9._/-]+$/.test(
      pathname
    )
  ) {
    return null;
  }


  return pathname;
}


/*
 * Keep error details small enough
 * to safely return to the frontend.
 */
function safeDetail(
  value
) {
  if (
    !value
  ) {
    return "";
  }


  if (
    typeof value ===
    "string"
  ) {
    return value.slice(
      0,
      2000
    );
  }


  try {

    return JSON.stringify(
      value
    ).slice(
      0,
      2000
    );

  } catch {

    return String(
      value
    ).slice(
      0,
      2000
    );
  }
}


/*
 * Create temporary GET access
 * to one PRIVATE Vercel Blob.
 */
async function createTemporaryVideoReadUrl(
  pathname
) {
  let metadata;


  /*
   * Verify that the private source
   * file actually exists.
   */
  try {

    metadata =
      await head(
        pathname
      );

  } catch (
    error
  ) {

    throw new Error(
      `PRIVATE_VIDEO_NOT_FOUND: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }


  if (
    !metadata ||
    !metadata.pathname
  ) {

    throw new Error(
      "PRIVATE_VIDEO_NOT_FOUND: FaceEvol could not find the uploaded video."
    );
  }


  /*
   * Reject empty files.
   */
  if (
    metadata.size !==
      undefined &&
    metadata.size !==
      null &&
    Number(
      metadata.size
    ) <= 0
  ) {

    throw new Error(
      "PRIVATE_VIDEO_EMPTY: The uploaded video is empty."
    );
  }


  const validUntil =
    Date.now() +
    SIGNED_URL_LIFETIME_MS;


  /*
   * Issue a delegation token.
   *
   * It is limited to:
   * - this exact pathname
   * - GET only
   * - two-hour expiry
   */
  const signedToken =
    await issueSignedToken({
      pathname,

      operations: [
        "get"
      ],

      validUntil
    });


  /*
   * IMPORTANT FIX:
   *
   * access: "private"
   *
   * Without the access value,
   * Vercel can construct:
   *
   * <store>.undefined.blob.vercel-storage.com
   *
   * instead of:
   *
   * <store>.private.blob.vercel-storage.com
   */
  const signed =
    await presignUrl(
      signedToken,
      {
        operation:
          "get",

        pathname,

        access:
          "private",

        validUntil,

        /*
         * This is a video that may
         * have been uploaded seconds ago.
         *
         * Bypass CDN cache and read
         * directly from origin storage.
         */
        useCache:
          false
      }
    );


  if (
    !signed ||
    typeof signed.presignedUrl !==
      "string" ||
    !signed.presignedUrl.startsWith(
      "https://"
    )
  ) {

    throw new Error(
      "SIGNED_VIDEO_URL_FAILED: FaceEvol could not create temporary video access."
    );
  }


  /*
   * Extra safety check:
   * Never send Replicate another
   * malformed ".undefined." URL.
   */
  if (
    signed.presignedUrl.includes(
      ".undefined.blob.vercel-storage.com"
    )
  ) {

    throw new Error(
      "SIGNED_VIDEO_URL_FAILED: Vercel returned an invalid Blob hostname."
    );
  }


  /*
   * The correct private Blob URL should
   * contain .private.blob.vercel-storage.com
   */
  if (
    !signed.presignedUrl.includes(
      ".private.blob.vercel-storage.com"
    )
  ) {

    throw new Error(
      "SIGNED_VIDEO_URL_FAILED: Vercel did not return a private Blob URL."
    );
  }


  return signed.presignedUrl;
}


export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Cache-Control",
    "no-store"
  );


  /*
   * POST only.
   */
  if (
    req.method !==
    "POST"
  ) {

    res.setHeader(
      "Allow",
      "POST"
    );


    return res
      .status(
        405
      )
      .json({
        error:
          "Method not allowed"
      });
  }


  /*
   * Replicate API token.
   */
  const replicateToken =
    process.env
      .REPLICATE_API_TOKEN;


  if (
    !replicateToken
  ) {

    return res
      .status(
        500
      )
      .json({
        error:
          "REPLICATE_API_TOKEN is not configured"
      });
  }


  /*
   * Values received from
   * FaceEvol index.html.
   */
  const {
    pathname:
      rawPathname,

    target_resolution,

    target_fps,

    scene

  } =
    req.body || {};


  /*
   * Validate private Blob pathname.
   */
  const pathname =
    cleanPathname(
      rawPathname
    );


  if (
    !pathname
  ) {

    return res
      .status(
        400
      )
      .json({
        error:
          "A valid FaceEvol MP4 upload is required."
      });
  }


  /*
   * Validate output resolution.
   */
  const resolution =
    ALLOWED_RESOLUTIONS.has(
      target_resolution
    )
      ? target_resolution
      : "1080p";


  /*
   * Validate output FPS.
   */
  const requestedFps =
    Number(
      target_fps
    );


  const fps =
    ALLOWED_FPS.has(
      requestedFps
    )
      ? requestedFps
      : 30;


  /*
   * Validate enhancement scene.
   */
  const selectedScene =
    ALLOWED_SCENES.has(
      scene
    )
      ? scene
      : "common";


  try {

    /*
     * Create temporary secure
     * read access for Replicate.
     */
    const videoUrl =
      await createTemporaryVideoReadUrl(
        pathname
      );


    console.log(
      "FACEVOL VIDEO ENHANCE INPUT READY:",
      pathname,
      resolution,
      `${fps}fps`,
      selectedScene
    );


    /*
     * Do NOT log the actual signed URL.
     * It contains temporary credentials.
     */
    console.log(
      "FACEVOL SIGNED VIDEO URL READY:",
      videoUrl.includes(
        ".private.blob.vercel-storage.com"
      )
    );


    /*
     * Start ByteDance Video Upscaler
     * asynchronously.
     *
     * There is intentionally NO:
     *
     * Prefer: "wait=60"
     *
     * Video enhancement can take
     * several minutes.
     *
     * Replicate should return the
     * prediction ID immediately.
     */
    const response =
      await fetch(
        "https://api.replicate.com/v1/models/bytedance/video-upscaler/predictions",
        {
          method:
            "POST",

          headers: {

            Authorization:
              `Bearer ${replicateToken}`,

            "Content-Type":
              "application/json",

            /*
             * Allow long processing
             * on Replicate.
             */
            "Cancel-After":
              "30m"
          },


          body:
            JSON.stringify({
              input: {

                /*
                 * Temporary signed
                 * PRIVATE Blob URL.
                 */
                video:
                  videoUrl,


                /*
                 * Standard mode does
                 * not require Pro access.
                 */
                processing_type:
                  "standard",


                /*
                 * Enhancement preset.
                 */
                scene:
                  selectedScene,


                /*
                 * 1080p / 2K / 4K
                 */
                target_resolution:
                  resolution,


                /*
                 * 30 / 60 FPS
                 */
                target_fps:
                  fps
              }
            })
        }
      );


    /*
     * Read Replicate response.
     */
    let prediction;


    try {

      prediction =
        await response.json();

    } catch {

      prediction =
        null;
    }


    /*
     * Replicate rejected the
     * enhancement request.
     */
    if (
      !response.ok
    ) {

      const details =
        safeDetail(
          prediction?.detail ||
          prediction?.error ||
          prediction ||
          `Replicate HTTP ${
            response.status
          }`
        );


      console.error(
        "FaceEvol video enhancement Replicate request failed:",
        response.status,
        details
      );


      return res
        .status(
          response.status
        )
        .json({
          error:
            "Video enhancement request failed.",

          details
        });
    }


    /*
     * Validate prediction response.
     */
    if (
      !prediction ||
      typeof prediction !==
        "object"
    ) {

      return res
        .status(
          502
        )
        .json({
          error:
            "Video enhancement returned an invalid response."
        });
    }


    /*
     * We need the prediction ID
     * for /api/prediction.js.
     */
    if (
      !prediction.id

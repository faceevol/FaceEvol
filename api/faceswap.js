import {
  createHmac
} from "node:crypto";

import {
  del
} from "@vercel/blob";


/* ============================================================================
 * FaceEvol server-side authentication + credits
 *
 * Video face-swap costs are server-defined by the Supabase tool key
 *
 * Required Vercel environment variable:
 *   SUPABASE_SECRET_KEY = sb_secret_...
 *
 * Never expose that secret in index.html.
 * ========================================================================== */

const FACEVOL_SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://hasffllflyeoitsenlgc.supabase.co";

const FACEVOL_SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_r4T07DT0rPGl1v6avJ-Qiw_exZZn30r";

const FACEVOL_SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";


function faceEvolBearerToken(req) {
  const header =
    String(
      req.headers?.authorization ||
      req.headers?.Authorization ||
      ""
    ).trim();

  const match =
    header.match(
      /^Bearer\s+(.+)$/i
    );

  return match
    ? match[1].trim()
    : "";
}


function faceEvolRequestReference(req) {
  const raw =
    req.headers?.[
      "x-faceevol-request-id"
    ];

  const value =
    Array.isArray(raw)
      ? raw[0]
      : raw;

  const reference =
    String(
      value || ""
    ).trim();

  if (
    !reference ||
    reference.length > 160 ||
    !/^[a-zA-Z0-9._:-]+$/.test(
      reference
    )
  ) {
    return "";
  }

  return reference;
}


async function faceEvolReadResponse(
  response
) {
  const text =
    await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}


async function faceEvolUserRequest(
  accessToken,
  pathname,
  options = {}
) {
  const response =
    await fetch(
      `${FACEVOL_SUPABASE_URL}${pathname}`,
      {
        ...options,

        headers: {
          apikey:
            FACEVOL_SUPABASE_PUBLISHABLE_KEY,

          Authorization:
            `Bearer ${accessToken}`,

          "Content-Type":
            "application/json",

          ...(options.headers || {})
        }
      }
    );

  const data =
    await faceEvolReadResponse(
      response
    );

  if (!response.ok) {
    const message =
      (
        data &&
        typeof data ===
          "object" &&
        (
          data.message ||
          data.error_description ||
          data.error ||
          data.details
        )
      ) ||
      (
        typeof data ===
          "string"
          ? data
          : ""
      ) ||
      `Supabase HTTP ${response.status}`;

    const error =
      new Error(
        String(message)
      );

    error.status =
      response.status;

    error.payload =
      data;

    throw error;
  }

  return data;
}


function faceEvolAdminHeaders(
  extra = {}
) {
  if (
    !FACEVOL_SUPABASE_SECRET_KEY
  ) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not configured"
    );
  }

  const headers = {
    apikey:
      FACEVOL_SUPABASE_SECRET_KEY,

    "Content-Type":
      "application/json",

    ...extra
  };


  /*
   * Legacy service_role JWT compatibility.
   */
  if (
    !FACEVOL_SUPABASE_SECRET_KEY
      .startsWith(
        "sb_secret_"
      ) &&
    FACEVOL_SUPABASE_SECRET_KEY
      .split(".").length === 3
  ) {
    headers.Authorization =
      `Bearer ${FACEVOL_SUPABASE_SECRET_KEY}`;
  }

  return headers;
}


async function faceEvolAdminRequest(
  pathname,
  options = {}
) {
  const response =
    await fetch(
      `${FACEVOL_SUPABASE_URL}${pathname}`,
      {
        ...options,

        headers:
          faceEvolAdminHeaders(
            options.headers || {}
          )
      }
    );

  const data =
    await faceEvolReadResponse(
      response
    );

  if (!response.ok) {
    const message =
      (
        data &&
        typeof data ===
          "object" &&
        (
          data.message ||
          data.error_description ||
          data.error ||
          data.details
        )
      ) ||
      (
        typeof data ===
          "string"
          ? data
          : ""
      ) ||
      `Supabase admin HTTP ${response.status}`;

    const error =
      new Error(
        String(message)
      );

    error.status =
      response.status;

    error.payload =
      data;

    throw error;
  }

  return data;
}


async function faceEvolAdminRpc(
  functionName,
  payload
) {
  return faceEvolAdminRequest(
    `/rest/v1/rpc/${encodeURIComponent(
      functionName
    )}`,
    {
      method:
        "POST",

      body:
        JSON.stringify(
          payload || {}
        )
    }
  );
}


async function faceEvolRequireUser(
  req,
  res
) {
  if (
    !FACEVOL_SUPABASE_SECRET_KEY
  ) {
    res
      .status(500)
      .json({
        error:
          "FaceEvol server security is not configured.",

        code:
          "SERVER_SECURITY_NOT_CONFIGURED"
      });

    return null;
  }


  const accessToken =
    faceEvolBearerToken(
      req
    );


  if (!accessToken) {
    res
      .status(401)
      .json({
        error:
          "Sign in is required to use FaceEvol AI tools.",

        code:
          "AUTH_REQUIRED"
      });

    return null;
  }


  try {
    const user =
      await faceEvolUserRequest(
        accessToken,
        "/auth/v1/user",
        {
          method:
            "GET"
        }
      );


    if (
      !user ||
      !user.id
    ) {
      res
        .status(401)
        .json({
          error:
            "Your FaceEvol session is no longer valid. Please sign in again.",

          code:
            "AUTH_REQUIRED"
        });

      return null;
    }


    return {
      accessToken,
      user
    };

  } catch (error) {
    console.warn(
      "FaceEvol authentication rejected:",
      error instanceof Error
        ? error.message
        : String(error)
    );


    res
      .status(401)
      .json({
        error:
          "Your FaceEvol session is no longer valid. Please sign in again.",

        code:
          "AUTH_REQUIRED"
      });

    return null;
  }
}


function faceEvolCreditPayload(
  state,
  extra = {}
) {
  if (
    !state ||
    typeof state !==
      "object"
  ) {
    return extra;
  }

  return {
    tool:
      state.tool ||
      null,

    charged:
      Number(
        state.charged || 0
      ),

    credits_remaining:
      Number.isFinite(
        Number(
          state.credits_remaining
        )
      )
        ? Number(
            state.credits_remaining
          )
        : null,

    request_reference:
      state.request_reference ||
      null,

    prediction_id:
      state.prediction_id ||
      null,

    status:
      state.status ||
      null,

    provider_status:
      state.provider_status ||
      null,

    ...extra
  };
}


async function startFaceEvolGenerationGuard(
  req,
  res,
  tool
) {
  const auth =
    await faceEvolRequireUser(
      req,
      res
    );

  if (!auth) {
    return null;
  }


  let requestReference =
    faceEvolRequestReference(
      req
    );


  /*
   * Compatibility with an older
   * cached frontend.
   */
  if (!requestReference) {
    requestReference =
      `srv-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}-${Math.random()
        .toString(36)
        .slice(2)}`;
  }


  let reservation;


  try {
    reservation =
      await faceEvolAdminRpc(
        "begin_faceevol_generation_admin",
        {
          p_user_id:
            auth.user.id,

          p_tool:
            tool,

          p_reference:
            requestReference
        }
      );

  } catch (error) {
    const message =
      String(
        error instanceof Error
          ? error.message
          : error
      ).toUpperCase();


    if (
      message.includes(
        "INSUFFICIENT_CREDITS"
      )
    ) {
      res
        .status(402)
        .json({
          error:
            "You don't have enough FaceEvol credits for this creation.",

          code:
            "INSUFFICIENT_CREDITS"
        });

      return null;
    }


    if (
      message.includes(
        "PROFILE_NOT_FOUND"
      )
    ) {
      res
        .status(409)
        .json({
          error:
            "Your FaceEvol credit profile is not ready yet. Please sign out and sign in again.",

          code:
            "PROFILE_NOT_FOUND"
        });

      return null;
    }


    console.error(
      "FaceEvol credit reservation failed:",
      error
    );


    res
      .status(503)
      .json({
        error:
          "FaceEvol couldn't verify your credits right now. Please try again.",

        code:
          "CREDIT_SERVICE_UNAVAILABLE"
      });

    return null;
  }


  /*
   * Prevent the same request from
   * being charged twice.
   */
  if (
    reservation
      ?.already_processed ===
      true
  ) {
    const body = {
      error:
        "This FaceEvol request has already been submitted. Please start the creation again.",

      code:
        "DUPLICATE_GENERATION_REQUEST",

      faceevol_credit:
        faceEvolCreditPayload(
          reservation,
          {
            reserved:
              reservation?.status !==
              "refunded",

            refunded:
              reservation?.status ===
              "refunded",

            duplicate:
              true
          }
        )
    };


    if (
      reservation
        ?.prediction_id
    ) {
      body.prediction = {
        id:
          reservation.prediction_id,

        status:
          reservation.provider_status ||
          reservation.status ||
          "processing"
      };
    }


    res
      .status(409)
      .json(body);

    return null;
  }


  /*
   * Wrap the route's normal JSON response.
   */
  const originalJson =
    res.json.bind(res);

  let settled =
    false;


  res.json =
    function faceEvolProtectedJson(
      payload
    ) {
      if (settled) {
        return originalJson(
          payload
        );
      }

      settled =
        true;


      return (async () => {
        const statusCode =
          Number(
            res.statusCode ||
            200
          );


        const predictionId =
          String(
            payload
              ?.prediction
              ?.id ||
            payload?.id ||
            ""
          ).trim();


        const accepted =
          statusCode >= 200 &&
          statusCode < 300 &&
          Boolean(
            predictionId
          ) &&
          !payload?.error;


        let creditState =
          reservation;


        let creditExtra = {
          reserved:
            true,

          refunded:
            false
        };


        /*
         * Replicate successfully
         * accepted the generation.
         */
        if (accepted) {
          let registrationError =
            null;


          for (
            let attempt = 0;
            attempt < 3;
            attempt += 1
          ) {
            try {
              creditState =
                await faceEvolAdminRpc(
                  "register_faceevol_prediction_admin",
                  {
                    p_user_id:
                      auth.user.id,

                    p_reference:
                      requestReference,

                    p_prediction_id:
                      predictionId
                  }
                );


              registrationError =
                null;

              break;

            } catch (error) {
              registrationError =
                error;


              if (
                attempt < 2
              ) {
                await new Promise(
                  resolve =>
                    setTimeout(
                      resolve,
                      150 *
                        (
                          attempt +
                          1
                        )
                    )
                );
              }
            }
          }


          /*
           * We never leave a user's charge
           * without secure prediction tracking.
           */
          if (
            registrationError
          ) {
            console.error(
              "FaceEvol could not register provider prediction:",
              registrationError
            );


            try {
              creditState =
                await faceEvolAdminRpc(
                  "refund_faceevol_generation_by_reference_admin",
                  {
                    p_user_id:
                      auth.user.id,

                    p_reference:
                      requestReference,

                    p_reason:
                      "Prediction tracking could not be registered"
                  }
                );

            } catch (
              refundError
            ) {
              console.error(
                "FaceEvol tracking-error refund failed:",
                refundError
              );
            }


            res.statusCode =
              503;


            return originalJson({
              error:
                "FaceEvol started the AI job but could not securely track it. Your credits were restored; please try again.",

              code:
                "PREDICTION_TRACKING_FAILED",

              faceevol_credit:
                faceEvolCreditPayload(
                  creditState,
                  {
                    reserved:
                      false,

                    refunded:
                      true
                  }
                )
            });
          }


          creditExtra
            .prediction_id =
            predictionId;


          /*
           * Normally Video Face Swap returns
           * starting/processing and is completed
           * later through /api/prediction.
           *
           * But handle an immediate terminal
           * response too.
           */
          const providerStatus =
            String(
              payload
                ?.prediction
                ?.status ||
              payload?.status ||
              ""
            ).toLowerCase();


          if (
            [
              "succeeded",
              "failed",
              "canceled",
              "cancelled"
            ].includes(
              providerStatus
            )
          ) {
            try {
              const finalized =
                await faceEvolAdminRpc(
                  "finalize_faceevol_prediction_admin",
                  {
                    p_user_id:
                      auth.user.id,

                    p_prediction_id:
                      predictionId,

                    p_provider_status:
                      providerStatus
                  }
                );


              creditState =
                finalized ||
                creditState;


              creditExtra
                .refunded =
                finalized
                  ?.refunded ===
                true;


              creditExtra
                .reserved =
                finalized
                  ?.refunded !==
                true;

            } catch (
              finalizeError
            ) {
              console.error(
                "FaceEvol immediate prediction finalization failed:",
                finalizeError
              );


              creditExtra
                .finalize_warning =
                true;
            }
          }

        } else {
          /*
           * Provider job did not successfully
           * start, so restore the reserved tool credits.
           */
          try {
            creditState =
              await faceEvolAdminRpc(
                "refund_faceevol_generation_by_reference_admin",
                {
                  p_user_id:
                    auth.user.id,

                  p_reference:
                    requestReference,

                  p_reason:
                    payload?.error ||
                    `FaceEvol API returned HTTP ${statusCode}`
                }
              );


            creditExtra = {
              reserved:
                false,

              refunded:
                creditState
                  ?.refunded ===
                true
            };

          } catch (
            refundError
          ) {
            console.error(
              "FaceEvol automatic API-error refund failed:",
              refundError
            );


            creditExtra
              .refund_warning =
              true;
          }
        }


        if (
          payload &&
          typeof payload ===
            "object" &&
          !Array.isArray(
            payload
          )
        ) {
          payload = {
            ...payload,

            faceevol_credit:
              faceEvolCreditPayload(
                creditState,
                creditExtra
              )
          };
        }


        return originalJson(
          payload
        );
      })();
    };


  return {
    user:
      auth.user,

    requestReference,

    reservation
  };
}


/* ============================================================================
 * Existing FaceEvol private Blob / signed proxy helpers
 * ========================================================================== */


function createSignature(
  pathname,
  expires,
  secret
) {
  return createHmac(
    "sha256",
    secret
  )
    .update(
      `${pathname}:${expires}`
    )
    .digest("hex");
}


function getBlobPathname(
  blobUrlString,
  requiredPrefix
) {
  const blobUrl =
    new URL(
      blobUrlString
    );


  /*
   * Require Vercel Blob storage.
   */
  if (
    !blobUrl.hostname.endsWith(
      ".blob.vercel-storage.com"
    )
  ) {
    throw new Error(
      "Invalid Blob storage URL"
    );
  }


  const pathname =
    decodeURIComponent(
      blobUrl.pathname.slice(1)
    );


  if (
    !pathname ||
    !pathname.startsWith(
      requiredPrefix
    )
  ) {
    throw new Error(
      "Invalid Blob pathname"
    );
  }


  return pathname;
}


function buildSignedProxyUrl(
  route,
  pathname,
  expires,
  secret
) {
  const signature =
    createSignature(
      pathname,
      expires,
      secret
    );


  const url =
    new URL(
      route,
      "https://www.faceevol.com"
    );


  url.searchParams.set(
    "pathname",
    pathname
  );


  url.searchParams.set(
    "expires",
    expires
  );


  url.searchParams.set(
    "signature",
    signature
  );


  return url.toString();
}


async function cleanupInputs(
  pathnames
) {
  const safe =
    pathnames.filter(
      Boolean
    );


  if (!safe.length) {
    return;
  }


  try {
    await del(
      safe
    );


    console.log(
      "Cleaned temporary FaceEvol inputs:",
      safe
    );

  } catch (error) {
    console.warn(
      "Temporary input cleanup failed:",
      error instanceof Error
        ? error.message
        : String(error)
    );
  }
}


const SINGLE_VIDEO_FACE_SWAP_VERSION =
  "104b4a39315349db50880757bc8c1c996c5309e3aa11286b0a3c84dab81fd440";

/*
 * Live multi-face video model on Replicate.
 * This branch stays inside /api/faceswap.js to preserve the Function count.
 */
const MULTI_VIDEO_FACE_SWAP_VERSION =
  "skytells-research/deepface:9258be7df5239c1f38c9a667f6e0c9cb3a45e3e6520bbd7400e5c9cf4d697b24";


/* ============================================================================
 * FaceEvol Video Face Swap API
 * ========================================================================== */


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


  const body =
    req.body || {};

  const mode =
    String(
      body.mode || ""
    )
      .trim()
      .toLowerCase();

  if (
    !["", "single", "multi"].includes(
      mode
    )
  ) {
    return res.status(400).json({
      error:
        "Unsupported video face swap mode"
    });
  }

  /*
   * One serverless Function now serves both
   * single and multiple video face swap.
   */
  const faceEvolGuard =
    await startFaceEvolGenerationGuard(
      req,
      res,
      mode === "multi"
        ? "multi_video_faceswap"
        : "video_faceswap"
    );


  if (!faceEvolGuard) {
    return;
  }


  const replicateToken =
    process.env
      .REPLICATE_API_TOKEN;


  if (!replicateToken) {
    return res
      .status(500)
      .json({
        error:
          "REPLICATE_API_TOKEN is not configured"
      });
  }


  /*
   * face and video are PRIVATE
   * Vercel Blob URLs.
   *
   * The face is NOT Base64.
   */
  const {
    face,
    video
  } =
    body;


  if (
    typeof face !==
      "string" ||
    !face.startsWith(
      "https://"
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          "A valid face image URL is required"
      });
  }


  if (
    typeof video !==
      "string" ||
    !video.startsWith(
      "https://"
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          "A valid video URL is required"
      });
  }


  let facePathname =
    null;

  let videoPathname =
    null;


  try {
    facePathname =
      getBlobPathname(
        face,
        "faceevol-face-"
      );


    videoPathname =
      getBlobPathname(
        video,
        "faceevol-video-"
      );


    /*
     * Replicate gets 30 minutes
     * to retrieve temporary files.
     */
    const expires =
      String(
        Date.now() +
        30 * 60 * 1000
      );


    const imageProxyUrl =
      buildSignedProxyUrl(
        "/api/image.jpg",
        facePathname,
        expires,
        replicateToken
      );


    const videoProxyUrl =
      buildSignedProxyUrl(
        "/api/video.mp4",
        videoPathname,
        expires,
        replicateToken
      );


    console.log(
      "Starting FaceEvol prediction",
      mode === "multi"
        ? "multi_video_faceswap"
        : "video_faceswap"
    );


    console.log(
      "Face input proxy:",
      imageProxyUrl.replace(
        /signature=[^&]+/,
        "signature=HIDDEN"
      )
    );


    console.log(
      "Video input proxy:",
      videoProxyUrl.replace(
        /signature=[^&]+/,
        "signature=HIDDEN"
      )
    );


    /*
     * Existing working Video Face Swap
     * model and input schema preserved.
     */
    const isMulti =
      mode === "multi";


    const replicatePayload =
      isMulti
        ? {
            version:
              MULTI_VIDEO_FACE_SWAP_VERSION,

            input: {
              /*
               * DeepFace multi-video schema:
               * source = source face image
               * target = target video
               *
               * /api/prediction.js is updated in this package to
               * clean either source/target orientation safely.
               */
              source:
                imageProxyUrl,

              target:
                videoProxyUrl,

              keep_fps:
                true,

              keep_frames:
                true,

              enhance_face:
                false
            }
          }
        : {
            version:
              SINGLE_VIDEO_FACE_SWAP_VERSION,

            input: {
              source:
                videoProxyUrl,

              target:
                imageProxyUrl
            }
          };


    const response =
      await fetch(
        "https://api.replicate.com/v1/predictions",
        {
          method:
            "POST",

          headers: {
            Authorization:
              `Bearer ${replicateToken}`,

            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify(
              replicatePayload
            )
        }
      );


    let prediction;


    try {
      prediction =
        await response.json();

    } catch {
      prediction =
        null;
    }


    if (!response.ok) {
      console.error(
        "Replicate face swap request failed:",
        prediction
      );


      /*
       * Replicate did not successfully
       * start the prediction.
       *
       * Remove temporary inputs.
       *
       * The security wrapper will also
       * automatically restore the reserved credits.
       */
      await cleanupInputs([
        facePathname,
        videoPathname
      ]);


      return res
        .status(
          response.status
        )
        .json({
          error:
            prediction?.detail ||
            prediction?.error ||
            (
              isMulti
                ? "Replicate multiple video face swap request failed"
                : "Replicate face swap request failed"
            ),

          details:
            prediction
        });
    }


    if (
      !prediction?.id
    ) {
      console.error(
        "Replicate returned no prediction ID:",
        prediction
      );


      await cleanupInputs([
        facePathname,
        videoPathname
      ]);


      return res
        .status(502)
        .json({
          error:
            isMulti
              ? "Multiple video face swap service returned an invalid response."
              : "Face swap service returned an invalid response."
        });
    }


    console.log(
      "FaceEvol prediction created:",
      prediction.id
    );


    /*
     * Security wrapper will now:
     *
     * 1. associate prediction ID with user
     * 2. keep the reserved tool credits
     * 3. allow secure polling through
     *    /api/prediction.js
     */
    return res
      .status(200)
      .json({
        success:
          true,

        prediction
      });


  } catch (error) {
    console.error(
      "Face swap server error:",
      error
    );


    /*
     * If temporary inputs were already
     * identified, remove them.
     */
    await cleanupInputs([
      facePathname,
      videoPathname
    ]);


    /*
     * The response wrapper automatically
     * restores the reserved tool credits.
     */
    return res
      .status(500)
      .json({
        error:
          "Server error",

        details:
          error instanceof Error
            ? error.message
            : String(error)
      });
  }
}

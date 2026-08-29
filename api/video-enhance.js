/*
 * FaceEvol Video Enhance
 * Save as:
 * /api/video-enhance.js
 *
 * Model:
 * bytedance/video-upscaler
 *
 * Current configuration:
 * - Try PRO first
 * - Automatically fall back to STANDARD if PRO is unavailable
 * - Supports 1080p / 2K / 4K
 * - Optimized for real-person / UGC video
 * - Keeps FaceEvol private-video proxy flow
 *
 * Secure version:
 * - Supabase authentication required
 * - Video Enhance = 8 credits
 * - Credits reserved server-side before Replicate
 * - Prediction belongs to authenticated user
 * - Failed starts refund automatically
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


/* ============================================================================
 * FaceEvol server-side authentication + credit security
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
        typeof data === "object" &&
        (
          data.message ||
          data.error_description ||
          data.error ||
          data.details
        )
      ) ||
      (
        typeof data === "string"
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
        typeof data === "object" &&
        (
          data.message ||
          data.error_description ||
          data.error ||
          data.details
        )
      ) ||
      (
        typeof data === "string"
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
  /*
   * Fail closed if server security
   * has not been configured.
   */
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
    /*
     * Verify the user's Supabase
     * access token.
     */
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
  /*
   * 1. Authenticate.
   */
  const auth =
    await faceEvolRequireUser(
      req,
      res
    );

  if (!auth) {
    return null;
  }


  /*
   * 2. Get the idempotency key
   * supplied by the secured frontend.
   */
  let requestReference =
    faceEvolRequestReference(
      req
    );


  /*
   * Temporary compatibility for
   * an older cached frontend.
   */
  if (!requestReference) {
    requestReference =
      `srv-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}-${Math.random()
        .toString(36)
        .slice(2)}`;
  }


  /*
   * 3. Reserve credits BEFORE
   * starting the expensive AI job.
   */
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
   * Do not charge twice for
   * the same request reference.
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
   * Wrap existing JSON responses
   * without rewriting the working
   * Video Enhance model logic.
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
         * Provider accepted
         * the generation.
         */
        if (accepted) {
          let registrationError =
            null;


          /*
           * Register the prediction ID
           * against this user's job.
           */
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
           * If ownership tracking cannot
           * be safely registered,
           * refund the credits.
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
           * This route normally starts
           * asynchronously.
           *
           * Still support an immediate
           * terminal provider response
           * if one ever occurs.
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
           * Provider job did not
           * successfully start.
           *
           * Restore the reserved
           * Video Enhance credits.
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


        /*
         * Attach current credit information
         * to the existing response.
         */
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
 * Existing Video Enhance helpers
 * ========================================================================== */


/*
 * Only accept FaceEvol temporary
 * private video pathnames.
 */
function cleanPathname(
  value
) {
  const pathname =
    typeof value ===
      "string"
      ? value.trim()
      : "";


  if (
    !pathname ||
    !pathname.startsWith(
      "faceevol-video-"
    ) ||
    !/^[a-zA-Z0-9._/-]+$/.test(
      pathname
    )
  ) {
    return null;
  }


  return pathname;
}


function safeDetail(
  value
) {
  if (!value) {
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
 * Start one ByteDance prediction.
 */
async function startPrediction({
  token,
  videoUrl,
  processingType,
  scene,
  resolution,
  fps
}) {
  const response =
    await fetch(
      "https://api.replicate.com/v1/models/bytedance/video-upscaler/predictions",
      {
        method:
          "POST",

        headers: {
          Authorization:
            `Bearer ${token}`,

          "Content-Type":
            "application/json",

          /*
           * Allow long processing
           * on Replicate.
           *
           * We intentionally do NOT
           * use Prefer: wait=60.
           *
           * Secure /api/prediction.js
           * handles polling.
           */
          "Cancel-After":
            "30m"
        },

        body:
          JSON.stringify({
            input: {
              video:
                videoUrl,

              processing_type:
                processingType,

              scene,

              target_resolution:
                resolution,

              target_fps:
                fps
            }
          })
      }
    );


  const responseText =
    await response.text();


  let prediction = {};


  if (responseText) {
    try {
      prediction =
        JSON.parse(
          responseText
        );

    } catch {
      prediction = {
        detail:
          responseText
      };
    }
  }


  return {
    response,
    prediction
  };
}


/*
 * Decide whether failure is specifically
 * related to PRO access.
 */
function shouldFallbackToStandard(
  response,
  prediction
) {
  if (
    ![
      400,
      403,
      422
    ].includes(
      response.status
    )
  ) {
    return false;
  }


  const detail =
    safeDetail(
      prediction?.detail ||
      prediction?.error ||
      prediction
    ).toLowerCase();


  return (
    detail.includes(
      "pro"
    ) ||
    detail.includes(
      "allowlist"
    ) ||
    detail.includes(
      "allow list"
    ) ||
    detail.includes(
      "permission"
    ) ||
    detail.includes(
      "processing_type"
    )
  );
}


/* ============================================================================
 * FaceEvol Video Enhance route
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


  /*
   * SECURITY + CREDIT RESERVATION
   *
   * Video Enhance = 8 credits.
   *
   * This executes before Replicate.
   */
  const faceEvolGuard =
    await startFaceEvolGenerationGuard(
      req,
      res,
      "video_enhance"
    );


  if (!faceEvolGuard) {
    return;
  }


  const token =
    process.env
      .REPLICATE_API_TOKEN;


  if (!token) {
    return res
      .status(500)
      .json({
        error:
          "REPLICATE_API_TOKEN is not configured"
      });
  }


  const {
    pathname:
      rawPathname,

    target_resolution,

    target_fps,

    scene

  } =
    req.body || {};


  const pathname =
    cleanPathname(
      rawPathname
    );


  if (!pathname) {
    return res
      .status(400)
      .json({
        error:
          "A valid FaceEvol video upload is required."
      });
  }


  /*
   * 4K remains the current default.
   *
   * Explicit frontend choices for
   * 1080p / 2k / 4k are respected.
   */
  const resolution =
    ALLOWED_RESOLUTIONS.has(
      target_resolution
    )
      ? target_resolution
      : "4k";


  /*
   * Keep 30 FPS as default.
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
   * UGC remains the preferred
   * real-person preset.
   */
  const selectedScene =
    ALLOWED_SCENES.has(
      scene
    )
      ? scene
      : "ugc";


  /*
   * Keep the Vercel Blob private.
   *
   * Replicate receives only
   * FaceEvol's streaming URL.
   */
  const videoUrl =
    `https://www.faceevol.com/api/video.mp4?pathname=${encodeURIComponent(
      pathname
    )}`;


  try {
    console.log(
      "FACEVOL BYTEDANCE TEST:",
      resolution,
      `${fps}fps`,
      selectedScene
    );


    /*
     * ---------------------------------
     * ATTEMPT 1:
     * ByteDance PRO
     * ---------------------------------
     */
    let {
      response,
      prediction

    } =
      await startPrediction({
        token,

        videoUrl,

        processingType:
          "pro",

        scene:
          selectedScene,

        resolution,

        fps
      });


    let processingType =
      "pro";


    /*
     * If PRO is not available for
     * this Replicate account,
     * automatically retry STANDARD.
     */
    if (
      !response.ok &&
      shouldFallbackToStandard(
        response,
        prediction
      )
    ) {
      console.warn(
        "ByteDance PRO unavailable. Retrying with STANDARD."
      );


      const fallback =
        await startPrediction({
          token,

          videoUrl,

          processingType:
            "standard",

          scene:
            selectedScene,

          resolution,

          fps
        });


      response =
        fallback.response;


      prediction =
        fallback.prediction;


      processingType =
        "standard";
    }


    /*
     * Final provider/API error.
     *
     * The FaceEvol security wrapper
     * automatically refunds 8 credits.
     */
    if (!response.ok) {
      const details =
        safeDetail(
          prediction?.detail ||
          prediction?.error ||
          prediction ||
          `Replicate HTTP ${response.status}`
        );


      console.error(
        "FaceEvol ByteDance request failed:",
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


    if (
      !prediction ||
      typeof prediction !==
        "object"
    ) {
      return res
        .status(502)
        .json({
          error:
            "ByteDance returned an invalid prediction response."
        });
    }


    if (
      !prediction.id
    ) {
      return res
        .status(502)
        .json({
          error:
            "ByteDance did not return a prediction ID.",

          details:
            safeDetail(
              prediction
            )
        });
    }


    console.log(
      "FACEVOL BYTEDANCE STARTED:",
      prediction.id,
      prediction.status,
      processingType,
      resolution,
      `${fps}fps`,
      selectedScene
    );


    /*
     * The security wrapper now:
     *
     * - binds prediction ID to this user
     * - keeps the 8 reserved credits
     * - secure /api/prediction.js polls it
     * - failed/canceled predictions refund
     */
    return res
      .status(200)
      .json({
        success:
          true,

        model:
          "bytedance/video-upscaler",

        settings: {
          processing_type:
            processingType,

          scene:
            selectedScene,

          target_resolution:
            resolution,

          target_fps:
            fps
        },

        prediction
      });


  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);


    console.error(
      "FaceEvol ByteDance enhancement server error:",
      message
    );


    /*
     * The security wrapper automatically
     * restores the reserved 8 credits.
     */
    return res
      .status(500)
      .json({
        error:
          "Could not start ByteDance video enhancement.",

        details:
          message
      });
  }
}

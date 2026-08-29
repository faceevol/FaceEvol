/*
 * FaceEvol Photo to Video
 * Save as: /api/photo-to-video.js
 *
 * Current model:
 * wan-video/wan-2.2-i2v-a14b
 *
 * Secure version:
 * - Supabase authentication required
 * - Photo to Video = 5 credits
 * - Credits reserved server-side
 * - Prediction tied to authenticated user
 * - Failed API starts refund automatically
 */

const MAX_IMAGE_DATA_URI_CHARS = 600_000;
const MAX_PROMPT_LENGTH = 1200;
const ALLOWED_RESOLUTIONS = new Set([
  "480p",
  "720p"
]);


/* ============================================================================
 * FaceEvol server-side security
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
  const header = String(
    req.headers?.authorization ||
    req.headers?.Authorization ||
    ""
  ).trim();

  const match =
    header.match(/^Bearer\s+(.+)$/i);

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
    String(value || "").trim();

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
   * Legacy service_role JWT support.
   */
  if (
    !FACEVOL_SUPABASE_SECRET_KEY
      .startsWith("sb_secret_") &&
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
      method: "POST",

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
          method: "GET"
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
    typeof state !== "object"
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
   * cached FaceEvol page.
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
   * Prevent duplicate charging.
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
          reservation
            .prediction_id,

        status:
          reservation
            .provider_status ||
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
   * Wrap the existing API response.
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
         * AI provider accepted
         * the generation.
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
           * Could not securely bind
           * prediction to account.
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
           * Photo to Video uses Prefer: wait=60.
           *
           * Sometimes Replicate returns
           * the final state immediately.
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
           * Provider did not successfully
           * start a usable prediction.
           *
           * Restore the reserved 5 credits.
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
 * Existing Photo to Video helpers
 * ========================================================================== */

function isImageDataUri(
  value
) {
  return (
    typeof value ===
      "string" &&
    /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(
      value
    )
  );
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
      1200
    );
  }

  try {
    return JSON.stringify(
      value
    ).slice(
      0,
      1200
    );

  } catch {
    return String(
      value
    ).slice(
      0,
      1200
    );
  }
}


/*
 * Quiet server-side prompt guardrail.
 *
 * The public UI stays simple.
 */
function promptIsBlocked(
  prompt
) {
  const text =
    String(
      prompt || ""
    ).toLowerCase();

  const blockedPatterns = [
    /\b(?:nude|naked|nudity|topless|bottomless|porn|pornographic|xxx)\b/i,
    /\b(?:undress|undressing|strip|stripping)\b/i,
    /\b(?:sex|sexual|intercourse|masturbat\w*|orgasm\w*)\b/i,
    /\b(?:genitals?|penis|vagina|vulva|nipples?|breasts?)\b/i,
    /\b(?:take|remove|pull)\s+(?:his|her|their|my|the|a|an)?\s*(?:t[\s-]?shirt|shirt|top|clothes|clothing|dress|pants|shorts|underwear|bra)\s+off\b/i,
    /\b(?:remove|take\s+off)\s+(?:all\s+)?(?:clothes|clothing|underwear)\b/i
  ];

  return blockedPatterns.some(
    pattern =>
      pattern.test(text)
  );
}


/* ============================================================================
 * FaceEvol Photo to Video route
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
   * SERVER SECURITY
   *
   * Photo to Video = 5 credits.
   */
  const faceEvolGuard =
    await startFaceEvolGenerationGuard(
      req,
      res,
      "photo_to_video"
    );

  if (
    !faceEvolGuard
  ) {
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
    image,
    prompt,
    resolution
  } =
    req.body || {};


  /*
   * Validate photo.
   */
  if (
    !isImageDataUri(
      image
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          "A valid photo is required."
      });
  }


  if (
    image.length >
      MAX_IMAGE_DATA_URI_CHARS
  ) {
    return res
      .status(413)
      .json({
        error:
          "The prepared photo is too large. Please try again."
      });
  }


  const cleanPrompt =
    typeof prompt ===
      "string"
      ? prompt.trim()
      : "";


  if (
    cleanPrompt.length < 3
  ) {
    return res
      .status(400)
      .json({
        error:
          "Please describe the motion you want."
      });
  }


  if (
    cleanPrompt.length >
      MAX_PROMPT_LENGTH
  ) {
    return res
      .status(400)
      .json({
        error:
          "The motion description is too long."
      });
  }


  if (
    promptIsBlocked(
      cleanPrompt
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          "That prompt can't be processed. Try a different creative motion or style request.",

        code:
          "PROMPT_NOT_ALLOWED"
      });
  }


  const selectedResolution =
    ALLOWED_RESOLUTIONS.has(
      resolution
    )
      ? resolution
      : "480p";


  /*
   * Keep the user's instruction central
   * while adding a small amount of
   * quality guidance.
   */
  const modelPrompt = [
    "Animate the provided image according to this motion instruction:",
    cleanPrompt,
    "",
    "Keep motion coherent and visually natural.",
    "Preserve the main subject and scene unless the instruction clearly asks for a stylistic change.",
    "Avoid flicker, warped anatomy, duplicated features, and sudden identity changes."
  ].join("\n");


  try {
    /*
     * Existing model preserved:
     *
     * wan-video/wan-2.2-i2v-a14b
     */
    const response =
      await fetch(
        "https://api.replicate.com/v1/models/wan-video/wan-2.2-i2v-a14b/predictions",
        {
          method:
            "POST",

          headers: {
            Authorization:
              `Bearer ${token}`,

            "Content-Type":
              "application/json",

            Prefer:
              "wait=60",

            "Cancel-After":
              "7m"
          },

          body:
            JSON.stringify({
              input: {
                image,

                prompt:
                  modelPrompt,

                /*
                 * Existing settings preserved.
                 *
                 * 81 frames at 16 fps
                 * is approximately 5 seconds.
                 */
                num_frames:
                  81,

                frames_per_second:
                  16,

                resolution:
                  selectedResolution,

                /*
                 * Quality-first settings.
                 */
                go_fast:
                  false,

                sample_steps:
                  30,

                sample_shift:
                  5
              }
            })
        }
      );


    let prediction;


    try {
      prediction =
        await response
          .json();

    } catch {
      prediction =
        null;
    }


    if (
      !response.ok
    ) {
      const details =
        safeDetail(
          prediction?.detail ||
          prediction?.error ||
          prediction ||
          `Replicate HTTP ${response.status}`
        );


      console.error(
        "FaceEvol Photo to Video Replicate request failed:",
        response.status,
        details
      );


      return res
        .status(
          response.status
        )
        .json({
          error:
            "Photo to Video request failed.",

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
            "Photo to Video returned an invalid response."
        });
    }


    console.log(
      "FACEVOL PHOTO-TO-VIDEO:",
      prediction.id,
      prediction.status
    );


    return res
      .status(200)
      .json({
        success:
          true,

        prediction
      });


  } catch (error) {
    console.error(
      "FaceEvol Photo to Video server error:",
      error
    );


    return res
      .status(500)
      .json({
        error:
          "Could not start Photo to Video.",

        details:
          error instanceof Error
            ? error.message
            : String(error)
      });
  }
}

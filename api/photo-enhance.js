/*
 * FaceEvol Photo Enhance
 * Save as: /api/photo-enhance.js
 *
 * Model:
 * sczhou/codeformer
 *
 * Purpose:
 * - Restore blurry / low-quality facial detail
 * - Enhance the background
 * - Upscale to 2x or 4x
 *
 * Secure version:
 * - Supabase authentication required
 * - Photo Enhance = 2 credits
 * - Credits reserved on the server before Replicate
 * - Prediction tied to authenticated user
 * - Failed/canceled requests refund automatically
 *
 * Only ONE Photo Enhance API file is needed.
 * Existing secure /api/prediction.js is reused for polling.
 */

const CODEFORMER_VERSION =
  "sczhou/codeformer:7de2ea26c616d5bf2245ad0d5e24f0ff9a6204578a5c876db53142edd9d2cd56";

const MAX_IMAGE_DATA_URI_CHARS =
  3_500_000;


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
   *
   * New sb_secret_ keys use the apikey
   * header and remain server-side only.
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
   * Do not allow AI usage unless
   * server-side security is configured.
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
     * Validate the supplied access token
     * against Supabase Auth.
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
  /*
   * Step 1:
   * authenticate the Supabase user.
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
   * Step 2:
   * retrieve the frontend idempotency key.
   */
  let requestReference =
    faceEvolRequestReference(
      req
    );


  /*
   * Temporary rollout compatibility
   * with an older cached frontend.
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
   * Step 3:
   * reserve the fixed server-side
   * cost before Replicate is called.
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
   * Never charge the same request twice.
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
   * Step 4:
   *
   * Wrap this route's normal JSON response
   * so we can securely register or refund
   * the credit reservation without changing
   * the working CodeFormer logic.
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


        /*
         * A successful generation start
         * must contain a real prediction ID.
         */
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


        if (accepted) {
          /*
           * Bind the Replicate prediction
           * to this exact FaceEvol user.
           */
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
           * Never leave a paid generation
           * untracked.
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
           * CodeFormer uses Prefer: wait=60.
           *
           * It may therefore finish inside
           * this first request rather than
           * requiring /api/prediction polling.
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
           * Replicate did NOT successfully
           * start a usable prediction.
           *
           * Return the 2 reserved credits.
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
         * Add useful credit state
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
 * Existing Photo Enhance helpers
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
      1800
    );
  }


  try {
    return JSON.stringify(
      value
    ).slice(
      0,
      1800
    );

  } catch {
    return String(
      value
    ).slice(
      0,
      1800
    );
  }
}


function normalizeScale(
  value
) {
  if (
    value === 4 ||
    value === "4" ||
    value === "4x" ||
    value === "4X"
  ) {
    return 4;
  }


  if (
    value === 2 ||
    value === "2" ||
    value === "2x" ||
    value === "2X"
  ) {
    return 2;
  }


  return null;
}


/* ============================================================================
 * FaceEvol Photo Enhance API
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
   * Photo Enhance = 2 credits.
   *
   * This happens before Replicate
   * can be called.
   */
  const faceEvolGuard =
    await startFaceEvolGenerationGuard(
      req,
      res,
      "photo_enhance"
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
    image,
    scale_factor
  } =
    req.body || {};


  if (
    !isImageDataUri(
      image
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          "A valid JPG, PNG or WebP photo is required."
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
          "The prepared photo is too large. Please try another photo."
      });
  }


  const scale =
    normalizeScale(
      scale_factor
    );


  if (!scale) {
    return res
      .status(400)
      .json({
        error:
          "Photo Enhance supports 2x or 4x enhancement."
      });
  }


  try {
    /*
     * Existing working CodeFormer
     * configuration preserved.
     */
    const response =
      await fetch(
        "https://api.replicate.com/v1/predictions",
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
              "5m"
          },

          body:
            JSON.stringify({
              version:
                CODEFORMER_VERSION,

              input: {
                image,

                /*
                 * FaceEvol output quality:
                 *
                 * 2x = enhanced
                 * 4x = maximum resolution
                 */
                upscale:
                  scale,

                /*
                 * Upscale restored
                 * facial details.
                 */
                face_upsample:
                  true,

                /*
                 * Enhance the rest of
                 * the image using
                 * Real-ESRGAN.
                 */
                background_enhance:
                  true,

                /*
                 * IMPORTANT:
                 *
                 * Keep the current
                 * working FaceEvol value.
                 *
                 * 0.82 preserves identity
                 * while still providing
                 * visible restoration.
                 */
                codeformer_fidelity:
                  0.82
              }
            })
        }
      );


    let prediction =
      null;


    try {
      prediction =
        await response.json();

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
        "FACEVOL CODEFORMER REQUEST ERROR:",
        response.status,
        details
      );


      /*
       * Security wrapper sees this
       * as an API failure and refunds
       * the reserved 2 credits.
       */
      return res
        .status(
          response.status
        )
        .json({
          error:
            "Photo Enhance request failed.",

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
            "Photo Enhance returned an invalid response."
        });
    }


    /*
     * If CodeFormer already finished
     * and failed during wait=60,
     * return an error.
     *
     * The credit guard refunds it.
     */
    if (
      prediction.status ===
        "failed"
    ) {
      const details =
        safeDetail(
          prediction.error ||
          prediction.logs ||
          "CodeFormer failed."
        );


      console.error(
        "FACEVOL CODEFORMER MODEL ERROR:",
        details
      );


      return res
        .status(502)
        .json({
          error:
            "CodeFormer could not enhance this photo.",

          details
        });
    }


    /*
     * Handle provider cancellation.
     */
    if (
      prediction.status ===
        "canceled"
    ) {
      return res
        .status(502)
        .json({
          error:
            "Photo enhancement was canceled.",

          details:
            safeDetail(
              prediction.error
            )
        });
    }


    console.log(
      "FACEVOL CODEFORMER PHOTO ENHANCE:",
      {
        id:
          prediction.id,

        status:
          prediction.status,

        scale,

        fidelity:
          0.82,

        faceUpsample:
          true,

        backgroundEnhance:
          true
      }
    );


    /*
     * Security wrapper will:
     *
     * - register prediction ownership
     * - retain 2 credits if successful
     * - finalize immediately if succeeded
     * - otherwise let secure prediction.js
     *   finish the job later
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
      "FACEVOL CODEFORMER SERVER ERROR:",
      error
    );


    /*
     * Security wrapper automatically
     * refunds the reserved 2 credits.
     */
    return res
      .status(500)
      .json({
        error:
          "Could not start Photo Enhance.",

        details:
          error instanceof Error
            ? error.message
            : String(error)
      });
  }
}

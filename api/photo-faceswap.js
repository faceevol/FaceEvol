/*
 * FaceEvol Photo Face Swap
 * Save as: /api/photo-faceswap.js
 *
 * Source face  -> swap_image
 * Target photo -> input_image
 *
 * Secure version:
 * - Supabase authentication required
 * - Server-side credit reservation
 * - Photo Face Swap costs 2 credits
 * - Prediction ownership recorded
 * - Failed API starts automatically refund credits
 */

const MODEL_VERSION =
  "codeplugtech/face-swap:278a81e7ebb22db98bcba54de985d22cc1abeead2754eb1f2af717247be69b34";

const MULTI_FACE_MODEL_VERSION =
  "mertguvencli/face-swap-with-indexes:518f2116425c40acb5c234031c55daf843c1357eff784370fe9489e57b65c150";

const MAX_IMAGE_DATA_URI_CHARS =
  550_000;

const MAX_TOTAL_DATA_URI_CHARS =
  1_150_000;

const MULTI_MAX_IMAGE_DATA_URI_CHARS =
  1_100_000;

const MULTI_MAX_TOTAL_DATA_URI_CHARS =
  2_100_000;


/* ============================================================================
 * FaceEvol API security guard
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
   * Legacy service_role JWT key support.
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
   * cached FaceEvol frontend.
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
   * Idempotency protection.
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
   * Wrap existing API JSON responses.
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
         * Replicate accepted the job.
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
           * If ownership tracking failed,
           * restore the reserved credits.
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
           * Photo face swap uses Prefer: wait,
           * so it can sometimes finish before
           * this initial API request returns.
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
           * AI provider did not successfully
           * start a usable prediction.
           *
           * Refund the 2 reserved credits.
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
                    payload
                      ?.error ||
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
 * Existing Photo Face Swap helpers
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
      1000
    );
  }

  try {
    return JSON.stringify(
      value
    ).slice(
      0,
      1000
    );

  } catch {
    return String(
      value
    ).slice(
      0,
      1000
    );
  }
}



function normalizeFaceIndexes(value) {
  const candidate = String(value ?? "-1")
    .trim()
    .replace(/\s+/g, "");

  if (
    candidate === "-1" ||
    /^\d+(?:,\d+)*$/.test(candidate)
  ) {
    return candidate.slice(0, 120);
  }

  return "-1";
}



function faceEvolIndexList(value, maxItems = 4) {
  const raw = String(value ?? "")
    .split(",")
    .map(item => Number.parseInt(item.trim(), 10))
    .filter(item => Number.isInteger(item) && item >= 0 && item <= 100)
    .slice(0, maxItems);
  return raw;
}

function faceEvolFindOutputUrl(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const text = value.trim();
    return /^https?:\/\//i.test(text) ? text : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = faceEvolFindOutputUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const key of ["output", "url", "image", "file", "href", "result"]) {
      if (value[key] !== undefined) {
        const found = faceEvolFindOutputUrl(value[key]);
        if (found) return found;
      }
    }
  }
  return null;
}

async function faceEvolReadReplicateJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return { error: text.slice(0, 1200) }; }
}

async function faceEvolWaitReplicate(token, prediction, maxWaitMs = 65000) {
  let current = prediction;
  const started = Date.now();
  while (current && !["succeeded", "failed", "canceled", "cancelled"].includes(String(current.status || "").toLowerCase())) {
    if (!current.id || Date.now() - started > maxWaitMs) break;
    await new Promise(resolve => setTimeout(resolve, 900));
    const response = await fetch(
      `https://api.replicate.com/v1/predictions/${encodeURIComponent(current.id)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await faceEvolReadReplicateJson(response);
    if (!response.ok) throw new Error(data?.detail || data?.error || "Could not read multiple face-swap prediction");
    current = data;
  }
  return current;
}

async function handleMappedMultiPhotoSwap(res, token, sourceFaces, target, body) {
  const requestedTargets = faceEvolIndexList(body.target_indexes, 4);
  const count = Math.min(requestedTargets.length, sourceFaces.length, 4);

  if (!count) {
    return res.status(400).json({
      error: "Choose which target person each source face should replace."
    });
  }

  let destination = target;
  let lastPrediction = null;

  for (let index = 0; index < count; index += 1) {
    const response = await fetch(
      "https://api.replicate.com/v1/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "wait=60"
        },
        body: JSON.stringify({
          version: MULTI_FACE_MODEL_VERSION,
          input: {
            source_face_image: sourceFaces[index],
            destination_image: destination,
            source_face_index: 0,
            destination_face_index: requestedTargets[index],
            execution_type: "face_swap"
          }
        })
      }
    );

    let prediction = await faceEvolReadReplicateJson(response);
    if (!response.ok) {
      return res.status(response.status).json({
        error: `Multiple photo face swap failed while mapping source ${index + 1}.`,
        details: prediction
      });
    }

    prediction = await faceEvolWaitReplicate(token, prediction);
    if (String(prediction?.status || "").toLowerCase() !== "succeeded") {
      return res.status(502).json({
        error: `Multiple photo face swap could not finish mapping source ${index + 1}.`,
        details: prediction?.error || prediction?.status || "Unknown model error"
      });
    }

    const outputUrl = faceEvolFindOutputUrl(prediction?.output);
    if (!outputUrl) {
      return res.status(502).json({ error: "Multiple photo face swap returned no usable image." });
    }

    destination = outputUrl;
    lastPrediction = prediction;
  }

  return res.status(200).json({
    success: true,
    prediction: lastPrediction,
    mapped_faces: count
  });
}

/* ============================================================================
 * FaceEvol Photo Face Swap route
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
    !["", "single"].includes(
      mode
    )
  ) {
    return res.status(400).json({
      error:
        "Unsupported photo face swap mode"
    });
  }

  /*
   * Launch route: single Photo Face Swap only.
   * Retired multi-face requests are rejected above before credits are reserved.
   */
  const faceEvolGuard =
    await startFaceEvolGenerationGuard(
      req,
      res,
      "photo_faceswap"
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


  const { face, target } = body;
  const isMulti = mode === "multi";
  const multiFaces = isMulti
    ? (Array.isArray(body.faces) ? body.faces : [face]).filter(Boolean).slice(0, 4)
    : [];

  if (isMulti) {
    if (!multiFaces.length || multiFaces.some(value => !isImageDataUri(value))) {
      return res.status(400).json({ error: "Choose 1 to 4 valid source face images." });
    }
  } else if (!isImageDataUri(face)) {
    return res.status(400).json({ error: "A valid source face image is required." });
  }

  if (!isImageDataUri(target)) {
    return res.status(400).json({ error: "A valid target image is required." });
  }

  const sourceTotal = isMulti
    ? multiFaces.reduce((total, value) => total + value.length, 0)
    : face.length;
  const maxImageChars = isMulti ? MULTI_MAX_IMAGE_DATA_URI_CHARS : MAX_IMAGE_DATA_URI_CHARS;
  const maxTotalChars = isMulti ? 3_200_000 : MAX_TOTAL_DATA_URI_CHARS;

  if (target.length > maxImageChars ||
      (isMulti ? multiFaces.some(value => value.length > 650_000) : face.length > maxImageChars) ||
      sourceTotal + target.length > maxTotalChars) {
    return res.status(413).json({ error: "The prepared photos are too large for the photo face swap request. Please try again." });
  }

  if (isMulti) {
    try {
      return await handleMappedMultiPhotoSwap(
        res,
        token,
        multiFaces,
        target,
        body
      );
    } catch (error) {
      console.error("FaceEvol mapped multi-photo face swap server error:", error);
      return res.status(500).json({
        error: "Could not complete the mapped multiple photo face swap.",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const replicatePayload = {
    version: MODEL_VERSION,
    input: {
      swap_image: face,
      input_image: target
    }
  };


  try {
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

            /*
             * Wait when possible.
             *
             * If processing takes longer,
             * FaceEvol continues through
             * /api/prediction.
             */
            Prefer:
              "wait"
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
        "FaceEvol photo face swap Replicate request failed:",
        response.status,
        details
      );


      return res
        .status(
          response.status
        )
        .json({
          error:
            isMulti
              ? "Multiple photo face swap request failed."
              : "Photo face swap request failed.",

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
            isMulti
              ? "Multiple photo face swap returned an invalid response."
              : "Photo face swap returned an invalid response."
        });
    }


    return res
      .status(200)
      .json({
        success:
          true,

        prediction
      });


  } catch (error) {
    console.error(
      "FaceEvol photo face swap server error:",
      error
    );


    return res
      .status(500)
      .json({
        error:
          isMulti
            ? "Could not start the multiple photo face swap."
            : "Could not start the photo face swap.",

        details:
          error instanceof Error
            ? error.message
            : String(error)
      });
  }
}

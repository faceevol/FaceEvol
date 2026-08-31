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

const SEGMIND_VIDEO_FACE_SWAP_SLUG = "videofaceswap";

function faceEvolEncodeSegmindId(requestId) {
  const clean = String(requestId || "").trim().toLowerCase();
  if (!/^[0-9a-f-]{32,36}$/.test(clean)) {
    throw new Error("Segmind returned an invalid request ID");
  }
  return `sgm${clean.replace(/-/g, "")}`;
}

function faceEvolTargetIndexList(value, count) {
  const raw = Array.isArray(value) ? value : [];
  const indexes = raw.slice(0, count).map(Number);
  if (indexes.length !== count || indexes.some(v => !Number.isInteger(v) || v < 0 || v > 10)) {
    throw new Error("Choose a valid target person for every source identity.");
  }
  if (new Set(indexes).size !== indexes.length) {
    throw new Error("Each source identity must map to a different target person.");
  }
  return indexes;
}

/* ============================================================================
 * FaceEvol Video Face Swap API
 * ========================================================================== */

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body || {};
  const mode = String(body.mode || "").trim().toLowerCase();
  if (!["", "single"].includes(mode)) {
    return res.status(400).json({ error: "Unsupported video face swap mode" });
  }

  const faceEvolGuard = await startFaceEvolGenerationGuard(
    req,
    res,
    "video_faceswap"
  );
  if (!faceEvolGuard) return;

  const replicateToken = process.env.REPLICATE_API_TOKEN;
  const segmindToken = process.env.SEGMIND_API_KEY;
  if (!replicateToken) {
    return res.status(500).json({ error: "REPLICATE_API_TOKEN is not configured" });
  }

  const video = body.video;
  if (typeof video !== "string" || !video.startsWith("https://")) {
    return res.status(400).json({ error: "A valid video URL is required" });
  }

  const isMulti = mode === "multi";
  const faceUrls = isMulti
    ? [body.face].filter(Boolean)
    : [body.face];

  if (!faceUrls.length || faceUrls.some(value => typeof value !== "string" || !value.startsWith("https://"))) {
    return res.status(400).json({
      error: isMulti
        ? "A valid combined source-identity image is required."
        : "A valid face image URL is required"
    });
  }

  let facePathnames = [];
  let videoPathname = null;

  try {
    facePathnames = faceUrls.map(url => getBlobPathname(url, "faceevol-face-"));
    videoPathname = getBlobPathname(video, "faceevol-video-");

    const expires = String(Date.now() + 30 * 60 * 1000);
    const imageProxyUrls = facePathnames.map(pathname =>
      buildSignedProxyUrl("/api/image.jpg", pathname, expires, replicateToken)
    );
    const videoProxyUrl = buildSignedProxyUrl(
      "/api/video.mp4",
      videoPathname,
      expires,
      replicateToken
    );

    console.log(
      "Starting FaceEvol prediction",
      isMulti ? "multi_video_faceswap" : "video_faceswap",
      "identities:",
      imageProxyUrls.length
    );

    let response;
    if (isMulti) {
      const normalizedTargets = Array.isArray(body.target_indexes)
        ? body.target_indexes.map(Number)
        : String(body.target_indexes || "").split(",").filter(Boolean).map(Number);
      if (!normalizedTargets.length || normalizedTargets.length > 3) {
        throw new Error("Choose 1 to 3 mapped target people.");
      }
      const finalTargets = faceEvolTargetIndexList(normalizedTargets, normalizedTargets.length);
      const sourceIndexes = finalTargets.map((_, index) => index);
      response = await fetch(`https://api.segmind.com/v2/${SEGMIND_VIDEO_FACE_SWAP_SLUG}`, {
        method: "POST",
        headers: {
          "x-api-key": segmindToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          source_img: imageProxyUrls[0],
          video_input: videoProxyUrl,
          face_restore: true,
          input_faces_index: finalTargets.join(","),
          source_faces_index: sourceIndexes.join(","),
          face_restore_visibility: 1,
          codeformer_weight: 0.95,
          detect_gender_input: "no",
          detect_gender_source: "no",
          frame_load_cap: 0,
          base_64: false
        })
      });
    } else {
      response = await fetch("https://api.replicate.com/v1/predictions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${replicateToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          version: SINGLE_VIDEO_FACE_SWAP_VERSION,
          input: { source: videoProxyUrl, target: imageProxyUrls[0] }
        })
      });
    }

    let providerData;
    try { providerData = await response.json(); }
    catch { providerData = null; }

    if (!response.ok) {
      console.error(isMulti ? "Segmind multiple video face swap request failed:" : "Replicate face swap request failed:", providerData);
      await cleanupInputs([...facePathnames, videoPathname]);
      return res.status(response.status).json({
        error: providerData?.detail || providerData?.error || providerData?.message ||
          (isMulti ? "Multiple video face swap request failed" : "Replicate face swap request failed"),
        details: providerData
      });
    }

    let prediction;
    if (isMulti) {
      const requestId = providerData?.request_id || providerData?.id;
      if (!requestId) {
        await cleanupInputs([...facePathnames, videoPathname]);
        return res.status(502).json({ error: "Multiple video face swap service returned an invalid response." });
      }
      prediction = {
        id: faceEvolEncodeSegmindId(requestId),
        status: "processing",
        provider: "segmind",
        input: { source_img: imageProxyUrls[0], video_input: videoProxyUrl }
      };
    } else {
      prediction = providerData;
      if (!prediction?.id) {
        await cleanupInputs([...facePathnames, videoPathname]);
        return res.status(502).json({ error: "Face swap service returned an invalid response." });
      }
    }

    return res.status(200).json({ success: true, prediction });
  } catch (error) {
    console.error("Face swap server error:", error);
    await cleanupInputs([...facePathnames, videoPathname]);
    return res.status(500).json({
      error: "Server error",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

import {
  del
} from "@vercel/blob";


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

  const match = header.match(/^Bearer\s+(.+)$/i);

  return match
    ? match[1].trim()
    : "";
}


async function faceEvolReadResponse(response) {
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
   * Older Supabase service_role JWT keys
   * require an Authorization header.
   *
   * New sb_secret_ keys are server-side
   * secret API keys and work through apikey.
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
   * We intentionally require the server secret
   * before accepting authenticated AI requests.
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
          "Sign in is required to check FaceEvol AI results.",

        code:
          "AUTH_REQUIRED"
      });

    return null;
  }


  try {
    /*
     * Validate the Supabase access token directly
     * with Supabase Auth.
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
      "FaceEvol prediction authentication rejected:",
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


async function faceEvolOwnedGeneration(
  userId,
  predictionId
) {
  const user =
    encodeURIComponent(
      userId
    );

  const prediction =
    encodeURIComponent(
      predictionId
    );


  /*
   * A user may poll only predictions that were
   * registered against their own FaceEvol account.
   */
  const data =
    await faceEvolAdminRequest(
      `/rest/v1/generation_jobs?select=request_reference,tool,credits,status,prediction_id,provider_status&user_id=eq.${user}&prediction_id=eq.${prediction}&limit=1`,
      {
        method:
          "GET"
      }
    );


  return (
    Array.isArray(data) &&
    data.length
  )
    ? data[0]
    : null;
}


async function faceEvolFinalizePrediction(
  userId,
  predictionId,
  providerStatus
) {
  return faceEvolAdminRpc(
    "finalize_faceevol_prediction_admin",
    {
      p_user_id:
        userId,

      p_prediction_id:
        predictionId,

      p_provider_status:
        providerStatus
    }
  );
}


function extractTemporaryPathname(
  inputUrlString,
  expectedRoute,
  expectedPrefix
) {
  try {
    if (
      typeof inputUrlString !==
        "string" ||
      !inputUrlString.startsWith(
        "https://"
      )
    ) {
      return null;
    }


    const url =
      new URL(
        inputUrlString
      );


    /*
     * Existing FaceEvol proxy URL:
     *
     * https://www.faceevol.com/api/video.mp4?pathname=...
     */
    if (
      url.hostname ===
        "www.faceevol.com" &&
      url.pathname ===
        expectedRoute
    ) {
      const pathname =
        url.searchParams.get(
          "pathname"
        );


      if (
        pathname &&
        pathname.startsWith(
          expectedPrefix
        )
      ) {
        return pathname;
      }
    }


    /*
     * Video Enhance can use a signed
     * private Vercel Blob URL.
     *
     * Recover only a FaceEvol temporary
     * pathname so cleanup cannot delete
     * an arbitrary external object.
     */
    if (
      url.hostname.endsWith(
        ".private.blob.vercel-storage.com"
      )
    ) {
      const pathname =
        decodeURIComponent(
          url.pathname.replace(
            /^\/+/,
            ""
          )
        );


      if (
        pathname &&
        pathname.startsWith(
          expectedPrefix
        ) &&
        !pathname.includes(
          ".."
        )
      ) {
        return pathname;
      }
    }


    return null;

  } catch {
    return null;
  }
}


async function cleanupPredictionInputs(
  prediction
) {
  const facePathname =
    extractTemporaryPathname(
      prediction?.input?.target,
      "/api/image.jpg",
      "faceevol-face-"
    );


  const videoPathname =
    extractTemporaryPathname(
      prediction?.input?.source,
      "/api/video.mp4",
      "faceevol-video-"
    );


  /*
   * Video Enhance uses input.video
   * instead of input.source.
   */
  const enhancedVideoPathname =
    extractTemporaryPathname(
      prediction?.input?.video,
      "/api/video.mp4",
      "faceevol-video-"
    );


  const pathnames =
    [
      ...new Set(
        [
          facePathname,
          videoPathname,
          enhancedVideoPathname
        ].filter(Boolean)
      )
    ];


  if (
    !pathnames.length
  ) {
    console.warn(
      "No temporary FaceEvol inputs found for cleanup."
    );

    return;
  }


  try {
    /*
     * Vercel Blob del() accepts
     * multiple pathnames.
     */
    await del(
      pathnames
    );


    console.log(
      "Deleted temporary FaceEvol inputs:",
      pathnames
    );

  } catch (error) {
    /*
     * Cleanup failure must never hide
     * an otherwise valid AI result.
     */
    console.warn(
      "Temporary Blob cleanup failed:",
      error instanceof Error
        ? error.message
        : String(error)
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
      "GET"
  ) {
    res.setHeader(
      "Allow",
      "GET"
    );

    return res
      .status(405)
      .json({
        error:
          "Method not allowed"
      });
  }


  /*
   * STEP 1
   *
   * Require and validate the user's
   * Supabase access token.
   */
  const faceEvolAuth =
    await faceEvolRequireUser(
      req,
      res
    );


  if (
    !faceEvolAuth
  ) {
    return;
  }


  /*
   * STEP 2
   *
   * Replicate credentials remain entirely
   * server-side.
   */
  const replicateToken =
    process.env
      .REPLICATE_API_TOKEN;


  if (
    !replicateToken
  ) {
    return res
      .status(500)
      .json({
        error:
          "REPLICATE_API_TOKEN is not configured"
      });
  }


  const {
    id
  } =
    req.query || {};


  if (
    typeof id !==
      "string" ||
    !/^[a-zA-Z0-9]+$/.test(
      id
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          "A valid prediction ID is required"
      });
  }


  /*
   * STEP 3
   *
   * Verify this prediction belongs to
   * the authenticated FaceEvol user.
   *
   * This prevents one account from polling
   * another account's prediction simply
   * by knowing its Replicate prediction ID.
   */
  let ownedGeneration;


  try {
    ownedGeneration =
      await faceEvolOwnedGeneration(
        faceEvolAuth.user.id,
        id
      );

  } catch (error) {
    console.error(
      "FaceEvol generation ownership check failed:",
      error
    );


    return res
      .status(503)
      .json({
        error:
          "FaceEvol couldn't verify this generation right now. Please try again.",

        code:
          "GENERATION_ACCESS_CHECK_FAILED"
      });
  }


  if (
    !ownedGeneration
  ) {
    return res
      .status(403)
      .json({
        error:
          "This AI generation does not belong to your FaceEvol account.",

        code:
          "GENERATION_ACCESS_DENIED"
      });
  }


  /*
   * STEP 4
   *
   * Retrieve the real prediction state
   * directly from Replicate.
   */
  try {
    const response =
      await fetch(
        `https://api.replicate.com/v1/predictions/${id}`,
        {
          method:
            "GET",

          headers: {
            Authorization:
              `Bearer ${replicateToken}`,

            "Content-Type":
              "application/json"
          }
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
      return res
        .status(
          response.status
        )
        .json({
          error:
            "Failed to retrieve prediction",

          details:
            prediction
        });
    }


    if (
      !prediction
    ) {
      return res
        .status(502)
        .json({
          error:
            "Replicate returned an invalid prediction response"
        });
    }


    console.log(
      "FACEVOL PREDICTION STATUS:",
      prediction.status
    );


    console.log(
      "FACEVOL RAW OUTPUT:",
      JSON.stringify(
        prediction.output
      )
    );


    console.log(
      "FACEVOL PREDICTION ERROR:",
      prediction.error ||
      null
    );


    const finished =
      prediction.status ===
        "succeeded" ||
      prediction.status ===
        "failed" ||
      prediction.status ===
        "canceled";


    /*
     * Replicate is finished with its
     * source input at this point.
     *
     * Clean up temporary private uploads.
     */
    if (
      finished
    ) {
      await cleanupPredictionInputs(
        prediction
      );
    }


    /*
     * STEP 5
     *
     * Finalize the secure credit ledger.
     *
     * succeeded:
     *   charge remains.
     *
     * failed / canceled:
     *   Supabase automatically refunds
     *   the reserved credits once.
     *
     * processing:
     *   job remains in processing state.
     */
    let faceEvolCredit =
      null;


    try {
      faceEvolCredit =
        await faceEvolFinalizePrediction(
          faceEvolAuth.user.id,
          String(
            prediction.id ||
            id
          ),
          String(
            prediction.status ||
            ""
          )
        );

    } catch (creditError) {
      /*
       * Never hide a valid Replicate result
       * just because the ledger could not
       * be updated in this request.
       *
       * The error is logged for reconciliation.
       */
      console.error(
        "FaceEvol prediction credit finalization failed:",
        creditError
      );
    }


    /*
     * Return only the information the frontend
     * actually needs.
     */
    return res
      .status(200)
      .json({
        id:
          prediction.id,

        status:
          prediction.status,

        output:
          prediction.output ??
          null,

        error:
          prediction.error ??
          null,

        faceevol_credit:
          faceEvolCredit &&
          typeof faceEvolCredit ===
            "object"
            ? {
                ...faceEvolCredit,

                reserved:
                  faceEvolCredit
                    .refunded !==
                  true
              }
            : null
      });

  } catch (error) {
    console.error(
      "Prediction status error:",
      error
    );


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

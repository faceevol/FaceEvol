/* ============================================================================
 * FaceEvol API security guard
 *
 * COPY/PASTE helper. Do NOT deploy this as a separate API file.
 * Put this block near the top of each existing Replicate-backed generation
 * route, before `export default async function handler(...)`.
 *
 * Required Vercel environment variable:
 *   SUPABASE_SECRET_KEY = sb_secret_...   (recommended)
 * or legacy:
 *   SUPABASE_SERVICE_ROLE_KEY = eyJ...
 *
 * Never put either secret in index.html or GitHub source.
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

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function faceEvolRequestReference(req) {
  const raw = req.headers?.["x-faceevol-request-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const reference = String(value || "").trim();

  if (
    !reference ||
    reference.length > 160 ||
    !/^[a-zA-Z0-9._:-]+$/.test(reference)
  ) {
    return "";
  }

  return reference;
}

async function faceEvolReadResponse(response) {
  const text = await response.text();

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
  const response = await fetch(
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
   * Legacy service_role keys are JWTs and traditionally use both headers.
   * New sb_secret_ keys should be sent on apikey only.
   */
  if (
    !FACEVOL_SUPABASE_SECRET_KEY.startsWith("sb_secret_") &&
    FACEVOL_SUPABASE_SECRET_KEY.split(".").length === 3
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

  if (
    !accessToken
  ) {
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
   * Rollout compatibility for
   * an older cached page.
   */
  if (
    !requestReference
  ) {
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

  if (
    reservation?.already_processed ===
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
      reservation?.prediction_id
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

  const originalJson =
    res.json.bind(
      res
    );

  let settled =
    false;

  /*
   * Wrap the route's EXISTING JSON response
   * without changing its AI model.
   *
   * 2xx + prediction ID:
   *   bind provider job to user.
   *
   * API-level failure:
   *   restore the reserved credits.
   */
  res.json =
    function faceEvolProtectedJson(
      payload
    ) {
      if (
        settled
      ) {
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
            payload?.prediction?.id ||
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

        if (
          accepted
        ) {
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

            } catch (refundError) {
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

          creditExtra.prediction_id =
            predictionId;

          const providerStatus =
            String(
              payload?.prediction?.status ||
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

              creditExtra.refunded =
                finalized?.refunded ===
                true;

              creditExtra.reserved =
                finalized?.refunded !==
                true;

            } catch (finalizeError) {
              console.error(
                "FaceEvol immediate prediction finalization failed:",
                finalizeError
              );

              creditExtra.finalize_warning =
                true;
            }
          }

        } else {
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
                creditState?.refunded ===
                true
            };

          } catch (refundError) {
            console.error(
              "FaceEvol automatic API-error refund failed:",
              refundError
            );

            creditExtra.refund_warning =
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
 * FaceEvol consolidated portrait modes
 *
 * Reuses /api/predict.js so Portrait Creator and Profile Photo Pack do not
 * consume additional Vercel Function slots. The existing Age Transformation
 * branch below remains the default when no mode is supplied.
 * ========================================================================== */

const FACEVOL_PORTRAIT_MODEL =
  "qwen/qwen-image-edit-plus";

function faceEvolText(value, maxLength = 500) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function faceEvolChoice(value, allowed, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

async function handleFaceEvolPortraitMode(
  res,
  token,
  body,
  mode
) {
  const image = body?.image;

  if (
    !image ||
    typeof image !== "string" ||
    !image.startsWith("data:image/")
  ) {
    return res.status(400).json({
      error: "A valid portrait image is required"
    });
  }

  if (image.length > 11_000_000) {
    return res.status(413).json({
      error: "Image is too large. Please use an image under 8 MB."
    });
  }

  const portraitStyles = new Set([
    "professional",
    "cinematic",
    "editorial",
    "fashion",
    "dating",
    "anime",
    "fantasy"
  ]);

  const portraitBackgrounds = new Set([
    "studio",
    "office",
    "city",
    "nature",
    "dark",
    "keep"
  ]);

  const packStyles = new Set([
    "linkedin",
    "founder",
    "creative",
    "dating",
    "minimal"
  ]);

  const wardrobes = new Set([
    "smart",
    "formal",
    "minimal",
    "keep"
  ]);

  let finalPrompt = "";

  if (mode === "portrait") {
    const style = faceEvolChoice(
      body?.style,
      portraitStyles,
      "professional"
    );

    const background = faceEvolChoice(
      body?.background,
      portraitBackgrounds,
      "studio"
    );

    const direction = faceEvolText(
      body?.prompt,
      500
    );

    const styleDirections = {
      professional:
        "premium professional headshot, confident and approachable, refined but natural",
      cinematic:
        "cinematic portrait photography, dimensional light, tasteful contrast, realistic lens rendering",
      editorial:
        "high-end editorial magazine portrait, sophisticated styling, premium photographic finish",
      fashion:
        "polished fashion portrait, contemporary styling, elegant lighting, realistic skin and fabric texture",
      dating:
        "warm natural dating-profile portrait, friendly authentic expression, flattering but believable light",
      anime:
        "high-quality anime portrait interpretation while preserving recognizable facial identity and proportions",
      fantasy:
        "premium fantasy portrait styling while preserving recognizable identity, realistic facial anatomy and refined detail"
    };

    const backgroundDirections = {
      studio:
        "clean premium studio background",

      office:
        "modern softly blurred professional office background",

      city:
        "soft cinematic city background with natural depth of field",

      nature:
        "tasteful natural outdoor background with soft depth of field",

      dark:
        "dark charcoal editorial studio background",

      keep:
        "preserve the original background as closely as possible"
    };

    finalPrompt = `
Restyle this exact photograph into a ${styleDirections[style]}.
Use a ${backgroundDirections[background]}.

THIS MUST REMAIN THE SAME PERSON.
Identity is locked. Preserve the person's recognizable face shape, eyes, eye color, eyebrows, nose, mouth, lips, jawline, cheekbones, skin tone, ethnicity, facial proportions, age range and gender presentation.
Preserve realistic anatomy and natural asymmetry. Do not replace the person with a look-alike. Do not beautify into a different identity.

Keep natural skin texture, sharp eyes, realistic hair detail and photographic facial detail. Avoid plastic skin, excessive smoothing, warped features, duplicated features, text, logos and watermarks.

${direction ? `Additional user direction: ${direction}` : ""}

Produce one polished portrait. The result should look intentional, premium and professionally photographed while the person's identity remains obvious.
`.trim();

  } else {
    const packStyle = faceEvolChoice(
      body?.pack_style,
      packStyles,
      "linkedin"
    );

    const wardrobe = faceEvolChoice(
      body?.wardrobe,
      wardrobes,
      "smart"
    );

    const packDirections = {
      linkedin:
        "LinkedIn and business profile photography: clean, credible, polished and approachable",

      founder:
        "founder and executive profile photography: confident, premium, modern and authoritative without looking stiff",

      creative:
        "creative-professional profile photography: modern, expressive, tasteful and polished",

      dating:
        "dating-profile photography: warm, authentic, approachable and naturally flattering",

      minimal:
        "minimal studio profile photography: clean backgrounds, refined light and understated styling"
    };

    const wardrobeDirections = {
      smart:
        "smart-casual wardrobe",

      formal:
        "formal professional wardrobe",

      minimal:
        "minimal black wardrobe",

      keep:
        "the original wardrobe kept as closely as possible"
    };

    finalPrompt = `
Create a premium 2x2 professional profile-photo sheet using the SAME PERSON from the input image in all four panels.

Style direction: ${packDirections[packStyle]}.
Wardrobe direction: ${wardrobeDirections[wardrobe]}.

IDENTITY IS LOCKED IN ALL FOUR PANELS.
Preserve face shape, eyes, eye color, eyebrows, nose, mouth, lips, skin tone, ethnicity, jawline, cheekbones, age range, gender presentation and recognizable facial proportions.

Vary only the crop, subtle pose, lighting, professional background and styling appropriate to the selected pack. Keep every panel believable as a real photograph of the same person taken during one premium portrait session.

Natural skin texture. Sharp eyes. Realistic hair and fabric. No plastic skin. No duplicated facial features. No text. No logos. No watermarks. No four different people.

Output exactly one cohesive 2x2 profile-photo sheet containing four clean portrait panels.
`.trim();
  }

  try {
    const response = await fetch(
      `https://api.replicate.com/v1/models/${FACEVOL_PORTRAIT_MODEL}/predictions`,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${token}`,

          "Content-Type":
            "application/json",

          Prefer:
            "wait=60"
        },

        body:
          JSON.stringify({
            input: {
              image: [
                image
              ],

              prompt:
                finalPrompt,

              go_fast:
                false,

              aspect_ratio:
                "match_input_image",

              output_format:
                "png",

              output_quality:
                100
            }
          })
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
      console.error(
        `FaceEvol ${mode} Qwen request failed:`,
        prediction
      );

      return res
        .status(
          response.status
        )
        .json({
          error:
            mode === "portrait"
              ? "Portrait creation request failed"
              : "Profile photo pack request failed",

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
            "Replicate returned an invalid response"
        });
    }

    console.log(
      "FACEVOL PORTRAIT MODEL:",
      FACEVOL_PORTRAIT_MODEL,
      "MODE:",
      mode
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
      `FaceEvol ${mode} server error:`,
      error
    );

    return res
      .status(500)
      .json({
        error:
          mode === "portrait"
            ? "Could not create the portrait"
            : "Could not create the profile photo pack",

        details:
          error instanceof Error
            ? error.message
            : String(error)
      });
  }
}


export default async function handler(
  req,
  res
) {
  if (
    req.method !==
      "POST"
  ) {
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
    ![
      "",
      "age",
      "portrait",
      "profile_pack"
    ].includes(mode)
  ) {
    return res
      .status(400)
      .json({
        error:
          "Unsupported FaceEvol predict mode"
      });
  }

  const creditTool =
    mode === "portrait"
      ? "portrait_creator"
      : mode === "profile_pack"
        ? "profile_photo_pack"
        : "age";

  /*
   * One secure endpoint, three tools.
   * Supabase remains authoritative for
   * the cost attached to each tool key.
   */
  const faceEvolGuard =
    await startFaceEvolGenerationGuard(
      req,
      res,
      creditTool
    );

  if (
    !faceEvolGuard
  ) {
    return;
  }

  const token =
    process.env
      .REPLICATE_API_TOKEN;

  if (
    !token
  ) {
    return res
      .status(500)
      .json({
        error:
          "REPLICATE_API_TOKEN is not configured"
      });
  }

  /*
   * ------------------------------------------------------------
   * NEW MODES
   * ------------------------------------------------------------
   *
   * mode: "portrait"
   *   -> AI Portrait Creator
   *
   * mode: "profile_pack"
   *   -> AI Profile Photo Pack
   *
   * No mode / mode: "age"
   *   -> original Age Transformation
   * ------------------------------------------------------------
   */

  if (
    mode === "portrait" ||
    mode === "profile_pack"
  ) {
    return handleFaceEvolPortraitMode(
      res,
      token,
      body,
      mode
    );
  }

  /*
   * ============================================================
   * EXISTING FACEVOL AGE TRANSFORMATION
   * ============================================================
   */

  const {
    image,
    target_age
  } =
    body;

  const age =
    Number(
      target_age
    );

  /*
   * Validate image
   */
  if (
    !image ||
    typeof image !==
      "string" ||
    !image.startsWith(
      "data:image/"
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          "A valid image is required"
      });
  }

  /*
   * Validate age
   */
  if (
    !Number.isFinite(
      age
    ) ||
    age < 0 ||
    age > 100
  ) {
    return res
      .status(400)
      .json({
        error:
          "Target age must be between 0 and 100"
      });
  }

  /*
   * Protect the server from
   * unnecessarily large requests.
   */
  if (
    image.length >
      11_000_000
  ) {
    return res
      .status(413)
      .json({
        error:
          "Image is too large. Please use an image under 8 MB."
      });
  }

  /*
   * IMPORTANT:
   *
   * Qwen is being instructed to perform
   * a SURGICAL AGE EDIT, not recreate
   * the portrait.
   */
  const prompt =
    `
Perform a minimal, photorealistic AGE EDIT on the person
in this exact photograph.

Target apparent age: approximately ${age} years old.

THIS IS THE SAME PERSON BEFORE AND AFTER.

The person's identity is LOCKED.

ABSOLUTELY PRESERVE:
- biological sex and gender presentation
- facial identity
- ethnicity
- skin tone
- eye shape
- eye color
- eyebrow shape
- nose shape
- nostril shape
- mouth shape
- lip shape
- jawline identity
- cheekbone identity
- facial proportions
- recognizable bone structure
- hairstyle
- hairline except for subtle natural age-related changes
- expression
- gaze direction
- head orientation
- pose
- clothing
- body
- camera position
- crop
- background
- lighting

DO NOT turn a male into a female.
DO NOT turn a female into a male.
DO NOT feminize a male face.
DO NOT masculinize a female face.

DO NOT replace the person with another person.
DO NOT redesign the face.
DO NOT beautify the face.
DO NOT change facial attractiveness.
DO NOT change ethnicity.
DO NOT change hairstyle unless a tiny age-related adjustment
is genuinely necessary.

Only modify visible characteristics that naturally communicate
the requested age.

`;

  /*
   * More precise instructions depending
   * on the requested age.
   */
  let ageInstruction =
    "";

  if (
    age <= 10
  ) {
    ageInstruction =
      `
Create a believable child version of this SAME person.

Use natural child facial development:
slightly softer skin,
age-appropriate facial proportions,
and realistic youthful features.

Do not make the child doll-like.
Do not enlarge the eyes unnaturally.
Do not create a completely new childhood face.
`;

  } else if (
    age <= 17
  ) {
    ageInstruction =
      `
Create a believable teenage version of this SAME person.

Use subtle youthful facial development,
healthy natural skin,
and age-appropriate proportions.

Do not create a different teenager.
The original person's identity must remain obvious.
`;

  } else if (
    age <= 35
  ) {
    ageInstruction =
      `
Create a realistic version of this SAME person
at approximately ${age} years old.

Make only very subtle age-related adjustments.

Do not unnecessarily alter any facial features.
`;

  } else if (
    age <= 55
  ) {
    ageInstruction =
      `
Create a natural middle-aged version of this SAME person.

Use restrained realistic age changes:
subtle skin texture,
very mild expression lines,
and natural facial maturity.

Do not exaggerate wrinkles.
Do not dramatically change facial shape.
`;

  } else {
    ageInstruction =
      `
Create a healthy, realistic older version of this SAME person.

Add restrained natural aging:
realistic fine lines,
subtle skin texture,
mild age-related facial maturity,
and age-appropriate hair changes.

The person should look healthy,
normal,
recognizable,
and approachable.

Avoid:
extreme wrinkles,
extreme sagging,
sunken cheeks,
dark eye sockets,
skeletal features,
diseased-looking skin,
unnatural discoloration,
or frightening aging effects.
`;
  }

  const finalPrompt =
    `${prompt}

${ageInstruction}

CRITICAL OUTPUT REQUIREMENTS:

Treat the original photograph as the base image.

EDIT it.
DO NOT regenerate it from scratch.

Change ONLY age-related facial details.

Everything unrelated to age should remain
as close as possible to the original pixels.

The final result must look like a real photograph
of the SAME PERSON at age ${age}.

Natural skin texture.
Sharp eyes.
Sharp facial details.
No blur.
No artificial smoothness.
No plastic skin.
No AI-looking face.
No facial distortion.
No gender change.
No identity change.
`;

  try {
    /*
     * Qwen Image Edit 2511
     *
     * Current Replicate official image-edit model
     * with improved identity consistency.
     */
    const response =
      await fetch(
        "https://api.replicate.com/v1/models/qwen/qwen-image-edit-2511/predictions",
        {
          method:
            "POST",

          headers: {
            Authorization:
              `Bearer ${token}`,

            "Content-Type":
              "application/json",

            /*
             * Qwen is usually fast.
             * Wait up to 60 seconds before
             * falling back to the existing
             * prediction polling flow.
             */
            Prefer:
              "wait=60"
          },

          body:
            JSON.stringify({
              input: {
                /*
                 * Qwen 2511 accepts an array
                 * of reference images.
                 */
                image: [
                  image
                ],

                prompt:
                  finalPrompt,

                /*
                 * Disable speed optimization.
                 * For FaceEvol we care more
                 * about quality and consistency.
                 */
                go_fast:
                  false,

                aspect_ratio:
                  "match_input_image",

                /*
                 * PNG avoids lossy compression
                 * artifacts around facial details.
                 */
                output_format:
                  "png",

                output_quality:
                  100
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
      console.error(
        "AGE QWEN ERROR:",
        prediction
      );

      return res
        .status(
          response.status
        )
        .json({
          error:
            "Age transformation request failed",

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
            "Replicate returned an invalid response"
        });
    }

    console.log(
      "FACEVOL AGE MODEL:",
      "qwen/qwen-image-edit-2511"
    );

    console.log(
      "FACEVOL TARGET AGE:",
      age
    );

    console.log(
      "FACEVOL AGE STATUS:",
      prediction.status
    );

    console.log(
      "FACEVOL AGE OUTPUT:",
      JSON.stringify(
        prediction.output
      )
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
      "AGE TRANSFORMATION ERROR:",
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const token =
    process.env.REPLICATE_API_TOKEN;

  if (!token) {
    return res.status(500).json({
      error:
        "REPLICATE_API_TOKEN is not configured"
    });
  }

  const {
    image,
    target_age
  } = req.body || {};

  const age =
    Number(target_age);

  /*
   * Validate image
   */
  if (
    !image ||
    typeof image !== "string" ||
    !image.startsWith("data:image/")
  ) {
    return res.status(400).json({
      error:
        "A valid image is required"
    });
  }

  /*
   * Validate target age
   */
  if (
    !Number.isFinite(age) ||
    age < 0 ||
    age > 100
  ) {
    return res.status(400).json({
      error:
        "Target age must be between 0 and 100"
    });
  }

  /*
   * Keep upload protection from
   * the previous implementation.
   */
  if (image.length > 11_000_000) {
    return res.status(413).json({
      error:
        "Image is too large. Please use an image under 8 MB."
    });
  }

  /*
   * Age-specific instructions.
   *
   * The goal is natural aging rather
   * than exaggerated AI aging.
   */
  let ageDescription = "";

  if (age <= 8) {
    ageDescription = `
Create a believable childhood version of this same person
at approximately ${age} years old.

Use natural child facial proportions and smooth healthy skin.
Do not make the face doll-like, cartoonish, distorted,
unnaturally round, or artificial.
`;
  } else if (age <= 17) {
    ageDescription = `
Make this same person look approximately ${age} years old.

Create a believable teenage version of the person.
Use natural youthful facial proportions and healthy skin.
Avoid exaggerated baby-face effects.
`;
  } else if (age <= 35) {
    ageDescription = `
Make this same person look approximately ${age} years old.

Keep the appearance realistic and natural.
Use healthy adult skin and age-appropriate facial details.
Do not unnecessarily change the person's appearance.
`;
  } else if (age <= 55) {
    ageDescription = `
Make this same person look approximately ${age} years old.

Apply subtle and realistic middle-age changes only.
Use natural skin texture and very restrained age lines.
Do not exaggerate wrinkles, sagging, discoloration,
or facial structure changes.
`;
  } else {
    ageDescription = `
Make this same person look approximately ${age} years old.

Create healthy, natural and realistic aging.
Add only believable age-related details such as subtle
skin texture, age lines and modest maturity of facial features.

The person should look healthy and approachable.
Do not create excessive wrinkles, extreme sagging,
sun damage, sickness, skeletal features,
dark eye sockets, frightening features,
or exaggerated old-age effects.
`;
  }

  const prompt = `
Edit the provided portrait so the person appears
approximately ${age} years old.

${ageDescription}

CRITICAL IDENTITY REQUIREMENTS:

Keep this unmistakably the SAME PERSON.

Preserve the person's:
- core facial identity
- eye shape and eye color
- nose identity
- mouth and lip shape
- jaw and recognizable bone structure
- ethnicity and natural skin tone
- hairstyle and hair direction where age appropriate
- expression
- head position
- pose
- camera angle
- framing
- lighting
- clothing
- background

Only make the minimum facial and hair changes
necessary to represent the requested age.

The result must look like a genuine high-quality photograph,
not an AI-generated portrait.

Maintain realistic skin pores and fine facial detail.
Keep both eyes sharp and symmetrical.
Keep facial anatomy natural.

Do not blur or soften the face.
Do not over-smooth the skin.
Do not beautify or redesign the person.
Do not change gender presentation.
Do not change facial identity.
Do not change the background.
Do not add objects.
Do not add makeup unless it already exists.
Do not create plastic-looking skin.
Do not create distorted teeth.
Do not create warped ears.
Do not create asymmetrical eyes.
Do not create uncanny or frightening features.

The final image should be sharp,
photorealistic, natural,
healthy-looking and identity-preserving.
`;

  try {
    /*
     * FLUX.1 Kontext Pro
     *
     * Official Replicate model.
     * Using the official-model endpoint means
     * we don't need to hard-code a version hash.
     */
    const response =
      await fetch(
        "https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${token}`,

            "Content-Type":
              "application/json",

            /*
             * Wait briefly for fast predictions.
             * If it takes longer, Replicate returns
             * the prediction ID and your existing
             * polling flow can continue.
             */
            Prefer: "wait=60"
          },

          body: JSON.stringify({
            input: {
              prompt,

              input_image:
                image,

              aspect_ratio:
                "match_input_image",

              output_format:
                "png",

              safety_tolerance:
                2,

              /*
               * Keep this disabled so the model
               * doesn't creatively rewrite our
               * carefully controlled age prompt.
               */
              prompt_upsampling:
                false
            }
          })
        }
      );

    let prediction;

    try {
      prediction =
        await response.json();
    } catch {
      prediction = null;
    }

    if (!response.ok) {
      console.error(
        "Age transformation Replicate error:",
        prediction
      );

      return res
        .status(response.status)
        .json({
          error:
            "Age transformation request failed",

          details:
            prediction
        });
    }

    if (!prediction) {
      return res.status(502).json({
        error:
          "Replicate returned an invalid response"
      });
    }

    console.log(
      "AGE MODEL:",
      "black-forest-labs/flux-kontext-pro"
    );

    console.log(
      "AGE TARGET:",
      age
    );

    console.log(
      "AGE PREDICTION ID:",
      prediction.id
    );

    console.log(
      "AGE PREDICTION STATUS:",
      prediction.status
    );

    return res.status(200).json({
      success: true,
      prediction
    });

  } catch (error) {
    console.error(
      "Age transformation server error:",
      error
    );

    return res.status(500).json({
      error:
        "Server error",

      details:
        error instanceof Error
          ? error.message
          : String(error)
    });
  }
}

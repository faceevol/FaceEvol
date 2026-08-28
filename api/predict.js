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
   * Validate age
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
   * Protect the server from
   * unnecessarily large requests.
   */
  if (image.length > 11_000_000) {
    return res.status(413).json({
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
  const prompt = `
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
  let ageInstruction = "";

  if (age <= 10) {
    ageInstruction = `
Create a believable child version of this SAME person.

Use natural child facial development:
slightly softer skin,
age-appropriate facial proportions,
and realistic youthful features.

Do not make the child doll-like.
Do not enlarge the eyes unnaturally.
Do not create a completely new childhood face.
`;
  } else if (age <= 17) {
    ageInstruction = `
Create a believable teenage version of this SAME person.

Use subtle youthful facial development,
healthy natural skin,
and age-appropriate proportions.

Do not create a different teenager.
The original person's identity must remain obvious.
`;
  } else if (age <= 35) {
    ageInstruction = `
Create a realistic version of this SAME person
at approximately ${age} years old.

Make only very subtle age-related adjustments.

Do not unnecessarily alter any facial features.
`;
  } else if (age <= 55) {
    ageInstruction = `
Create a natural middle-aged version of this SAME person.

Use restrained realistic age changes:
subtle skin texture,
very mild expression lines,
and natural facial maturity.

Do not exaggerate wrinkles.
Do not dramatically change facial shape.
`;
  } else {
    ageInstruction = `
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
          method: "POST",

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

          body: JSON.stringify({
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
        await response.json();
    } catch {
      prediction = null;
    }

    if (!response.ok) {
      console.error(
        "AGE QWEN ERROR:",
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

    return res.status(200).json({
      success: true,
      prediction
    });

  } catch (error) {
    console.error(
      "AGE TRANSFORMATION ERROR:",
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

import { handleUpload } from "@vercel/blob/client";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,

      onBeforeGenerateToken: async (pathname) => {
        if (
          typeof pathname !== "string"
        ) {
          throw new Error(
            "Invalid upload pathname"
          );
        }

        /*
         * Optimized temporary face photo
         */
        if (
          pathname.startsWith(
            "faceevol-face-"
          )
        ) {
          return {
            allowedContentTypes: [
              "image/jpeg"
            ],

            maximumSizeInBytes:
              8 * 1024 * 1024,

            addRandomSuffix: true
          };
        }

        /*
         * Temporary source video
         */
        if (
          pathname.startsWith(
            "faceevol-video-"
          )
        ) {
          return {
            allowedContentTypes: [
              "video/mp4",
              "video/quicktime",
              "video/webm"
            ],

            maximumSizeInBytes:
              200 * 1024 * 1024,

            addRandomSuffix: true
          };
        }

        throw new Error(
          "Invalid FaceEvol upload type"
        );
      },

      onUploadCompleted:
        async ({ blob }) => {
          console.log(
            "FaceEvol temporary upload completed:",
            blob.pathname
          );
        }
    });

    return res
      .status(200)
      .json(jsonResponse);

  } catch (error) {
    console.error(
      "Blob upload error:",
      error
    );

    return res.status(500).json({
      error:
        "Could not prepare upload",

      details:
        error instanceof Error
          ? error.message
          : String(error)
    });
  }
}

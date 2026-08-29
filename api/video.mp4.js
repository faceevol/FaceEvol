import { get, head } from "@vercel/blob";
import { Readable } from "node:stream";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    let pathname = req.query.pathname;

    if (Array.isArray(pathname)) {
      pathname = pathname[0];
    }

    if (
      typeof pathname !== "string" ||
      !pathname.trim()
    ) {
      return res.status(400).json({
        error: "Missing pathname"
      });
    }

    pathname = pathname.trim();

    /*
     * Allow FaceEvol temporary video files.
     *
     * Important:
     * Do NOT use the old strict filename regex here.
     * Enhancement clips can now have names such as:
     *
     * faceevol-video-123-abc-faceevol-enhance-selected-456.mp4
     */
    if (
      !pathname.startsWith("faceevol-video-") ||
      !pathname.toLowerCase().endsWith(".mp4")
    ) {
      return res.status(400).json({
        error: "Invalid video pathname"
      });
    }

    /*
     * Block obvious path-manipulation attempts.
     */
    if (
      pathname.includes("..") ||
      pathname.includes("\\")
    ) {
      return res.status(400).json({
        error: "Invalid video pathname"
      });
    }

    /*
     * HEAD support is useful because external AI services
     * may inspect the file before downloading it.
     */
    if (req.method === "HEAD") {
      const metadata = await head(pathname);

      res.setHeader(
        "Content-Type",
        metadata.contentType || "video/mp4"
      );

      if (metadata.size) {
        res.setHeader(
          "Content-Length",
          String(metadata.size)
        );
      }

      res.setHeader(
        "Cache-Control",
        "private, no-store"
      );

      res.setHeader(
        "X-Content-Type-Options",
        "nosniff"
      );

      return res.status(200).end();
    }

    /*
     * Read the private Vercel Blob.
     */
    const result = await get(pathname, {
      access: "private",
      useCache: false
    });

    if (
      !result ||
      result.statusCode !== 200 ||
      !result.stream
    ) {
      return res.status(404).json({
        error: "Video not found"
      });
    }

    res.statusCode = 200;

    res.setHeader(
      "Content-Type",
      result.blob?.contentType || "video/mp4"
    );

    if (result.blob?.size) {
      res.setHeader(
        "Content-Length",
        String(result.blob.size)
      );
    }

    res.setHeader(
      "Content-Disposition",
      "inline"
    );

    res.setHeader(
      "Cache-Control",
      "private, no-store"
    );

    res.setHeader(
      "X-Content-Type-Options",
      "nosniff"
    );

    /*
     * Let Replicate / ByteDance download the private video
     * through this FaceEvol endpoint.
     */
    const nodeStream =
      Readable.fromWeb(result.stream);

    nodeStream.on("error", (error) => {
      console.error(
        "VIDEO STREAM ERROR:",
        error
      );

      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.destroy(error);
      }
    });

    nodeStream.pipe(res);
  } catch (error) {
    console.error(
      "VIDEO.MP4 ERROR:",
      error
    );

    return res.status(500).json({
      error: "Unable to load video",
      details:
        error instanceof Error
          ? error.message
          : String(error)
    });
  }
}

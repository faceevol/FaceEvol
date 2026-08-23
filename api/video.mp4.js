import { get } from "@vercel/blob";
import { Readable } from "node:stream";
import {
  createHmac,
  timingSafeEqual
} from "node:crypto";

function createSignature(pathname, expires, secret) {
  return createHmac("sha256", secret)
    .update(`${pathname}:${expires}`)
    .digest("hex");
}

function signaturesMatch(received, expected) {
  if (
    typeof received !== "string" ||
    received.length !== expected.length
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(received, "utf8"),
    Buffer.from(expected, "utf8")
  );
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const secret = process.env.REPLICATE_API_TOKEN;

    if (!secret) {
      return response
        .status(500)
        .send("Server configuration error");
    }

    const {
      pathname,
      expires,
      signature
    } = request.query || {};

    if (
      typeof pathname !== "string" ||
      typeof expires !== "string" ||
      typeof signature !== "string"
    ) {
      return response
        .status(400)
        .send("Missing authorization");
    }

    const expiresNumber = Number(expires);

    if (
      !Number.isFinite(expiresNumber) ||
      Date.now() > expiresNumber
    ) {
      return response
        .status(403)
        .send("Link expired");
    }

    const expectedSignature =
      createSignature(
        pathname,
        expires,
        secret
      );

    if (
      !signaturesMatch(
        signature,
        expectedSignature
      )
    ) {
      return response
        .status(403)
        .send("Unauthorized");
    }

    const result = await get(pathname, {
      access: "private"
    });

    if (
      !result ||
      result.statusCode !== 200
    ) {
      return response
        .status(404)
        .send("Video not found");
    }

    response.setHeader(
      "Content-Type",
      result.blob.contentType || "video/mp4"
    );

    response.setHeader(
      "Content-Disposition",
      'inline; filename="faceevol-video.mp4"'
    );

    response.setHeader(
      "Cache-Control",
      "private, no-store"
    );

    response.setHeader(
      "X-Content-Type-Options",
      "nosniff"
    );

    if (result.blob.size) {
      response.setHeader(
        "Content-Length",
        String(result.blob.size)
      );
    }

    Readable
      .fromWeb(result.stream)
      .pipe(response);

  } catch (error) {
    console.error(
      "Private MP4 stream error:",
      error
    );

    if (!response.headersSent) {
      return response
        .status(500)
        .send("Video unavailable");
    }

    response.end();
  }
}

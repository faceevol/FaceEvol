import {
  del
} from "@vercel/blob";

import { createHmac, timingSafeEqual } from "node:crypto";

export const config = { api: { bodyParser: false } };


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

const FASTSPRING_API_USERNAME =
  String(process.env.FASTSPRING_API_USERNAME || "").trim();

const FASTSPRING_API_PASSWORD =
  String(process.env.FASTSPRING_API_PASSWORD || "").trim();

const FASTSPRING_WEBHOOK_SECRET =
  String(process.env.FASTSPRING_WEBHOOK_SECRET || "");

const FASTSPRING_MODE =
  String(process.env.FASTSPRING_MODE || "test").trim().toLowerCase() === "live"
    ? "live"
    : "test";

const FASTSPRING_STOREFRONT =
  String(process.env.FASTSPRING_STOREFRONT || "faceevol")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "") || "faceevol";

const FACEVOL_FASTSPRING_PACKS = Object.freeze({
  "20":  { credits:20,  product:"faceevol-starter-20" },
  "60":  { credits:60,  product:"faceevol-creator-60" },
  "150": { credits:150, product:"faceevol-studio-150" }
});

function faceEvolBearerToken(req) {
  const header = String(
    req.headers?.authorization ||
    req.headers?.Authorization ||
    ""
  ).trim();

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}


async function faceEvolReadResponse(response) {
  const text = await response.text();
  if (!text) return null;

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
        apikey: FACEVOL_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  const data = await faceEvolReadResponse(response);

  if (!response.ok) {
    const message =
      (data && typeof data === "object" &&
        (data.message || data.error_description || data.error || data.details)) ||
      (typeof data === "string" ? data : "") ||
      `Supabase HTTP ${response.status}`;

    const error = new Error(String(message));
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}


function faceEvolAdminHeaders(extra = {}) {
  if (!FACEVOL_SUPABASE_SECRET_KEY) {
    throw new Error("SUPABASE_SECRET_KEY is not configured");
  }

  const headers = {
    apikey: FACEVOL_SUPABASE_SECRET_KEY,
    "Content-Type": "application/json",
    ...extra
  };

  if (
    !FACEVOL_SUPABASE_SECRET_KEY.startsWith("sb_secret_") &&
    FACEVOL_SUPABASE_SECRET_KEY.split(".").length === 3
  ) {
    headers.Authorization = `Bearer ${FACEVOL_SUPABASE_SECRET_KEY}`;
  }

  return headers;
}


async function faceEvolAdminRequest(
  pathname,
  options = {}
) {
  const response = await fetch(
    `${FACEVOL_SUPABASE_URL}${pathname}`,
    {
      ...options,
      headers: faceEvolAdminHeaders(options.headers || {})
    }
  );

  const data = await faceEvolReadResponse(response);

  if (!response.ok) {
    const message =
      (data && typeof data === "object" &&
        (data.message || data.error_description || data.error || data.details)) ||
      (typeof data === "string" ? data : "") ||
      `Supabase admin HTTP ${response.status}`;

    const error = new Error(String(message));
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}


async function faceEvolAdminRpc(functionName, payload) {
  return faceEvolAdminRequest(
    `/rest/v1/rpc/${encodeURIComponent(functionName)}`,
    {
      method: "POST",
      body: JSON.stringify(payload || {})
    }
  );
}


async function faceEvolRequireUser(req, res) {
  if (!FACEVOL_SUPABASE_SECRET_KEY) {
    res.status(500).json({
      error: "FaceEvol server security is not configured.",
      code: "SERVER_SECURITY_NOT_CONFIGURED"
    });
    return null;
  }

  const accessToken = faceEvolBearerToken(req);

  if (!accessToken) {
    res.status(401).json({
      error: "Sign in is required to check FaceEvol AI results.",
      code: "AUTH_REQUIRED"
    });
    return null;
  }

  try {
    const user = await faceEvolUserRequest(
      accessToken,
      "/auth/v1/user",
      { method: "GET" }
    );

    if (!user || !user.id) {
      res.status(401).json({
        error: "Your FaceEvol session is no longer valid. Please sign in again.",
        code: "AUTH_REQUIRED"
      });
      return null;
    }

    return { accessToken, user };
  } catch (error) {
    console.warn(
      "FaceEvol prediction authentication rejected:",
      error instanceof Error ? error.message : String(error)
    );

    res.status(401).json({
      error: "Your FaceEvol session is no longer valid. Please sign in again.",
      code: "AUTH_REQUIRED"
    });
    return null;
  }
}


async function faceEvolOwnedGeneration(
  userId,
  predictionId
) {
  const user = encodeURIComponent(userId);
  const prediction = encodeURIComponent(predictionId);

  const data = await faceEvolAdminRequest(
    `/rest/v1/generation_jobs?select=request_reference,tool,credits,status,prediction_id,provider_status&user_id=eq.${user}&prediction_id=eq.${prediction}&limit=1`,
    { method: "GET" }
  );

  return Array.isArray(data) && data.length
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
      p_user_id: userId,
      p_prediction_id: predictionId,
      p_provider_status: providerStatus
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
     * Video Enhance signed Vercel Blob URL.
     * Recover only a FaceEvol temporary pathname so cleanup
     * cannot delete an arbitrary external object.
     */
    if (
      url.hostname.endsWith(
        ".private.blob.vercel-storage.com"
      )
    ) {
      const pathname =
        decodeURIComponent(
          url.pathname.replace(
            /^\/+/, ""
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
  /*
   * Different FaceEvol providers use different names/orientations:
   * - current single video swap: source=video, target=face
   * - DeepFace multi-video: source=face, target=video
   * - video enhancement: video=video
   *
   * Check both source and target for each trusted FaceEvol prefix. The
   * extractor still requires the exact FaceEvol proxy route or private
   * Vercel Blob hostname + expected prefix, so this does not broaden
   * deletion to arbitrary URLs.
   */
  const candidateInputs = [
    prediction?.input?.source,
    prediction?.input?.target,
    prediction?.input?.source_image,
    prediction?.input?.target_video,
    prediction?.input?.video
  ];

  const facePathname =
    candidateInputs
      .map(value =>
        extractTemporaryPathname(
          value,
          "/api/image.jpg",
          "faceevol-face-"
        )
      )
      .find(Boolean) ||
    null;

  const videoPathname =
    candidateInputs
      .map(value =>
        extractTemporaryPathname(
          value,
          "/api/video.mp4",
          "faceevol-video-"
        )
      )
      .find(Boolean) ||
    null;

  const pathnames =
    [
      ...new Set([
        facePathname,
        videoPathname
      ].filter(Boolean))
    ];

  if (!pathnames.length) {
    console.warn(
      "No temporary FaceEvol inputs found for cleanup."
    );

    return;
  }

  try {
    await del(
      pathnames
    );

    console.log(
      "Deleted temporary FaceEvol inputs:",
      pathnames
    );

  } catch (error) {
    /*
     * Cleanup failure must never hide a successful AI result.
     */
    console.warn(
      "Temporary Blob cleanup failed:",
      error instanceof Error
        ? error.message
        : String(error)
    );
  }
}



async function faceEvolReadRawBody(req,maxBytes=1000000){
  const chunks=[]; let total=0;
  for await (const chunk of req){
    const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    total+=b.length; if(total>maxBytes) throw new Error("REQUEST_BODY_TOO_LARGE");
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

function faceEvolSafeJson(raw){
  try{return JSON.parse(raw.toString("utf8"));}catch{return null;}
}

function faceEvolEnforceFastSpringTester(user){
  if(FASTSPRING_MODE==="live") return;

  const allowedEmail=String(process.env.FASTSPRING_TEST_EMAIL||"").trim().toLowerCase();
  const allowedUserId=String(process.env.FASTSPRING_TEST_USER_ID||"").trim();

  if(!allowedEmail&&!allowedUserId){
    throw new Error("FASTSPRING_TEST_ACCESS_NOT_CONFIGURED");
  }

  const emailMatches=
    allowedEmail &&
    String(user?.email||"").trim().toLowerCase()===allowedEmail;

  const userMatches=
    allowedUserId &&
    String(user?.id||"")===allowedUserId;

  if(!emailMatches&&!userMatches){
    throw new Error("FASTSPRING_TEST_ACCESS_DENIED");
  }
}

function faceEvolFastSpringAuth(){
  if(!FASTSPRING_API_USERNAME||!FASTSPRING_API_PASSWORD){
    throw new Error("FastSpring API credentials are not configured");
  }

  return `Basic ${Buffer.from(
    `${FASTSPRING_API_USERNAME}:${FASTSPRING_API_PASSWORD}`,
    "utf8"
  ).toString("base64")}`;
}

async function faceEvolFastSpringRequest(pathname,body){
  const response=await fetch(`https://api.fastspring.com${pathname}`,{
    method:"POST",
    headers:{
      Authorization:faceEvolFastSpringAuth(),
      "Content-Type":"application/json",
      Accept:"application/json"
    },
    body:JSON.stringify(body)
  });

  const text=await response.text();
  let data=null;

  try{ data=text?JSON.parse(text):null; }
  catch{ data={raw:text.slice(0,1200)}; }

  if(!response.ok){
    const error=new Error(
      data?.message ||
      data?.error?.message ||
      data?.error ||
      `FastSpring HTTP ${response.status}`
    );
    error.status=response.status;
    throw error;
  }

  return data;
}

function faceEvolVerifyFastSpringWebhook(raw,header){
  if(!FASTSPRING_WEBHOOK_SECRET){
    throw new Error("FASTSPRING_WEBHOOK_SECRET is not configured");
  }

  const expected=createHmac("sha256",FASTSPRING_WEBHOOK_SECRET)
    .update(raw)
    .digest("base64");

  let expectedBuf, actualBuf;
  try{
    expectedBuf=Buffer.from(expected,"base64");
    actualBuf=Buffer.from(String(header||""),"base64");
  }catch{
    throw new Error("Invalid FastSpring webhook signature");
  }

  if(
    !actualBuf.length ||
    expectedBuf.length!==actualBuf.length ||
    !timingSafeEqual(expectedBuf,actualBuf)
  ){
    throw new Error("Invalid FastSpring webhook signature");
  }
}

async function handleFastSpringCheckout(req,res,raw){
  const auth=await faceEvolRequireUser(req,res);
  if(!auth) return;

  faceEvolEnforceFastSpringTester(auth.user);

  const body=faceEvolSafeJson(raw)||{};
  if(body.action!=="checkout"){
    return res.status(400).json({error:"Invalid FastSpring action."});
  }

  const key=String(body.pack||"");
  const pack=FACEVOL_FASTSPRING_PACKS[key];

  if(!pack){
    return res.status(400).json({error:"Invalid FaceEvol credit pack."});
  }

  const session=await faceEvolFastSpringRequest("/sessions",{
    contact:auth.user.email?{email:String(auth.user.email),country:"NL"}:{country:"NL"},
    tags:{
      purpose:"faceevol_credits",
      faceevol_user_id:String(auth.user.id),
      faceevol_pack:key,
      faceevol_credits:String(pack.credits),
      faceevol_product:pack.product
    },
    items:[{
      product:pack.product,
      quantity:1
    }]
  });

  const sessionId=String(
    session?.id ||
    session?.session ||
    session?.sessionId ||
    ""
  ).trim();

  if(!sessionId){
    throw new Error("FastSpring returned an invalid Checkout Session.");
  }

  const host=
    FASTSPRING_MODE==="live"
      ? `${FASTSPRING_STOREFRONT}.onfastspring.com`
      : `${FASTSPRING_STOREFRONT}.test.onfastspring.com`;

  return res.status(200).json({
    success:true,
    checkout_session_id:sessionId,
    url:`https://${host}/session/${encodeURIComponent(sessionId)}`
  });
}

async function faceEvolApplyFastSpringCredits(event){
  const order=
    event?.data?.order && typeof event.data.order==="object"
      ? event.data.order
      : event?.data;

  if(!order||typeof order!=="object"){
    throw new Error("FastSpring order data is missing");
  }

  const tags=order?.tags&&typeof order.tags==="object"?order.tags:{};
  if(tags.purpose!=="faceevol_credits") return {ignored:true};

  const orderId=String(order?.id||order?.order||"").trim();
  const userId=String(tags.faceevol_user_id||"").trim();
  const key=String(tags.faceevol_pack||"").trim();
  const credits=Number(tags.faceevol_credits);
  const productPath=String(tags.faceevol_product||"").trim();
  const pack=FACEVOL_FASTSPRING_PACKS[key];

  const items=Array.isArray(order?.items)?order.items:[];
  const item=items[0]||null;

  if(
    !orderId ||
    !/^[0-9a-f-]{36}$/i.test(userId) ||
    !pack ||
    pack.credits!==credits ||
    pack.product!==productPath ||
    items.length!==1 ||
    String(item?.product||"").trim()!==pack.product ||
    Number(item?.quantity)!==1
  ){
    throw new Error("Invalid FaceEvol FastSpring order metadata");
  }

  if(FASTSPRING_MODE==="live"&&event?.live===false){
    throw new Error("Test FastSpring event rejected in live mode");
  }

  if(FASTSPRING_MODE==="test"&&event?.live===true){
    throw new Error("Live FastSpring event rejected in test mode");
  }

  return faceEvolAdminRpc("apply_faceevol_fastspring_purchase_admin",{
    p_user_id:userId,
    p_credits:credits,
    p_fastspring_order_id:orderId,
    p_fastspring_order_reference:order?.reference?String(order.reference):null,
    p_fastspring_event_id:event?.id?String(event.id):null,
    p_product_path:productPath,
    p_amount_total:Number.isFinite(Number(order?.total))?Number(order.total):null,
    p_currency:order?.currency?String(order.currency).toLowerCase():null,
    p_live:event?.live===true||order?.live===true
  });
}

async function handleFastSpringWebhook(req,res,raw){
  try{
    faceEvolVerifyFastSpringWebhook(raw,req.headers?.["x-fs-signature"]);
  }catch(error){
    console.error(
      "FaceEvol FastSpring webhook verification failed:",
      error instanceof Error?error.message:String(error)
    );
    return res.status(400).json({error:"Invalid webhook signature."});
  }

  const payload=faceEvolSafeJson(raw);
  if(!payload||!Array.isArray(payload.events)){
    return res.status(400).json({error:"Invalid FastSpring webhook payload."});
  }

  for(const event of payload.events){
    if(event?.type!=="order.completed") continue;

    try{
      await faceEvolApplyFastSpringCredits(event);
    }catch(error){
      console.error("FaceEvol FastSpring credit delivery failed:",error);
      return res.status(500).json({error:"Credit delivery failed."});
    }
  }

  return res.status(200).json({received:true});
}

async function handlePredictionGet(
  req,
  res
) {
  const faceEvolAuth =
    await faceEvolRequireUser(
      req,
      res
    );

  if (!faceEvolAuth) {
    return;
  }


  const replicateToken =
    process.env
      .REPLICATE_API_TOKEN;


  if (!replicateToken) {
    return res.status(500).json({
      error:
        "REPLICATE_API_TOKEN is not configured"
    });
  }


  const {
    id
  } =
    req.query || {};


  if (
    typeof id !== "string" ||
    !/^[a-zA-Z0-9]+$/.test(
      id
    )
  ) {
    return res.status(400).json({
      error:
        "A valid prediction ID is required"
    });
  }


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

    return res.status(503).json({
      error:
        "FaceEvol couldn't verify this generation right now. Please try again.",
      code:
        "GENERATION_ACCESS_CHECK_FAILED"
    });
  }

  if (!ownedGeneration) {
    return res.status(403).json({
      error:
        "This AI generation does not belong to your FaceEvol account.",
      code:
        "GENERATION_ACCESS_DENIED"
    });
  }


  try {
    const response =
      await fetch(
        `https://api.replicate.com/v1/predictions/${id}`,
        {
          method: "GET",

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
      prediction = null;
    }


    if (!response.ok) {
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


    if (!prediction) {
      return res.status(502).json({
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
      prediction.error || null
    );


    const finished =
      prediction.status ===
        "succeeded" ||
      prediction.status ===
        "failed" ||
      prediction.status ===
        "canceled";


    /*
     * Replicate is finished with
     * the source files, so remove
     * the temporary private Blobs.
     */
    if (finished) {
      await cleanupPredictionInputs(
        prediction
      );
    }


    let faceEvolCredit = null;

    try {
      faceEvolCredit =
        await faceEvolFinalizePrediction(
          faceEvolAuth.user.id,
          String(prediction.id || id),
          String(prediction.status || "")
        );
    } catch (creditError) {
      /*
       * Never hide a valid AI result just because the credit ledger
       * could not be updated. Log it so it can be reconciled safely.
       */
      console.error(
        "FaceEvol prediction credit finalization failed:",
        creditError
      );
    }


    res.setHeader(
      "Cache-Control",
      "no-store"
    );


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
          typeof faceEvolCredit === "object"
            ? {
                ...faceEvolCredit,
                reserved:
                  faceEvolCredit.refunded !== true
              }
            : null
      });

  } catch (error) {
    console.error(
      "Prediction status error:",
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


export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");

  if(req.method==="GET"){
    return handlePredictionGet(req,res);
  }

  if(req.method==="POST"){
    let raw;
    try{
      raw=await faceEvolReadRawBody(req);
    }catch{
      return res.status(413).json({error:"Request body is too large."});
    }

    if(req.headers?.["x-fs-signature"]){
      return handleFastSpringWebhook(req,res,raw);
    }

    try{
      return await handleFastSpringCheckout(req,res,raw);
    }catch(error){
      const code=String(error instanceof Error?error.message:error);

      if(code==="FASTSPRING_TEST_ACCESS_NOT_CONFIGURED"){
        return res.status(503).json({
          error:"FastSpring test checkout is protected. Add FASTSPRING_TEST_EMAIL or FASTSPRING_TEST_USER_ID in Vercel before testing.",
          code
        });
      }

      if(code==="FASTSPRING_TEST_ACCESS_DENIED"){
        return res.status(403).json({
          error:"FastSpring checkout is currently in private test mode.",
          code
        });
      }

      console.error("FaceEvol FastSpring checkout error:",error);

      return res.status(Number(error?.status)||500).json({
        error:error instanceof Error?error.message:"Could not start FastSpring Checkout.",
        code:"FASTSPRING_CHECKOUT_FAILED"
      });
    }
  }

  res.setHeader("Allow","GET, POST");
  return res.status(405).json({error:"Method not allowed"});
}

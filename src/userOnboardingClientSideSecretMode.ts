import axios from "axios";
import { signDidAuthInternal } from "./utils/utils";
import {
  createAuthenticationResponsePayload,
  verifyAuthenticationRequest,
} from "./utils/onboardingUtils";
import querystring from "querystring";
import base64url from "base64url";
const canonicalize = require("canonicalize");
import { JwkKeyFormat } from "./utils/types";
import { ES256K } from "./types";
import { VerifiablePresentation } from "@cef-ebsi/verifiable-presentation";
import { VerifiableCredential } from "@cef-ebsi/verifiable-credential";
import { AuthenticationPayload, AuthResponsePayload } from "./utils/types";

export const userOnBoardAuthReq = async (
  token: string,
  did: string,
  publicKeyJwk: JwkKeyFormat,
  verifiablePresentation: unknown
): Promise<{ id_token: string }> => {
  let response;

  console.log("User onboarding initialted");
  const onboardRequestUrl =
    "https://api.preprod.ebsi.eu/users-onboarding/v1/authentication-requests";
  console.log("Request to user-onboarding-request");
  console.log("request url " + onboardRequestUrl);
  const authReq = await axios
    .post(onboardRequestUrl, {
      scope: "ebsi users onboarding",
    })
    .catch((error) => {
      console.log("request url failed to " + onboardRequestUrl);
      console.log(error.message);
      throw Error("SIOP request failed");
    });
  console.log(authReq.status);
  console.log(authReq.data);
  const uriAuthDecoded = querystring.decode(
    authReq.data.session_token.replace("openid://?", "")
  ) as {
    client_id: string;
    request: string;
    nonce: any;
  };

  console.log(uriAuthDecoded);
  const authRequestResponse = await verifyAuthenticationRequest(
    uriAuthDecoded.request,
    "https://api.preprod.ebsi.eu/did-registry/v2/identifiers"
  );

  console.log(authRequestResponse);
  const authReqObject = {
    did: did,
    nonce: uriAuthDecoded.nonce,
    redirectUri: uriAuthDecoded.client_id,
    response_mode: "fragment",
  };

  const payload = await createAuthenticationResponsePayload(authReqObject, publicKeyJwk);

  //("------------------------------------------------------------------------------------------------");
  // signs payload using internal libraries
  const jwt = await signDidAuthInternal(did, payload, "hexPrivatekey");

  //("------------------------------------------------------------------------------------------------");

  const didAuthResponseJwt = await createAuthenticationResponse(authReqObject, jwt);

  const [url, data] = didAuthResponseJwt.urlEncoded.split("#");
  console.log(didAuthResponseJwt);
  response = await axios
    .post(url, data, {
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded",
      },
    })
    .catch((error) => {
      // Handle Error Here
      console.log("User Onboarding error");
      console.error(error.message);
      throw Error("Invalid onboarding token");
    });
  const verifiableCredntial = response.data.verifiableCredential;

  console.log(verifiableCredntial);

  //("------------------------------------------------------------------------------------------------");

  //const verifiablePresentation = await createVP(did, client.privateKey, verifiableCredntial);

  //("------------------------------------------------------------------------------------------------");
  console.log(verifiablePresentation);
  const canonicalizedVP = base64url.encode(canonicalize(verifiablePresentation));
  const siopResponse = await axios.post(
    "https://api.preprod.ebsi.eu/authorisation/v1/authentication-requests",
    {
      scope: "openid did_authn",
    }
  );
  console.log(siopResponse.data);
  const uriDecoded = querystring.decode(siopResponse.data.uri.replace("openid://?", "")) as {
    client_id: string;
    request: string;
    nonce: string;
  };
  console.log(uriDecoded);
  const awa = await verifyAuthenticationRequest(
    uriDecoded.request,
    "https://api.preprod.ebsi.eu/did-registry/v2/identifiers"
  );
  console.log(awa);

  let body: unknown;
  let alg: string;
  alg = ES256K;

  if (publicKeyJwk == null) throw new Error("Public Key JWK null");

  const reqObj: AuthenticationPayload = {
    did: did,
    nonce: uriDecoded.nonce,
    redirectUri: uriDecoded.client_id,
    response_mode: "form_post",
    ...(canonicalizedVP && {
      claims: {
        verified_claims: canonicalizedVP,
        encryption_key: publicKeyJwk,
      },
    }),
  };
  const payloadSIOP = await createAuthenticationResponsePayload(reqObj, publicKeyJwk);

  //("------------------------------------------------------------------------------------------------");
  // signs payload using internal libraries
  const jwtSIOP = await signDidAuthInternal(did, payloadSIOP, "hexPrivatekey");

  //("------------------------------------------------------------------------------------------------");

  const didAuthJwt = await createAuthenticationResponse(reqObj, jwtSIOP);
  console.log(didAuthJwt);
  body = didAuthJwt.bodyEncoded;
  const responseSession = await axios.post(uriDecoded.client_id, body);
  console.log(responseSession.data);
  const siopSessionResponse = {
    alg,
    nonce: reqObj.nonce,
    response: responseSession.data,
  };
  console.log(siopSessionResponse);

  let accessToken: string = "";

  //("------------------------------------------------------------------------------------------------");

  // move this to client to decode and very the id_token
  // const siopAgent = new Agent({
  //   privateKey: client.privateKey.slice(2),
  //   didRegistry: "https://api.preprod.ebsi.eu/did-registry/v2/identifiers",
  // });
  // accessToken = await siopAgent.verifyAuthenticationResponse(
  //   siopSessionResponse.response,
  //   siopSessionResponse.nonce
  // );

  return { id_token: accessToken.toString() };
};

const createAuthenticationResponse = async (didAuthResponseCall, signedJWT: string) => {
  if (!didAuthResponseCall || !didAuthResponseCall.did || !didAuthResponseCall.redirectUri)
    throw new Error("Invalid parmas");

  const params = `id_token=${signedJWT}`;
  let uriResponse = {
    urlEncoded: "",
    bodyEncoded: "",
    encoding: "application/x-www-form-urlencoded",
    response_mode: didAuthResponseCall.response_mode
      ? didAuthResponseCall.response_mode
      : "fragment", // FRAGMENT is the default
  };

  if (didAuthResponseCall.response_mode === "form_post") {
    uriResponse.urlEncoded = encodeURI(didAuthResponseCall.redirectUri);
    uriResponse.bodyEncoded = encodeURI(params);
    return uriResponse;
  }

  if (didAuthResponseCall.response_mode === "query") {
    uriResponse.urlEncoded = encodeURI(`${didAuthResponseCall.redirectUri}?${params}`);
    return uriResponse;
  }
  uriResponse.response_mode = "fragment";
  uriResponse.urlEncoded = encodeURI(`${didAuthResponseCall.redirectUri}#${params}`);
  return uriResponse;
};

export const step4 = async (requestObject: AuthenticationPayload, signedJwt: string): Promise<{siopResponse}> => {
  const alg = ES256K;
  const didAuthJwt = await createAuthenticationResponse(requestObject, signedJwt);
  console.log(didAuthJwt);
  const body = didAuthJwt.bodyEncoded;
  const responseSession = await axios.post(requestObject.redirectUri, body);
  console.log(responseSession.data);
  const siopSessionResponse = {
    alg,
    nonce: requestObject.nonce,
    response: responseSession.data,
  };
  console.log(siopSessionResponse);
  return {siopResponse: siopSessionResponse}
};

export const step3 = async (
  verifiablePresentation: VerifiablePresentation,
  publicKeyJwk: JwkKeyFormat,
  did: string
): Promise<{ payload: AuthResponsePayload; authRequestObject: AuthenticationPayload }> => {
  console.log(verifiablePresentation);
  const canonicalizedVP = base64url.encode(canonicalize(verifiablePresentation));
  const siopResponse = await axios.post(
    "https://api.preprod.ebsi.eu/authorisation/v1/authentication-requests",
    {
      scope: "openid did_authn",
    }
  );
  console.log(siopResponse.data);
  const uriDecoded = querystring.decode(siopResponse.data.uri.replace("openid://?", "")) as {
    client_id: string;
    request: string;
    nonce: string;
  };
  console.log(uriDecoded);
  const awa = await verifyAuthenticationRequest(
    uriDecoded.request,
    "https://api.preprod.ebsi.eu/did-registry/v2/identifiers"
  );
  console.log(awa);

  if (publicKeyJwk == null) throw new Error("Public Key JWK null");

  const reqObj = {
    did: did,
    nonce: uriDecoded.nonce,
    redirectUri: uriDecoded.client_id,
    response_mode: "form_post",
    ...(canonicalizedVP && {
      claims: {
        verified_claims: canonicalizedVP,
        encryption_key: publicKeyJwk,
      },
    }),
  };
  return {
    payload: await createAuthenticationResponsePayload(reqObj, publicKeyJwk),
    authRequestObject: reqObj,
  };
};

export const step2 = async (
  authReqObject: AuthenticationPayload,
  signedJwt: string,
  token: string
): Promise<{ verifiableCredential: VerifiableCredential }> => {
  const didAuthResponseJwt = await createAuthenticationResponse(authReqObject, signedJwt);

  const [url, data] = didAuthResponseJwt.urlEncoded.split("#");
  console.log(didAuthResponseJwt);
  const response = await axios
    .post(url, data, {
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded",
      },
    })
    .catch((error) => {
      // Handle Error Here
      console.log("User Onboarding error");
      console.error(error.message);
      throw Error("Invalid onboarding token");
    });
  const verifiableCredential: VerifiableCredential = response.data.verifiableCredential;
  return { verifiableCredential: verifiableCredential };
};

export const step1 = async (
  did: string,
  publicKeyJwk: JwkKeyFormat
): Promise<{ payload: AuthResponsePayload; authRequestObject: AuthenticationPayload }> => {
  const onboardRequestUrl =
    "https://api.preprod.ebsi.eu/users-onboarding/v1/authentication-requests";
  console.log("Request to user-onboarding-request");
  console.log("request url " + onboardRequestUrl);
  const authReq = await axios
    .post(onboardRequestUrl, {
      scope: "ebsi users onboarding",
    })
    .catch((error) => {
      console.log("request url failed to " + onboardRequestUrl);
      console.log(error.message);
      throw Error("SIOP request failed");
    });
  console.log(authReq.status);
  console.log(authReq.data);
  const uriAuthDecoded = querystring.decode(
    authReq.data.session_token.replace("openid://?", "")
  ) as {
    client_id: string;
    request: string;
    nonce: string;
  };

  console.log(uriAuthDecoded);
  const authRequestResponse = await verifyAuthenticationRequest(
    uriAuthDecoded.request,
    "https://api.preprod.ebsi.eu/did-registry/v2/identifiers"
  );

  console.log(authRequestResponse);

  const authReqObject: AuthenticationPayload = {
    did: did,
    nonce: uriAuthDecoded.nonce,
    redirectUri: uriAuthDecoded.client_id,
    response_mode: "fragment",
  };

  return {
    payload: await createAuthenticationResponsePayload(authReqObject, publicKeyJwk),
    authRequestObject: authReqObject,
  };
};

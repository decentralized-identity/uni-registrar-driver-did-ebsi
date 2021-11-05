import { ES256KSigner, createJWT } from "@cef-ebsi/did-jwt";
import axios from "axios";
import {
  CONTEXT_W3C_DID,
  CONTEXT_W3C_SEC,
  CONTEXT_W3C_VC,
  OIDC_ISSUE,
  VERIFIABLE_PRESENTATION,
  ECDSA_SECP_256_K1_SIGNATURE_2019,
  JSON_WEB_Key_2020,
  ES256K,
  ASSERTION_METHOD,
} from "./constants";
import { Header } from "./types";
const { EbsiWallet } = require("@cef-ebsi/wallet-lib");
const { ethers } = require("ethers");
const base64url = require("base64url");
const buffer_1 = require("buffer");

import {
  createVerifiablePresentation,
  validateVerifiablePresentation,
  VerifiablePresentation,
}from "@cef-ebsi/verifiable-presentation";
const bs58 = require("bs58");
const crypto = require("crypto");

export const signDidAuthInternal = async (did, payload, hexPrivateKey) => {
  // check hexPrivateKey is valid
  const request = !!payload.client_id;

  let response = await createJWT(
    { ...payload },
    {
      issuer: OIDC_ISSUE,
      alg: ES256K,
      signer: ES256KSigner(hexPrivateKey.replace("0x", "")),
      expiresIn: 5 * 60,
    },
    {
      alg: ES256K,
      typ: "JWT",
      kid: request ? did : `${did}#key-1`,
    }
  );
  return response;
};

export const createVP = async (did, privateKey, vc) => {
  const options = {
    resolver: `https://api.preprod.ebsi.eu/did-registry/v2/identifiers`,
    tirUrl: `https://api.preprod.ebsi.eu/trusted-issuers-registry/v2/issuers`,
  };
  const requiredProof = {
    type: ECDSA_SECP_256_K1_SIGNATURE_2019,
    proofPurpose: ASSERTION_METHOD,
    verificationMethod: `${did}#keys-1`,
  };
  const presentation = {
    "@context": [CONTEXT_W3C_VC],
    type: VERIFIABLE_PRESENTATION,
    verifiableCredential: [vc],
    holder: did,
  };
  const vpSigner = ES256KSigner(privateKey);
  const jwtdata = await createJWT(
    presentation,
    {
      alg: ES256K,
      issuer: did,
      signer: vpSigner,
      canonicalize: true,
    },
    {
      alg: ES256K,
      typ: "JWT",
      kid: `${options.resolver}/${did}#keys-1`,
    }
  );
  console.log("Here..........");
  const vpToken = jwtdata.split(".");

  const signatureValue = {
    proofValue: `${vpToken[0]}..${vpToken[2]}`,
    proofValueName: "jws",
    iat: extractIatFromJwt(jwtdata),
  };
  console.log(JSON.stringify(presentation));

  const iat = `${new Date(signatureValue.iat * 1000).toISOString().split(".")[0]}Z`;

  const vp: VerifiablePresentation = {
    ...presentation,
    proof: {
      type: "EcdsaSecp256k1Signature2019",
      created: iat,
      proofPurpose: requiredProof.proofPurpose,
      verificationMethod: requiredProof.verificationMethod,
      jws: signatureValue.proofValue,
    },
  };
  console.log(vp)
  
  const x = await createVerifiablePresentation(presentation, requiredProof, signatureValue, options);
  return x;
};

const extractIatFromJwt = (jwt) => {
  const token = jwt.split(".");
  const payload = base64url.decode(token[1]);
  return JSON.parse(payload).iat;
};

export const serialize = async (object) => {
  if (object === null || typeof object !== "object" || object.toJSON != null) {
    return JSON.stringify(object);
  }
};

export const prepareDidDocument = async (
  didUser,
  publicKeyType,
  privateKeyController,
  reqDidDoc
) => {
  const controller = new ethers.Wallet(privateKeyController);

  let publicKey = {
    publicKeyJwk: new EbsiWallet(controller.privateKey).getPublicKey({
      format: "jwk",
    }),
  };
  const didDocument = (await constructDidDoc(didUser, publicKey, reqDidDoc)).didDoc;
  return await prepareDIDRegistryObject(didDocument);
};

const prepareDIDRegistryObject = async (
  didDocument: any
): Promise<{
  didDocument: any;
  timestampDataBuffer: any;
  didVersionMetadataBuffer: any;
}> => {
  const timestampData = { data: crypto.randomBytes(32).toString("hex") };
  const didVersionMetadata = {
    meta: crypto.randomBytes(32).toString("hex"),
  };

  const timestampDataBuffer = Buffer.from(JSON.stringify(timestampData));
  const didVersionMetadataBuffer = Buffer.from(JSON.stringify(didVersionMetadata));

  return {
    didDocument,
    timestampDataBuffer,
    didVersionMetadataBuffer,
  };
};

export const sendApiTransaction = async (
  method: any,
  token: string,
  param: any,
  client: any,
  header:Header,
  callback: any
) => {
  const url = `https://api.preprod.ebsi.eu/did-registry/v2/jsonrpc`;
  const response = await jsonrpcSendTransaction(client, token, url, method, param,header);

  if (response.status < 400 && (await waitToBeMined(response.data.result))) {
    callback();
  }
  return response.data;
};

const constructDidDoc = async (
  didUser: string,
  publicKey: object,
  didDocument: object
): Promise<{ didDoc: object }> => {
  if (didDocument == null || Object.keys(didDocument).length < 3)
    return { didDoc: defaultDidDoc(didUser, publicKey) };
  else {
    //\\ TODO: construct the did doc and insert the key properly
    let doc: object = didDocument;
    if (!("@context" in didDocument) || doc["@context"].length == 0)
      doc["@context"] = [CONTEXT_W3C_DID, CONTEXT_W3C_SEC];
    doc["id"] = didUser;
    doc["verificationMethod"] = [verificationMethod(didUser, publicKey)];
    if (!("authentication" in didDocument) || doc["authentication"].length == 0)
      doc["authentication"] = [`${didUser}#keys-1`];
    if (!(ASSERTION_METHOD in didDocument) || doc[ASSERTION_METHOD].length == 0)
      doc["assertionMethod"] = [`${didUser}#keys-1`];
    return { didDoc: doc };
  }
};

const defaultDidDoc = (didUser: string, publicKey: object) => {
  return {
    "@context": [CONTEXT_W3C_DID],
    id: didUser,
    verificationMethod: [verificationMethod(didUser, publicKey)],
    authentication: [`${didUser}#keys-1`],
    assertionMethod: [`${didUser}#keys-1`],
  };
};

export const prepareUpdateDidDocument = async (
  didUser,
  privateKeyController,
  didDoc: any | null
) => {
  let didDocument;

  didDocument =
    didDoc == null || Object.keys(didDoc).length < 3 ? await resolveDid(didUser) : didDoc;
  console.log(didDocument);
  //let publicKeyObjects: Array<object> = didDocument.get("verificationMethod"); 
  //const controller = new ethers.Wallet(privateKeyController);
  // let publicKey = {
  //   publicKeyJwk: new EbsiWallet(controller.privateKey).getPublicKey({
  //     format: "jwk",
  //   }),
  // };
  //didDocument["verificationMethod"] = verificationMethod(didUser, publicKey);

  return await prepareDIDRegistryObject(didDocument);
};

function fromHexString(hexString) {
  const match = hexString.match(/.{1,2}/g);
  if (!match) throw new Error("String could not be parsed");
  return new Uint8Array(match.map((byte) => parseInt(byte, 16)));
}


const verificationMethod = (didUser: string, publicKey: object) => {
  return {
    id: `${didUser}#keys-1`,
    type: JSON_WEB_Key_2020,
    controller: didUser,
    ...publicKey,
  };
};

export const jsonrpcSendTransaction = async (client, token, url, method, param, header: Header) => {
  const body = jsonrpcBody(method, [param]);
  console.log(JSON.stringify(body, null, 2));
  console.log("Request to build DID document insert tx");
  console.log("request url " + url);
  const response = await axios
    .post(url, body, {
      headers: { Authorization: `Bearer ${token}`,Conformance: header.Conformance },
    })
    .catch((error) => {
      console.log("send Insert DID doc tx to ledger failed");
      console.error(error.message);
      throw new Error(error.message);
    });
    
    console.log(response.status);
    console.log(response.data);

  const unsignedTransaction = response.data.result;
  const uTx = formatEthersUnsignedTransaction(JSON.parse(JSON.stringify(unsignedTransaction)));
  console.log("unsigned tx");
  console.log(uTx);
  uTx.chainId = Number(uTx.chainId);

  const sgnTx = await client.signTransaction(uTx);
  console.log("signed tx");
  console.log(sgnTx);
  const bodySend = jsonrpcBody("signedTransaction", [
    paramSignedTransaction(unsignedTransaction, sgnTx),
  ]);
  console.log("Request to send signed tx ");
  console.log("request url " + url);

  const responseSignedTx = await axios
    .post(url, bodySend, {
      headers: { Authorization: `Bearer ${token}`, Conformance: header.Conformance },
    })
    .catch((error) => {
      console.log("Send tx to ledger failed");
      console.error(error.message);
      throw new Error(error.message);
    });
  console.log(responseSignedTx.status);
  console.log(responseSignedTx.data);
  return responseSignedTx;
};

export function jsonrpcBody(method, params) {
  return {
    jsonrpc: "2.0",
    method,
    params,
    id: Math.ceil(Math.random() * 1000),
  };
}

function formatEthersUnsignedTransaction(unsignedTransaction) {
  return {
    to: unsignedTransaction.to,
    data: unsignedTransaction.data,
    value: unsignedTransaction.value,
    nonce: Number(unsignedTransaction.nonce),
    chainId: Number(unsignedTransaction.chainId),
    gasLimit: unsignedTransaction.gasLimit,
    gasPrice: unsignedTransaction.gasPrice,
  };
}

function paramSignedTransaction(tx, sgnTx) {
  const { r, s, v } = ethers.utils.parseTransaction(sgnTx);
  return {
    protocol: "eth",
    unsignedTransaction: tx,
    r,
    s,
    v: `0x${Number(v).toString(16)}`,
    signedRawTransaction: sgnTx,
  };
}

export const resolveDid = async (did: string): Promise<{ didDocument: object }> => {
  const url = "https://api.preprod.ebsi.eu/did-registry/v2/identifiers/";
  const encodedDid = "did%3Aebsi%3A" + did.split(":")[2];
  console.log(`${url + encodedDid}`);
  const response = await axios.get(url + encodedDid, {
    headers: { "Content-Type": "application/did+ld+json" },
  });
  return response.data.didDoc;
};

export const remove0xPrefix = (str: string): string => {
  return str.startsWith("0x") ? str.slice(2) : str;
};

export function prefixWith0x(key: string): string {
  return key.startsWith("0x") ? key : `0x${key}`;
}

export const base64ToBase64Url = (privateKey) => {
  const privateKeyBuffer = privateKey.toArrayLike(buffer_1.Buffer);
  return privateKeyBuffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
};

export async function getLedgerTx(txId, token) {
  const url = `https://api.preprod.ebsi.eu/ledger/v2/blockchains/besu`;
  const body = jsonrpcBody("eth_getTransactionReceipt", txId);
  const response = await axios.post(url, body, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status > 400) throw new Error(response.data);
  const receipt = response.data.result;
  if (receipt && Number(receipt.status) !== 1) {
    console.log(`Transaction failed: Status ${receipt.status}`);
    if (receipt.revertReason)
      console.log(`revertReason: ${Buffer.from(receipt.revertReason.slice(2), "hex").toString()}`);
  }
  return receipt;
}

async function waitToBeMined(txId) {
  let mined = false;
  let receipt = null;

  // if (!oauth2token) {
  //   utils.yellow(
  //     "Wait some seconds while the transaction is mined and check if it was accepted"
  //   );
  //   return 0;
  // }
  // while (!mined) {
  //   await new Promise((resolve) => setTimeout(resolve, 5000));
  //   receipt = await getLedgerTx(txId);
  //   mined = !!receipt;
  // }
  // /* eslint-enable no-await-in-loop */
  // if(!receipt) return 0;
  // if('statreturn Number(receipt.status?) === 1;us' in receipt)
  return 0;
}

import { prepareDIDRegistryObject, constructDidDoc } from "./utils";
import { ethers } from "ethers";
import { buildParamsObject, DIDDocument, JwkKeyFormat,JsonWebKey } from "../utils/types";

export const buildParams = async (buildParamsObj: buildParamsObject) => {
  const controllerDid = buildParamsObj.did;
  let newDidDocument;
  if (buildParamsObj.publicKey) {
    newDidDocument = await prepareDidDocumentWithPublicKey(
      controllerDid,
      buildParamsObj.publicKey,
      buildParamsObj.didDoc
    );
  }

  const {
    didDocument,
    timestampDataBuffer,
    didVersionMetadataBuffer,
  } = newDidDocument;
  const didDocumentBuffer = Buffer.from(JSON.stringify(didDocument));

  return {
    info: {
      title: "Did document",
      data: didDocument,
    },
    param: {
      identifier: `0x${Buffer.from(controllerDid).toString("hex")}`,
      hashAlgorithmId: 1,
      hashValue: ethers.utils.sha256(didDocumentBuffer),
      didVersionInfo: `0x${didDocumentBuffer.toString("hex")}`,
      timestampData: `0x${timestampDataBuffer.toString("hex")}`,
      didVersionMetadata: `0x${didVersionMetadataBuffer.toString("hex")}`,
    },
  };
};

const prepareDidDocumentWithPublicKey = async (
  didUser: string,
  publicKey: Array<JwkKeyFormat>,
  reqDidDoc?: DIDDocument
) => {
  const didDocument = (await constructDidDoc(didUser, publicKey as Array<JsonWebKey>, reqDidDoc))
    .didDoc;
  return await prepareDIDRegistryObject(didDocument);
};


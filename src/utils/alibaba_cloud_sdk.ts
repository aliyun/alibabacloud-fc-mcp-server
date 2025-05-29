import fc20230330 from "@alicloud/fc20230330";
import devs20230714 from "@alicloud/devs20230714";
import * as $OpenApi from "@alicloud/openapi-client";
import sts20150401 from "@alicloud/sts20150401";
import Core from "@alicloud/pop-core";
import Credential from "@alicloud/credentials";

const FCClient = fc20230330.default;
const DevsClient = devs20230714.default;

export function createFcClient(regionId: string) {
  const config = new $OpenApi.Config({
    credential: getCredentialClient(),
    endpoint: `fcv3.${regionId}.aliyuncs.com`,
  });
  return new FCClient(config);
}

export function createDevsClient(regionId: string) {
  const config = new $OpenApi.Config({
    credential: getCredentialClient(),
    regionId,
    endpoint: `devs.cn-hangzhou.aliyuncs.com`,
  });
  return new DevsClient(config);
}

export async function getAccountId(): Promise<string> {
  try {
    const client = createStsClient('cn-hangzhou');
    const result = await client.getCallerIdentity();
    const accountId = result.body?.accountId || '';
    return accountId;
  } catch (ex: any) {
    console.error('getAccountId异常：', JSON.stringify(ex))
    return '';
  }
} 

export function createStsClient(regionId: string) {
  const config = new $OpenApi.Config({
    credential: getCredentialClient(),
    regionId,
    endpoint: `sts.${regionId}.aliyuncs.com`,
  });
  return new sts20150401.default(config);
}

export function getCredentialClient() {
  return new Credential.default()
}
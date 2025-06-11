#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFcClient, getAccountId } from "./utils/alibaba_cloud_sdk.js";
import * as path from 'path';
import * as fs from 'fs';
import { z } from "zod";
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import yaml from 'js-yaml';
import { logger } from "./logger.js";
import loadComponent from "@serverless-devs/load-component";
import {
    regionSchema,
    domainSchema,
    codeUriSchema,
    logConfigSchema,
    vpcConfigSchema,
    updateCustomDomainConfigSchema,
    createCustomDomainConfigSchema,
    cpuSchema,
    memorySizeSchema,
    functionNameSchema,
    locationSchema,
    customRuntimeConfigSchema,
    functionDescriptionSchema,
    functionVersionDescriptionSchema,
    diskSizeSchema,
    instanceConcurrencySchema,
    environmentVariablesSchema,
    internetAccessSchema,
    functionRoleSchema,
    customRuntimeSchema,
    functionTimeoutSchema,
    customRuntimeLayersSchema,
    functionTagSchema,
    listFunctionsPrefixSchema,
    listFunctionsNextTokenSchema,
    listFunctionVersionsNextTokenSchema,
    listFunctionVersionsDirectionSchema,
    listFunctionVersionsLimitSchema,
    versionIdSchema
} from "./schema.js";
import {
    GetFunctionRequest,
    ListFunctionsRequest,
    CreateCustomDomainRequest,
    UpdateCustomDomainRequest,
    PublishFunctionVersionRequest,
    ListFunctionVersionsRequest,
} from "@alicloud/fc20230330";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const server = new McpServer({
    name: "alibabacloud-fc-mcp-server",
    version: "1.0.8",
});

const remoteMode = process.env.REMOTE_MODE === 'true';

// Helper: Prepare layers
function prepareLayers(layers: string[], regionID: string): string[] {
    layers.push(`acs:fc:${regionID}:official:layers/Python310/versions/3`);
    layers.push(`acs:fc:${regionID}:official:layers/Nodejs20/versions/3`);
    layers.push(`acs:fc:${regionID}:official:layers/Java21/versions/2`);
    return [...new Set(layers)];
}

// Helper: Prepare environment variables
function prepareEnvVars(env: Record<string, string> | undefined): Record<string, string> {
    env = env || {};
    if (!env.PATH) {
        env.PATH = "/opt/python3.10/bin:/opt/nodejs20/bin:/opt/java21/bin:/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/bin";
    }
    if (!env.PYTHONPATH) {
        env.PYTHONPATH = "/code/python";
    }
    if (!env.JAVA_HOME) {
        env.JAVA_HOME = "/opt/java21";
    }
    return env;
}

// Helper: Prepare fc3Props
function buildFc3Props(params: any, accountId: string, layers: string[], environmentVariables: Record<string, string>) {
    const { location, functionName, region, cpu, memorySize, customRuntimeConfig, description, diskSize, instanceConcurrency, internetAccess, logConfig, vpcConfig, role, runtime, timeout,  tags } = params;

    if (customRuntimeConfig && customRuntimeConfig.args && customRuntimeConfig.args.length === 0) {
        // unset empty args to avoid fc 400 error
        delete customRuntimeConfig.args;
    }

    return {
        functionName,
        region,
        cpu,
        memorySize,
        customRuntimeConfig,
        description,
        diskSize,
        instanceConcurrency,
        environmentVariables,
        internetAccess,
        logConfig,
        vpcConfig,
        role: role || `acs:ram::${accountId}:role/aliyunfcdefaultrole`,
        runtime,
        timeout,
        layers,
        tags,
        code: location,
        customDomain: {
            domainName: "auto",
            protocol: "HTTP",
            route: {
                path: "/*",
                qualifier: "LATEST",
            }
        }
    };
}

// Helper: Write s.yaml
function writeSYaml(workspacePath: string, fc3Props: any) {
    const alias = 'default_serverless_devs_key';
    const yamlObject: any = {
        edition: "3.0.0",
        access: alias,
        name: "my-app",
        resources: {
            [fc3Props.functionName]: {
                component: "fc3",
                props: fc3Props,
            }
        }
    };
    const yamlContent = yaml.dump(yamlObject);
    const yamlPath = path.join(workspacePath, "s.yaml");
    console.error('writing yaml to: ', yamlPath, 'content: \n', yamlContent);
    fs.writeFileSync(yamlPath, yamlContent);
    return yamlPath;
}

async function syncYaml(tmpYamlDir: string, functionName: string, region: string, sconfig: any) {
    const component = await loadComponent.default("fc3", { logger });
    const result = await component.sync({
        //args: ['--silent', '--region', region, '-y', '--functionName', functionName, '--access', 'default_serverless_devs_key', '--name', 'my-app'],
        props: {
            functionName,
            region,
        },
        name: "my-app",
        args: ['--silent', '--access', 'default_serverless_devs_key', '--target-dir', tmpYamlDir],
        resource: {
            name: functionName,
            component: "fc3",
            access: 'default_serverless_devs_key',
        },
        getCredential: async () => ({
            AccountID: sconfig.AccountID,
            AccessKeyID: sconfig.AccessKeyID,
            AccessKeySecret: sconfig.AccessKeySecret,
            SecurityToken: sconfig.SecurityToken,
        }),
    });
    console.error('sync result: ', JSON.stringify(result));
    const yamlFileName = `${region}_${functionName}.yaml`.replace('$', '_')
    const codePath = `${region}_${functionName}`.replace('$', '_')
    return {
        yamlPath: path.join(tmpYamlDir, yamlFileName),
        codePath: path.join(tmpYamlDir, codePath)
    };
}


function updateYamlByInputs(yamlPath: string, originCodePath: string, args: any) {
    const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
    const yamlObject: any = yaml.load(yamlContent);

    const { location, functionName, region, cpu, memorySize, customRuntimeConfig, description, diskSize, instanceConcurrency, environmentVariables, layers, internetAccess, logConfig, vpcConfig, role, runtime, timeout, tags } = args;
    if (location) {
        yamlObject.resources[functionName].props.code = location;
    } else {
        yamlObject.resources[functionName].props.code = originCodePath;
    }
    if (cpu) {
        yamlObject.resources[functionName].props.cpu = cpu;
    }
    if (memorySize) {
        yamlObject.resources[functionName].props.memorySize = memorySize;
    }
    if (customRuntimeConfig) {
        yamlObject.resources[functionName].props.customRuntimeConfig = customRuntimeConfig;
    }
    if (description) {
        yamlObject.resources[functionName].props.description = description;
    }
    if (diskSize) {
        yamlObject.resources[functionName].props.diskSize = diskSize;
    }
    if (instanceConcurrency) {
        yamlObject.resources[functionName].props.instanceConcurrency = instanceConcurrency;
    }
    if (environmentVariables) {
        const finalEnv = prepareEnvVars(environmentVariables);
        yamlObject.resources[functionName].props.environmentVariables = finalEnv;
    }
    if (layers) {
        const finalLayers = prepareLayers(layers, region);
        yamlObject.resources[functionName].props.layers = finalLayers;
    }
    if (internetAccess) {
        yamlObject.resources[functionName].props.internetAccess = internetAccess;
    }
    if (logConfig) {
        yamlObject.resources[functionName].props.logConfig = logConfig;
    }
    if (vpcConfig) {
        yamlObject.resources[functionName].props.vpcConfig = vpcConfig;
    }
    if (role) {
        yamlObject.resources[functionName].props.role = role;
    }
    if (runtime) {
        yamlObject.resources[functionName].props.runtime = runtime;
    }
    if (timeout) {
        yamlObject.resources[functionName].props.timeout = timeout;
    }
    if (tags) {
        yamlObject.resources[functionName].props.tags = tags;
    }
    fs.writeFileSync(yamlPath, yaml.dump(yamlObject));
    return yamlObject.resources[functionName].props;
}

// Helper: Deploy function
async function deployFunction(functionName: string, yamlPath: string, sconfig: any, fc3Props: any) {
    const component = await loadComponent.default("fc3", { logger });
    const result = await component.deploy({
        props: fc3Props,
        name: "my-app",
        args: ['--silent', '-t', yamlPath, '-y'],
        yaml: { path: yamlPath },
        resource: {
            name: functionName,
            component: "fc3",
            access: 'default_serverless_devs_key',
        },
        getCredential: async () => ({
            AccountID: sconfig.AccountID,
            AccessKeyID: sconfig.AccessKeyID,
            AccessKeySecret: sconfig.AccessKeySecret,
            SecurityToken: sconfig.SecurityToken,
        }),
    })
    console.error('deploy result: ', result);
    console.error('deploy output: ', JSON.stringify(result));
    return JSON.stringify(result);
}


function prepareTmpDir() {
    const tmpYamlDir = path.join(os.tmpdir(), `${Date.now()}`);
    fs.mkdirSync(tmpYamlDir, { recursive: true });
    return tmpYamlDir;
}


function getAutoCustomDomainName(uid: string, functionName: string, regionID: string) {
    const normalizedFunctionName = functionName.replace(/_/g, '-').toLowerCase();
    return `${normalizedFunctionName}.fcv3.${uid}.${regionID}.fc.devsapp.net`;
}

// Helper: Download file
async function downloadFile(url: string, dest: string): Promise<void> {
    const response = await axios.get(url, { responseType: 'stream' });
    const writer = fs.createWriteStream(dest);
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

async function createCustomRuntimeFunction(params: any): Promise<CallToolResult> {
    const { location, functionName, region, layers, environmentVariables } = params;
    if (!functionName) {
        return { isError: true, content: [{ type: "text", text: `执行失败，请设置functionName参数` }] };
    }
    const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
    const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
    const stsToken = process.env.ALIBABA_CLOUD_SECURITY_TOKEN || '';
    if (!accessKeyId || !accessKeySecret) {
        return { isError: true, content: [{ type: "text", text: `执行失败，请设置ALIBABA_CLOUD_ACCESS_KEY_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET, ALIBABA_CLOUD_SECURITY_TOKEN环境变量` }] };
    }
    const accountId = await getAccountId();
    if (!accountId) {
        return { isError: true, content: [{ type: "text", text: `执行失败，获取accountId异常` }] };
    }
    // Prepare layers and env
    const finalLayers = prepareLayers(layers, region);
    const finalEnv = prepareEnvVars(environmentVariables);
    // Build props
    const fc3Props = buildFc3Props(params, accountId, finalLayers, finalEnv);
    // Write yaml
    const tmpYamlDir = prepareTmpDir();
    const yamlPath = writeSYaml(tmpYamlDir, fc3Props);
    // Deploy
    const sconfig: any = {
        AccountID: accountId,
        AccessKeyID: accessKeyId,
        AccessKeySecret: accessKeySecret,
        SecurityToken: stsToken,
    };
    if (stsToken && stsToken.length > 0) {
        sconfig.SecurityToken = stsToken;
    }
    try {
        const result = await deployFunction(functionName, yamlPath, sconfig, fc3Props);
        return { content: [{ type: "text", text: `部署完成。output: ${result}` }] };
    } catch (error: any) {
        return { isError: true, content: [{ type: "text", text: `部署失败：${JSON.stringify(error)}` }] };
    }
}

async function updateCustomRuntimeFunction(params: any): Promise<CallToolResult> {
    const { functionName, region } = params;
    const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
    const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
    const stsToken = process.env.ALIBABA_CLOUD_SECURITY_TOKEN || '';
    if (!accessKeyId || !accessKeySecret) {
        return { isError: true, content: [{ type: "text", text: `执行失败，请设置ALIBABA_CLOUD_ACCESS_KEY_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET, ALIBABA_CLOUD_SECURITY_TOKEN环境变量` }] };
    }
    const fcClient = createFcClient(region);
    const accountId = await getAccountId();
    if (!accountId) {
        return { isError: true, content: [{ type: "text", text: `执行失败，获取accountId异常` }] };
    }
    try {
        await fcClient.getFunction(functionName, new GetFunctionRequest({}));
    } catch (error: any) {
        if (error.statusCode !== 404) {
            return { isError: true, content: [{ type: "text", text: `获取函数信息失败：${JSON.stringify(error as any)}` }] };
        }
        return { isError: true, content: [{ type: "text", text: `函数不存在` }] };
    }
    const sconfig: any = {
        AccountID: accountId,
        AccessKeyID: accessKeyId,
        AccessKeySecret: accessKeySecret,
        SecurityToken: stsToken,
    };
    // 同步yaml文件
    const tmpYamlDir = prepareTmpDir();
    const syncResult = await syncYaml(tmpYamlDir, functionName, region, sconfig);
    // update Yaml
    const fc3Props = updateYamlByInputs(syncResult.yamlPath, syncResult.codePath, params);
    // Deploy
    try {
        const result = await deployFunction(functionName, syncResult.yamlPath, sconfig, fc3Props);
        return { content: [{ type: "text", text: `部署完成。output: ${result}` }] };
    } catch (error) {
        return { isError: true, content: [{ type: "text", text: `部署失败：${JSON.stringify(error as any)}` }] };
    }
}

// 创建或更新函数
if (remoteMode) {
    server.tool(
        "put-custom-runtime-function",
        "提供构建完成的匹配阿里云自定义运行时的zip格式的代码包的可下载链接以及其他函数部署配置，创建函数并部署代码到该函数。如果函数已存在，则尝试覆盖并更新目标函数。建议使用该方法前先确认函数是否存在，如果存在需要确认更新目标函数",
        {
            codeUri: codeUriSchema,
            functionName: functionNameSchema,
            region: regionSchema,
            cpu: cpuSchema.default(1),
            memorySize: memorySizeSchema.default(2048),
            customRuntimeConfig: customRuntimeConfigSchema,
            description: functionDescriptionSchema.optional(),
            diskSize: diskSizeSchema,
            instanceConcurrency: instanceConcurrencySchema,
            environmentVariables: environmentVariablesSchema.default({}),
            internetAccess: internetAccessSchema.default(true),
            logConfig: logConfigSchema.optional(),
            vpcConfig: vpcConfigSchema.optional(),
            role: functionRoleSchema.optional(),
            runtime: customRuntimeSchema.default("custom.debian10"),
            timeout: functionTimeoutSchema.default(3),
            layers: customRuntimeLayersSchema.default([]),
            tags: functionTagSchema.default([]),
        },
        async (args) => {
            const { codeUri } = args;
            if (!codeUri) {
                return { isError: true, content: [{ type: "text", text: `执行失败，需要指定codeUri参数` }] };
            }
            const location = path.join(os.tmpdir(), `code-${Date.now()}.zip`);
            // download codeUri to location
            await downloadFile(codeUri, location);

            if (!fs.existsSync(location)) {
                return { isError: true, content: [{ type: "text", text: `执行失败，需要指定本地代码工程根路径` }] };
            }
            const nextArgs = {
                ...args,
                location,
            }
            return await createCustomRuntimeFunction(nextArgs);
        }
    );
} else {
    server.tool(
        "put-custom-runtime-function",
        "将构建完成的匹配阿里云自定义运行时的工程，部署到函数计算。代码工程不需要手动打包，会自动处理。如果函数已存在，则尝试覆盖并更新目标函数。建议使用该方法前先确认函数是否存在",
        {
            location: locationSchema,
            functionName: functionNameSchema,
            region: regionSchema,
            cpu: cpuSchema.default(1),
            memorySize: memorySizeSchema.default(2048),
            customRuntimeConfig: customRuntimeConfigSchema,
            description: functionDescriptionSchema.optional(),
            diskSize: diskSizeSchema,
            instanceConcurrency: instanceConcurrencySchema,
            environmentVariables: environmentVariablesSchema.default({}),
            internetAccess: internetAccessSchema.default(true),
            logConfig: logConfigSchema.optional(),
            vpcConfig: vpcConfigSchema.optional(),
            role: functionRoleSchema.optional(),
            runtime: customRuntimeSchema.default("custom.debian10"),
            timeout: functionTimeoutSchema.default(3),
            layers: customRuntimeLayersSchema.default([]),
            tags: functionTagSchema.default([]),
        },
        async (args) => {
            const { location } = args;
            if (!fs.existsSync(location)) {
                return { isError: true, content: [{ type: "text", text: `执行失败，需要指定本地代码工程根路径` }] };
            }
            return await createCustomRuntimeFunction(args);
        }
    );
}

// 更新函数
if (remoteMode) {
    server.tool(
        "update-custom-runtime-function",
        "更新custom runtime函数。只需要提供需要更新的参数，未提供的参数将保持不变",
        {
            codeUri: codeUriSchema.optional(),
            functionName: functionNameSchema.describe("要更新的目标函数名称"),
            region: regionSchema,
            cpu: cpuSchema.optional(),
            memorySize: memorySizeSchema.optional(),
            customRuntimeConfig: customRuntimeConfigSchema.optional(),
            description: functionDescriptionSchema.optional(),
            diskSize: diskSizeSchema.optional(),
            instanceConcurrency: instanceConcurrencySchema.optional(),
            environmentVariables: environmentVariablesSchema.optional(),
            internetAccess: internetAccessSchema.optional(),
            logConfig: logConfigSchema.optional(),
            vpcConfig: vpcConfigSchema.optional(),
            role: functionRoleSchema.optional(),
            runtime: customRuntimeSchema.optional(),
            timeout: functionTimeoutSchema.optional(),
            layers: customRuntimeLayersSchema.optional(),
            tags: functionTagSchema.optional(),
        },
        async (args) => {
            const { codeUri } = args;
            let location;
            if (codeUri) {
                location = path.join(os.tmpdir(), `code-${Date.now()}.zip`);
                // download codeUri to location
                try {
                    await downloadFile(codeUri, location);
                } catch (error) {
                    return { isError: true, content: [{ type: "text", text: `执行失败，下载代码工程失败: ${JSON.stringify(error as any)}` }] };
                }
                if (!fs.existsSync(location)) {
                    return { isError: true, content: [{ type: "text", text: `执行失败，下载代码工程失败` }] };
                }
            }
            const nextArgs = {
                ...args,
                location,
            }
            return await updateCustomRuntimeFunction(nextArgs);
        }
    )
} else {
    server.tool(
        "update-custom-runtime-function",
        "更新并部署custom runtime函数。如果需要修改代码，必须先完成构建。如果需要更新函数配置，需要提供更新的参数，未提供的参数将保持不变",
        {
            location: locationSchema.describe("本地代码工程的根路径，需要部署更新代码时，需要提供本地代码工程的根路径，否则可不提供").optional(),
            functionName: functionNameSchema.describe("要更新的目标函数名称"),
            region: regionSchema,
            cpu: cpuSchema.optional(),
            memorySize: memorySizeSchema.optional(),
            customRuntimeConfig: customRuntimeConfigSchema.optional(),
            description: functionDescriptionSchema.optional(),
            diskSize: diskSizeSchema.optional(),
            instanceConcurrency: instanceConcurrencySchema.optional(),
            environmentVariables: environmentVariablesSchema.optional(),
            internetAccess: internetAccessSchema.optional(),
            logConfig: logConfigSchema.optional(),
            vpcConfig: vpcConfigSchema.optional(),
            role: functionRoleSchema.optional(),
            runtime: customRuntimeSchema.optional(),
            timeout: functionTimeoutSchema.optional(),
            layers: customRuntimeLayersSchema.optional(),
            tags: functionTagSchema.optional(),
        },
        async (args) => {
            const { location } = args;
            if (location && !fs.existsSync(location)) {
                return { isError: true, content: [{ type: "text", text: `执行失败，指定的本地代码工程路径不存在` }] };
            }
            return await updateCustomRuntimeFunction(args);
        }
    )
}

// 查询函数
server.tool(
    "get-function",
    "获取创建的函数计算的函数信息",
    {
        functionName: functionNameSchema,
        region: regionSchema,
    },
    async (args) => {
        const { functionName, region } = args;
        const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
        const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
        if (!accessKeyId || !accessKeySecret) {
            return { isError: true, content: [{ type: "text", text: `执行失败，请设置ALIBABA_CLOUD_ACCESS_KEY_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET, ALIBABA_CLOUD_SECURITY_TOKEN环境变量` }] };
        }
        const accountId = await getAccountId();
        if (!accountId) {
            return { isError: true, content: [{ type: "text", text: `执行失败，获取accountId异常` }] };
        }
        const fcClient = createFcClient(region);
        let getFunctionResult;
        try {
            const getFunctionRequest = new GetFunctionRequest({})
            getFunctionResult = await fcClient.getFunction(functionName, getFunctionRequest)
        } catch (error) {
            return { isError: true, content: [{ type: "text", text: `获取函数信息失败：${JSON.stringify(error as any)}` }] };
        }

        const functionInfo = {
            ...getFunctionResult.body,
        }
        const autoDomainName = getAutoCustomDomainName(accountId, functionName, region);
        let getCustomDomainResult;
        try {
            getCustomDomainResult = await fcClient.getCustomDomain(autoDomainName);
        } catch (error: any) {
            if (error.statusCode !== 404) {
                return { isError: true, content: [{ type: "text", text: `获取函数域名信息失败：${JSON.stringify(error as any)}` }] };
            }
            getCustomDomainResult = null;
        }
        if (getCustomDomainResult) {
            const routes = getCustomDomainResult.body?.routeConfig?.routes
            if (routes && routes.length == 1) {
                const route = routes[0];
                if (route.functionName == functionName) {
                    functionInfo.domain = autoDomainName;
                }
            }
        }
        return { content: [{ type: "text", text: `获取函数信息: ${JSON.stringify(functionInfo)}` }] };
    }
)

server.tool(
    "list-functions",
    "获取函数计算的函数列表，只返回函数名称与部分函数信息，不返回所有函数信息。如果需要获取所有函数信息，请使用get-function工具",
    {
        region: regionSchema,
        prefix: listFunctionsPrefixSchema.optional(),
        nextToken: listFunctionsNextTokenSchema.optional(),
        limit: z.number().describe("函数列表的返回数量上限，默认50，最大100").min(1).max(100).default(50),
        tags: functionTagSchema.describe("函数标签，用于过滤函数列表，只返回包含所有标签的函数").optional(),
        runtime: z.string().describe("函数运行时，用于过滤函数列表，只返回指定运行时的函数").optional(),
    },
    async (args) => {
        const { region } = args;
        const fcClient = createFcClient(region);
        const listFunctionsRequest = new ListFunctionsRequest({
            ...args
        });
        const functions = await fcClient.listFunctions(listFunctionsRequest);
        return { content: [{ type: "text", text: `获取函数列表: ${JSON.stringify(functions)}` }] };
    }
)


//删除函数
server.tool(
    "delete-function",
    "删除函数计算的函数",
    {
        functionName: functionNameSchema,
        region: regionSchema,
    },
    async (args) => {
        const { functionName, region } = args;
        const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
        const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
        if (!accessKeyId || !accessKeySecret) {
            return { isError: true, content: [{ type: "text", text: `执行失败，请设置ALIBABA_CLOUD_ACCESS_KEY_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET, ALIBABA_CLOUD_SECURITY_TOKEN环境变量` }] };
        }
        const accountId = await getAccountId();
        if (!accountId) {
            return { isError: true, content: [{ type: "text", text: `执行失败，获取accountId异常` }] };
        }
        const fcClient = createFcClient(region);
        try {
            await fcClient.deleteFunction(functionName);
        } catch (error) {
            return { isError: true, content: [{ type: "text", text: `删除函数失败：${JSON.stringify(error as any)}` }] };
        }
        const autoCustomDomainName = getAutoCustomDomainName(accountId, functionName, region);
        try {
            await fcClient.deleteCustomDomain(autoCustomDomainName);
        } catch (error) {
            return { isError: true, content: [{ type: "text", text: `删除函数域名路由配置失败：${JSON.stringify(error as any)}` }] };
        }
        return { content: [{ type: "text", text: `删除函数成功` }] };
    }
)


// 查询路由配置
server.tool(
    "get-custom-domain-config",
    "查询函数计算的域名路由配置",
    {
        region: regionSchema,
        domain: domainSchema,
    },
    async (args) => {
        const { region, domain } = args;
        const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
        const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
        if (!accessKeyId || !accessKeySecret) {
            return { isError: true, content: [{ type: "text", text: `执行失败，请设置ALIBABA_CLOUD_ACCESS_KEY_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET, ALIBABA_CLOUD_SECURITY_TOKEN环境变量` }] };
        }
        const accountId = await getAccountId();
        if (!accountId) {
            return { isError: true, content: [{ type: "text", text: `执行失败，获取accountId异常` }] };
        }
        const fcClient = createFcClient(region);
        try {
            const result = await fcClient.getCustomDomain(domain);
            return { content: [{ type: "text", text: `查询路由配置成功。result: ${JSON.stringify(result)}` }] };
        } catch (error) {
            return { isError: true, content: [{ type: "text", text: `查询路由配置失败：${JSON.stringify(error as any)}` }] };
        }
    }
)

// 更新域名路由配置
server.tool(
    "update-custom-domain-config",
    "更新函数计算的域名路由配置，修改域名路由配置",
    {
        region: regionSchema,
        domain: domainSchema,
        updateCustomDomainConfig: updateCustomDomainConfigSchema,
    },
    async (args) => {
        const { region, domain, updateCustomDomainConfig } = args;
        const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
        const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
        if (!accessKeyId || !accessKeySecret) {
            return { isError: true, content: [{ type: "text", text: `执行失败，请设置ALIBABA_CLOUD_ACCESS_KEY_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET, ALIBABA_CLOUD_SECURITY_TOKEN环境变量` }] };
        }
        const accountId = await getAccountId();
        if (!accountId) {
            return { isError: true, content: [{ type: "text", text: `执行失败，获取accountId异常` }] };
        }
        const fcClient = createFcClient(region);
        const updateCustomDomainRequest: UpdateCustomDomainRequest = new UpdateCustomDomainRequest({
            body: {
                authConfig: updateCustomDomainConfig.authConfig,
                certConfig: updateCustomDomainConfig.certConfig,
                tlsConfig: updateCustomDomainConfig.tlsConfig,
                wafConfig: updateCustomDomainConfig.wafConfig,
                routeConfig: updateCustomDomainConfig.routeConfig,
                protocol: updateCustomDomainConfig.protocol,
            },
        });
        try {
            const result = await fcClient.updateCustomDomain(domain, updateCustomDomainRequest);
            return { content: [{ type: "text", text: `更新域名路由配置成功。result: ${JSON.stringify(result)}` }] };
        } catch (error) {
            return { isError: true, content: [{ type: "text", text: `更新域名路由配置失败：${JSON.stringify(error as any)}` }] };
        }
    }
)

// 创建域名路由配置
server.tool(
    "create-custom-domain-config",
    "创建函数计算的域名路由配置，域名必须已经CNAME到函数计算的公网域名（格式为${uid}.${regionId}.fc.aliyuncs.com，例如14**49.cn-hangzhou.fc.aliyuncs.com）上，否则会创建失败。",
    {
        region: regionSchema,
        createCustomDomainConfig: createCustomDomainConfigSchema,
    },
    async (args) => {
        const { region, createCustomDomainConfig } = args;
        const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
        const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
        if (!accessKeyId || !accessKeySecret) {
            return { isError: true, content: [{ type: "text", text: `执行失败，请设置ALIBABA_CLOUD_ACCESS_KEY_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET, ALIBABA_CLOUD_SECURITY_TOKEN环境变量` }] };
        }
        const accountId = await getAccountId();
        if (!accountId) {
            return { isError: true, content: [{ type: "text", text: `执行失败，获取accountId异常` }] };
        }
        const fcClient = createFcClient(region);
        const createCustomDomainRequest: CreateCustomDomainRequest = new CreateCustomDomainRequest({
            body: {
                domainName: createCustomDomainConfig.domain,
                protocol: createCustomDomainConfig.protocol,
                routeConfig: createCustomDomainConfig.routeConfig,
                authConfig: createCustomDomainConfig.authConfig,
                certConfig: createCustomDomainConfig.certConfig,
                tlsConfig: createCustomDomainConfig.tlsConfig,
                wafConfig: createCustomDomainConfig.wafConfig,
            },
        });
        try {
            const result = await fcClient.createCustomDomain(createCustomDomainRequest);
            return { content: [{ type: "text", text: `创建域名路由配置成功。result: ${JSON.stringify(result)}` }] };
        } catch (error) {
            return { isError: true, content: [{ type: "text", text: `创建域名路由配置失败：${JSON.stringify(error as any)}` }] };
        }
    }
)

// 删除域名路由配置
server.tool(
    "delete-custom-domain-config",
    "删除函数计算的域名路由配置，CNAME记录不会被删除，需要手动删除CNAME记录",
    {
        region: regionSchema,
        domain: domainSchema,
    },
    async (args) => {
        const { region, domain } = args;
        const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
        const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
        if (!accessKeyId || !accessKeySecret) {
            return { isError: true, content: [{ type: "text", text: `执行失败，请设置ALIBABA_CLOUD_ACCESS_KEY_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET, ALIBABA_CLOUD_SECURITY_TOKEN环境变量` }] };
        }
        const accountId = await getAccountId();
        if (!accountId) {
            return { isError: true, content: [{ type: "text", text: `执行失败，获取accountId异常` }] };
        }
        const fcClient = createFcClient(region);
        try {
            const result = await fcClient.deleteCustomDomain(domain);
            return { content: [{ type: "text", text: `删除域名路由配置成功。result: ${JSON.stringify(result)}` }] };
        } catch (error) {
            return { isError: true, content: [{ type: "text", text: `删除域名路由配置失败：${JSON.stringify(error as any)}` }] };
        }
    }
)

// 发布函数版本
server.tool(
    "publish-function-version",
    "将函数的最新代码发布为新版本",
    {
        functionName: functionNameSchema,
        region: regionSchema,
        description: functionVersionDescriptionSchema,
    },
    async (args) => {
        const { functionName, region, description } = args;
        const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
        const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
        if (!accessKeyId || !accessKeySecret) {
            return { isError: true, content: [{ type: "text", text: `执行失败，请设置ALIBABA_CLOUD_ACCESS_KEY_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET, ALIBABA_CLOUD_SECURITY_TOKEN环境变量` }] };
        }
        const accountId = await getAccountId();
        if (!accountId) {
            return { isError: true, content: [{ type: "text", text: `执行失败，获取accountId异常` }] };
        }
        const fcClient = createFcClient(region);
        try {
            const request = new PublishFunctionVersionRequest({
                description,
            })
            const result = await fcClient.publishFunctionVersion(functionName, request);
            return { content: [{ type: "text", text: `发布函数版本成功。result: ${JSON.stringify(result)}` }] };
        } catch (error) {
            return { isError: true, content: [{ type: "text", text: `发布函数版本失败：${JSON.stringify(error as any)}` }] };
        }
    }
)

// 获取函数版本
server.tool(
    "list-function-versions",
    "获取函数计算的函数版本列表",
    {
        functionName: functionNameSchema,
        region: regionSchema,
        nextToken: listFunctionVersionsNextTokenSchema.optional(),
        direction: listFunctionVersionsDirectionSchema,
        limit: listFunctionVersionsLimitSchema.optional(),
    },
    async (args) => {
        const { functionName, region, nextToken, direction, limit } = args;
        const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
        const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
        if (!accessKeyId || !accessKeySecret) {
            return { isError: true, content: [{ type: "text", text: `执行失败，请设置ALIBABA_CLOUD_ACCESS_KEY_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET, ALIBABA_CLOUD_SECURITY_TOKEN环境变量` }] };
        }
        const accountId = await getAccountId();
        if (!accountId) {
            return { isError: true, content: [{ type: "text", text: `执行失败，获取accountId异常` }] };
        }
        const fcClient = createFcClient(region);
        const listFunctionVersionsRequest = new ListFunctionVersionsRequest({
            functionName,
            direction,
        })
        if (nextToken) {
            listFunctionVersionsRequest.nextToken = nextToken;
        }
        if (limit) {
            listFunctionVersionsRequest.limit = limit;
        }
        try {
            const listFunctionVersionsResult = await fcClient.listFunctionVersions(functionName, listFunctionVersionsRequest);
            return { content: [{ type: "text", text: `获取函数版本列表成功。result: ${JSON.stringify(listFunctionVersionsResult)}` }] };
        } catch (error) {
            return { isError: true, content: [{ type: "text", text: `获取函数版本列表失败：${JSON.stringify(error as any)}` }] };
        }

    }
)

// 删除函数版本
server.tool(
    "delete-function-version",
    "删除函数计算的函数版本",
    {
        functionName: functionNameSchema,
        region: regionSchema,
        versionId: versionIdSchema,
    },
    async (args) => {
        const { functionName, region, versionId } = args;
        const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
        const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
        if (!accessKeyId || !accessKeySecret) {
            return { isError: true, content: [{ type: "text", text: `执行失败，请设置ALIBABA_CLOUD_ACCESS_KEY_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET, ALIBABA_CLOUD_SECURITY_TOKEN环境变量` }] };
        }
        const accountId = await getAccountId();
        if (!accountId) {
            return { isError: true, content: [{ type: "text", text: `执行失败，获取accountId异常` }] };
        }
        const fcClient = createFcClient(region);
        try {
            const result = await fcClient.deleteFunctionVersion(functionName, versionId);
            return { content: [{ type: "text", text: `删除函数版本成功。result: ${JSON.stringify(result)}` }] };
        } catch (error) {
            return { isError: true, content: [{ type: "text", text: `删除函数版本失败：${JSON.stringify(error as any)}` }] };
        }
    }
)

// 部署函数自定义运行时runtime的提示词
server.prompt(
    "deploy-custom-runtime-function",
    () => {
        const promptPath = resolve(__dirname, './static/custom_runtime_prompt.md');
        const promptText = fs.readFileSync(promptPath, 'utf-8').toString();
        return {
            messages: [{
                role: "user",
                content: {
                    type: "text",
                    text: promptText
                }
            }]
        }
    }
)

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((error) => {
    process.stderr.write(JSON.stringify(error));
    process.exit(1);
});

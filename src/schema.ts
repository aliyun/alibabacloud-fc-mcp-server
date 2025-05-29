import { z } from "zod";

// region schema
export const regionSchema = z.enum(['cn-hangzhou', 'cn-shanghai', 'cn-beijing', 'cn-shenzhen'])
    .default('cn-hangzhou')
    .describe("部署的区域，当前可选的区域是cn-hangzhou, cn-shanghai, cn-beijing, cn-shenzhen，默认是cn-hangzhou");

// equal rule schema
export const equalRuleSchema = z.object({
    match: z.string().describe("匹配规则"),
    replacement: z.string().describe("替换规则"),
}).describe("自定义域名完全匹配重写规则配置");

// wildcard rule schema
export const wildcardRuleSchema = z.object({
    match: z.string().describe("匹配规则"),
    replacement: z.string().describe("替换规则"),
}).describe("自定义域名通配符重写规则配置");

// regex rule schema
export const regexRuleSchema = z.object({
    match: z.string().describe("匹配规则"),
    replacement: z.string().describe("替换规则"),
}).describe("自定义域名正则重写规则配置");

// rewrite config schema
export const rewriteConfigSchema = z.object({
    equalRules: z.array(equalRuleSchema).describe("精确匹配规则列表"),
    wildcardRules: z.array(wildcardRuleSchema).describe("通配匹配规则列表"),
    regexRules: z.array(regexRuleSchema).describe("正则匹配规则列表"),
}).describe("重写配置，可以采用精确匹配、通配匹配或正则匹配其中之一");

// path config schema
export const pathConfigSchema = z.object({
    path: z.string().describe("HTTP协议中的PATH路径，例如/api/，或/api/*"),
    functionName: z.string().describe("路由的目标函数名称"),
    qualifier: z.string().describe("路由的目标函数版本或别名，默认是LATEST").optional(),
    methods: z.array(z.enum(['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'])).describe("HTTP方法，可选值为GET, POST, PUT, DELETE, HEAD, OPTIONS").default(['GET', 'POST','PUT', 'DELETE', 'HEAD', 'OPTIONS']),
    rewriteConfig: rewriteConfigSchema.optional(),
}).describe("自定义域名路由路径配置。");

// route config schema
export const routeConfigSchema = z.object({
    routes: z.array(pathConfigSchema).describe("路由配置"),
});

// auth config schema
export const authConfigSchema = z.object({
    authType: z.enum(['anonymous', 'function']).describe("认证类型，可选值为anonymous, function。anonymous：匿名认证，无需认证。function：函数签名校验认证。默认为匿名校验").optional(),
}).describe("权限认证配置");

// cert config schema
export const certConfigSchema = z.object({
    certName: z.string().describe("证书名称"),
    privateKey: z.string().describe("PEM格式证书私钥"),
    certificate: z.string().describe("PEM格式证书内容，必须包含全部的证书内容，包括中间证书"),
}).describe("证书配置，如果要支持HTTPS协议，则必须要配置证书");

// tls config schema
export const tlsConfigSchema = z.object({
    minVersion: z.string().describe("TLS版本，可选值为TLSv1.0, TLSv1.1, TLSv1.2, TLSv1.3。默认为TLSv1.2"),
    maxVersion: z.string().describe("TLS版本，可选值为TLSv1.0, TLSv1.1, TLSv1.2, TLSv1.3。默认为TLSv1.2"),
    cipherSuites: z.array(z.string()).describe("TLS密码套件，可选值为TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256, TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384, TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256, TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256, TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384, TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256。默认为TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256, TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384, TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256"),
}).describe("TLS配置，如果要支持HTTPS协议，则必须要配置TLS");

// waf config schema
export const wafConfigSchema = z.object({
    enable: z.boolean().describe("是否开启WAF"),
}).describe("Web应用防火墙（WAF）配置");

// log config schema
export const logConfigSchema = z.union([z.object({
    project: z.string().describe("日志投递的SLS日志项目名称"),
    logstore: z.string().describe("日志投递的SLS日志库名称"),
    logBeginRule: z.enum(["DefaultRegex", "None"]).default("DefaultRegex").describe("日志投递到SLS日志库时的切分规则，可选值为DefaultRegex，表示使用默认的切分规则。启用后，函数计算将按日志分割规则进行切分，切分成多个日志段，并逐条写入日志服务。默认的日志分割规则为 ^.{0,2}\d{4}-\d{2}-\d{2}，即匹配符合xxxx-xx-xx格式的日期，其中x代表数字。该规则将按照行首是否带有日期进行切分，例如您的日志行首是2023-10-10，则该日志将被认为是一块日志的首行，首行和接下来连续不带日期的日志将被作为一条日志写入到日志服务。不启用日志分割规则是，默认使用换行符\\n进行切分。"),
    enableInstanceMetrics: z.boolean().default(true).describe("是否开启实例级指标投递，开启后，函数计算会自动将实例级指标投递到SLS日志库。"),
    enableRequestMetrics: z.boolean().default(true).describe("是否开启请求级指标投递，开启后，函数计算会自动将请求级指标投递到SLS日志库。"),
}), z.enum(["auto"])]).describe("日志投递配置。如果配置为auto，则会自动创建SLS日志库并投递日志。如果配置为其他值，则需要配置project和logstore。")

// vpc config schema
export const vpcConfigSchema = z.union([z.object({
    vpcId: z.string().describe("VPC的ID"),
    vSwitchIds: z.string().describe("VSwitch的ID"),
    securityGroupId: z.string().describe("安全组ID"),
}), z.enum(["auto"])]).describe("函数的VPC网络配置。如果配置为auto，则会自动创建VPC、VSwitch与安全组配置。如果配置为其他值，则需要配置vpcId、vSwitchIds与securityGroupId。函数实例会运行在配置的VPC网络中。")

export const protocolSchema = z.enum(['HTTP', 'HTTPS', 'HTTP,HTTPS']).describe("域名路由配置的协议，可选值为HTTP, HTTPS, HTTP,HTTPS。HTTP：仅支持 HTTP 协议。HTTPS：仅支持 HTTPS 协议。HTTP,HTTPS：支持 HTTP 及 HTTPS 协议。");

// update custom domain config schema
export const updateCustomDomainConfigSchema = z.object({
    protocol: protocolSchema.optional(),
    routeConfig: routeConfigSchema,
    authConfig: authConfigSchema,
    certConfig: certConfigSchema.optional(),
    tlsConfig: tlsConfigSchema.optional(),
    wafConfig: wafConfigSchema.optional(),
});

export const domainSchema = z.string().describe("域名，例如example.com，域名不能带有'https://'或'http://'等协议内容");

// create custom domain config schema
export const createCustomDomainConfigSchema = z.object({
    domain: domainSchema,
    protocol: protocolSchema.optional(),
    routeConfig: routeConfigSchema,
    authConfig: authConfigSchema,
    certConfig: certConfigSchema.optional(),
    tlsConfig: tlsConfigSchema.optional(),
    wafConfig: wafConfigSchema.optional(),
});

// cpu schema
export const cpuSchema = z.number().describe("函数的 CPU 规格，单位为 vCPU，为 0.05 vCPU 的倍数。 和 diskSize 必须同时存在， 如果仅仅填写 memorySize, cpu 和 diskSize 可以不填。内存规格（以GB计算）与CPU规格的比例必须在1到4之间，例如内存为1024MB，则CPU必须为0.25到1之间，默认为1");

// memory size schema
export const memorySizeSchema = z.number().describe("函数的内存规格，单位为 MB，最小值为128，最大值为 30720。可以选择的内存规格为：128，256，512，1024，2048，4096，8192，16384，32768。默认为2048。内存规格（以GB计算）与CPU规格的比例必须在1到4之间，例如内存为1024MB，则CPU必须为0.25到1之间");

// function name schema
export const functionNameSchema = z.string().describe("函数名称，函数名称在每个region必须是唯一的。")
    .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,63}$/);

// location schema
export const locationSchema = z.string().describe("本地代码工程的根路径");

// custom runtime config schema
export const customRuntimeConfigSchema = z.object({
    command: z.array(z.string()).describe("自定义运行时启动命令，命令执行的用户是root，执行的目录是/code,例如python3"),
    args: z.array(z.string()).describe("自定义运行时启动命令参数，例如app.py").optional(),
    port: z.number().describe("自定义运行时中启动的HTTP Server的监听端口，默认为9000").default(9000),
}).describe("自定义运行时配置，定义启动命令、参数以及启动的HTTP Server的监听端口");

// function description schema
export const functionDescriptionSchema = z.string().describe("函数的描述，可以描述一下函数的功能。");

// disk size schema
export const diskSizeSchema = z.number().describe("磁盘大小，单位是MB，可选值: 512 | 10240");

// instance concurrency schema
export const instanceConcurrencySchema = z.number().describe("单实例多并发数。规定了单个实例可以同时同时被多个请求命中的上限，只对自定义运行时与自定义容器镜像运行时生效。范围为[1, 200]");

// environment variables schema
export const environmentVariablesSchema = z.record(
    z.string().describe("环境变量名称"),
    z.string().describe("环境变量值")
).describe("运行时的环境变量配置");

// internet access schema
export const internetAccessSchema = z.boolean().describe("是否支持从函数实例内访问互联网");

// function role schema
export const functionRoleSchema = z.string().describe("函数运行时的角色配置。授予函数计算所需权限的 RAM 角色，使用场景包含：1. 把函数产生的日志发送到您的日志库中。2. 为函数在执行过程中访问其他云资源生成的临时访问令牌。一般可以设置为aliyunfcdefaultrole。角色ARN为acs:ram::****:role/aliyunfcdefaultrole,只需要输入aliyunfcdefaultrole即可");

// custom runtime schema
export const customRuntimeSchema = z.enum(['custom.debian10', 'custom.debian11', 'custom.debian12']).describe("函数的运行时环境，对于自定义运行时，当前支持debian10，debian11，debian12");

// function timeout schema
export const functionTimeoutSchema = z.number().describe("函数执行的超时时间，单位为秒，最小 1 秒，默认 3 秒。函数执行超过这个时间后会被终止执行。");

// custom runtime layers schema
export const customRuntimeLayersSchema = z.array(z.string()).describe("函数计算的层配置，当前会自动为custom.debian10，custom.debian11，custom.debian12添加默认的公共层");

// function tag schema
export const functionTagSchema = z.array(z.object({
    key: z.string().describe("标签名称"),
    value: z.string().describe("标签值")
})).describe("函数标签的key与value配置"); 

export const listFunctionsPrefixSchema = z.string().describe("函数名称前缀，用于过滤函数列表");

export const listFunctionsNextTokenSchema = z.string().describe("函数列表的下一页token，用于分页查询函数列表。第一页不需要提供");
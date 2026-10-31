# IPQS

[English](README.md) · **简体中文**

你的 IP 有多干净？[IPQS](https://ipqs.1ms.dog) 同时向十几个 IP 情报库和 8 个 DNS 黑名单查询一个地址，哪个先返回就先显示哪个，全部返回后给出 0–100 的评分，以及对常见用途的判断。

**在线使用：** https://ipqs.1ms.dog

## 能看到什么

- **评分和等级（A–F）**，附明细：每一分扣在哪里、为什么。
- **家宽、移动网络还是机房**，按有多少个来源同意来判断。
- **原生 IP 还是广播 IP**：比较地址注册机构（RDAP）记录的国家和各数据库给出的位置。
- **VPN、代理、Tor 标记**，逐个来源统计，另外查 Tor 项目自己的出口列表。
- **欺诈和滥用分数**：有这项数据的来源加权平均。
- **邮件黑名单**（SpamCop、Barracuda、PSBL、Mailspike、UCEPROTECT、GBUdb、blocklist.de、Anonmails）。
- **对用途的影响**：流媒体、AI 服务（包括 OpenAI 和 Anthropic 不服务的地区）、Google 和 Cloudflare 验证码、注册和支付、发邮件。
- **每个来源的原始结果**，都链接到该来源自己的查询页，方便核对；另有去 Scamalytics、Spur、ping0 等网站查询的链接。

本机的 IPv4 和 IPv6 都会找出来（由浏览器访问只支持 IPv4 和只支持 IPv6 的地址），也可以查任意公网地址：`https://ipqs.1ms.dog/?ip=8.8.8.8`。

## 数据来源

| 来源 | 是否需要密钥 | 提供什么 |
|---|---|---|
| Cloudflare | 否 | Cloudflare 边缘看到的信息（只查本机地址） |
| ip-api.com | 否 | 代理、机房、移动网络、反向解析 |
| proxycheck.io | 可选 `PROXYCHECK_KEY` | 代理、VPN、Tor、网络类型、0–100 风险值、运营方 |
| IPQuery | 否 | 代理、VPN、Tor、机房、风险值 |
| ipapi.is | 可选 `IPAPI_IS_KEY` | 网络信息；有密钥时加上 VPN/代理/滥用标记和网段滥用等级 |
| IP2Location | 可选 `IP2LOCATION_KEY` | 代理 |
| IPinfo | 可选 `IPINFO_TOKEN` | 位置、网络、任播 |
| RDAP（各 RIR） | 否 | 注册国家、网络名、地址段 |
| ip.guide | 否 | 所属网络的注册国家和 RIR |
| Shodan InternetDB | 否 | 开放端口，`vpn`、`proxy`、`tor` 等标签（IPv4） |
| Tor Project | 否 | 出口列表（IPv4） |
| IPQualityScore | `IPQS_KEY` | 欺诈分数、代理、VPN、Tor、近期滥用 |
| AbuseIPDB | `ABUSEIPDB_KEY` | 滥用置信度、举报数、使用类型 |
| Scamalytics | `SCAMALYTICS_USER`、`SCAMALYTICS_KEY` | 欺诈分数 |
| ipdata | `IPDATA_KEY` | 威胁标记和分数 |

没有配置密钥的来源显示为「本站未启用」。需要密钥的几家都有免费套餐。黑名单里没有 Spamhaus 和 SORBS：它们拒绝经由公共 DNS 解析器的查询。

## 评分规则

每个地址从 100 分开始，按各来源的发现扣分：机房网络最多扣 20（多数来源认为是机房时扣满 20，所以干净的服务器地址最高 B 级），代理标记扣 20，VPN 扣 15，Tor 扣 40，滥用报告扣 10，加权平均欺诈分数最多扣 35，每个邮件黑名单扣 6（最多 24）。标记按同意的来源比例折算。等级：A 85 以上，B 70 以上，C 50 以上，D 30 以上，F 低于 30。

规则在 [`src/score.mjs`](src/score.mjs)，有单元测试。

## API

```
GET /api/check            本机地址
GET /api/check?ip=<地址>  任意公网 IPv4 或 IPv6 地址
```

返回 NDJSON：先是一行 `start`（列出所有行），每个来源返回时一行 `src`，每个黑名单一行 `bl`，最后一行 `done`，包含 `score`、`grade`、`parts`、`notes`、`uses` 和 `summary`。每个地址的结果缓存 6 小时。每个访问者每分钟最多 20 次新查询。

## 自己部署

```bash
git clone https://github.com/yt1988/ipqs
cd ipqs
npx wrangler login
npx wrangler deploy
```

只有一个 Worker：页面是静态资源（免费、不计请求数），`src/worker.js` 负责 `/api/check`。`wrangler.toml` 关闭了 `*.workers.dev` 和预览地址；在 **Workers & Pages → ipqs → Settings → Domains & Routes** 绑定自己的域名，或者临时设置 `workers_dev = true` 试用。用 `npx wrangler secret put IPQS_KEY` 等命令添加密钥。

要让 canonical 标签和站点地图用你自己的域名，用 `SITE_URL` 重新构建：

```bash
npm install
SITE_URL=https://ip.example.com node scripts/build.mjs
```

在 1ms.dog 上，页面还会加上全站共用的导航条、统计和主题/语言同步。

## 开发

```bash
npm install
npm run dev        # wrangler dev，http://localhost:8792（本地拿不到本机地址，请用 ?ip=）
npm run build      # 改了 src/ 之后重新生成 public/（public/ 要提交）
npm test           # public/ 是否最新、页面约定、评分和 IP 解析的测试
```

在 1ms.dog 上，推送到 `main` 会自动部署（Cloudflare Workers Builds 先运行 `npm ci && npm test`）。

## 许可证

MIT

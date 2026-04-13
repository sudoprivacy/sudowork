---
name: channel-info
description: "获取 Channel 渠道配置信息 - 查询 Telegram、飞书、钉钉、微信等渠道的启用状态和运行状态"
---

# 渠道信息 Skill

查询 IM 渠道（Telegram、飞书、钉钉、微信等）的配置和运行状态。

## 使用方法

输出 `[CHANNEL_INFO]` 直接查询所有渠道状态。

输出 `[CHANNEL_INFO: wechat]` 查询特定渠道（支持 telegram、lark、dingtalk、wechat）。

**输出命令直接，不要包裹在代码块中。**

## 示例

查询所有渠道：
```
[CHANNEL_INFO]
```

查询 WeChat 渠道：
```
[CHANNEL_INFO: wechat]
```

## 返回信息

系统将返回以下信息（排除敏感凭据）：
- 渠道类型 (type)
- 渠道名称 (name)
- 启用状态 (enabled)
- 连接状态 (connected)
- 运行状态 (status)
- 最后连接时间 (lastConnected)
- 凭据配置状态 (hasToken) - 仅显示是否已配置，不显示具体凭据

## 注意事项

1. 敏感信息（token、secret 等）不会返回
2. 支持的渠道类型：telegram、lark、dingtalk、wechat、wecom、zentao
3. 渠道状态可能是 running、stopped、error 等
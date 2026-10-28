# Sudowork 本体包（.sudoonto）

`.sudoonto` 是客户端可编辑导入和跨宿主运行的统一交付格式。客户端负责建模、调试、发布和包流转；Moss 的上传、上架、企业智能体发布和租户访问后续接入，本轮没有修改 Moss。

## 客户端工作流

本体库保留新建、导入和连接数据库入口。数据库入口现在直接创建同一种可编辑工作台，支持 SQLite、MySQL、PostgreSQL，不依赖 Sudograph 环境配置。标准文件入口保留 RDF/XML、OWL/XML，并支持 `.sudoonto`。

1. 新建本体、导入标准模型，或连接数据库生成工作稿。
2. 在建模和数据页调整对象、关系和映射；在能力页编辑、调试函数和动作。
3. 在发布页编辑“随包交付的智能体定义”。其名称、说明和指令随下一次发布固定。
4. 完成检查，创建并审批版本，在版本操作中导出 Sudowork 本体包。
5. 在另一客户端选择导入 `.sudoonto`，预览模型数量、智能体说明和待配置资源，创建新的本地项目。
6. 在数据页的“运行环境”重新配置连接或文件。数据库有连接表单；接口、秘密槽位、动作授权等可通过绑定 JSON 设置。
7. 继续建模、调整能力或智能体说明，调试后发布新版本并再次导出。

导入不执行包内 CLI、业务动作或安装脚本，也不自动注册智能体。保留原身份导入时，原发布版本可原样再导出；选择“独立派生本体”时生成新的本体身份，并保留来源记录，之后发布新的本地版本。

新建本体按固定创建时间倒序显示；编辑或重命名不改变顺序。旧数据和旧运行包不做兼容迁移。

## 包结构

```text
manifest.json
authoring/project.json
ontology/model.rdf
ontology/runtime-model.json
capabilities/catalog.json
capabilities/implementations/*
scripts/ontology.cjs
agent/definition.json
agent/AGENT.md
environment/resources.json
environment/bindings.example.json
environment/bindings.schema.json
environment/runtime.lock.json
verification/export-report.json
checksums.json
assets/*                         仅在显式选择携带数据时存在
```

`authoring/project.json` 保存建模目标、说明、资产选择、可移植智能体说明和包身份信息。运行投影与实现文件恢复对象、属性、关系、映射、规则及函数/动作源码；草稿和停用能力也保留，运行目录只向调用者开放启用的能力。

语义文件与运行投影、智能体说明与编辑资料、能力参数与实现引用会进行一致性检查。仅有文件摘要一致不足以接受缺失实现、无效引用或错误的能力权限声明。

## 身份和版本

当前 manifest 的主要契约：

| 字段 | 含义 |
| --- | --- |
| `kind` | `sudowork-ontology-package` |
| `formatVersion` / `protocolVersion` | 当前均为 1 |
| `ontologyId` | 跨设备保留的逻辑本体身份 |
| `versionId` / `version` | 不可变内容版本 ID 与展示名称 |
| `derivedFrom` | 来源本体、来源版本及其运行摘要，存在来源时提供 |
| `runtimeDigest` | 模型、编辑资料、实现、CLI、智能体及环境契约的内容摘要 |
| `resources` | 逻辑资源及可选的包内附件引用 |
| `entrypoints` | 语义、运行投影、编辑资料、能力、CLI 和智能体入口 |

本机 `workspaceId` 和安装目录与包身份分开。导入同一包可以创建多个本地项目实例，不会因此改写原发布内容。修改后创建新的版本 ID 和运行摘要，并记录来源；企业部署实例将由未来 Moss 自行创建。

`packageDigest` 是分发文件索引摘要，另外覆盖数据附件和导出报告。重新采集数据或导出报告时间变化可能改变分发摘要；没有修改运行定义时，原发布版本的 `runtimeDigest` 保持一致。

同一发布包的原样再次导出复用固定产物。编辑工作稿后，使用统一构建器生成新的产物，并在新候选中固定。已经发布的旧版本继续引用原产物。

## 环境绑定

包只声明资源，不保存真实连接凭据。目标宿主通过以下结构提供环境：

```json
{
  "connections": {
    "business_db": {
      "sourceType": "postgresql",
      "host": "database.internal",
      "port": 5432,
      "database": "business",
      "username": "ontology_reader",
      "password": "<由目标宿主提供>",
      "writable": false
    }
  },
  "files": {},
  "actions": {},
  "secrets": {},
  "allowedActions": []
}
```

资源 ID 以具体包的 `environment/bindings.example.json` 为准。客户端绑定保存到本机工作稿的受保护存储，不进入导出材料；返回界面的模板不包含已有凭据。配置中的空字符串保留已有值，数组按本次输入更新。

导入没有外部绑定的包仍可查看、编辑；运行某项能力时只检查该能力及其函数依赖涉及的资源。整套环境验证要求所有声明的绑定齐备。

SQLite 选中后导出整个数据库的一致性快照。嵌入数据默认只读。需要写入时在运行包外创建数据副本，并绑定这个外部路径，不能将客户端受管理的包目录设为可写业务库。

结构化配置的敏感字段保存为秘密槽位。API 的静态请求头和请求模板保留，目标地址与认证由部署绑定提供。原始附件内容和源码中的硬编码秘密不会自动脱敏。

## 智能体与未来 Moss

`agent/definition.json` 提供默认 profile ID、名称、说明、指令文件、启用能力引用、命令执行要求，以及宿主负责动作授权和资源绑定的声明。

客户端“随包交付的智能体定义”是可移植定义的编辑入口。本地智能体注册默认使用对应发布版本的指令；直接修改某个已安装智能体目录中的规则文件，不会自动回写包定义。

Moss 后续可据此完成：上传校验 → 目录版本登记 → 管理员绑定企业数据库等资源 → 创建企业智能体 → 普通用户在 Sudowork 中直接使用。

普通用户使用企业智能体不要求下载本体包，也不应获得数据库凭据。服务端运行环境负责执行包内能力；目录下载编辑权限与智能体使用权限分别管理。当前包提供声明与执行协议，租户授权、运行隔离、资源账号和会话接入由后续 Moss 实现。

## 独立运行

解压 `.sudoonto`，将绑定和请求文件放在包目录外：

```bash
node scripts/ontology.cjs inspect --package .
node scripts/ontology.cjs list --package .
node scripts/ontology.cjs describe logic.orders_lookup --package .
node scripts/ontology.cjs verify --package . --bindings ../bindings.json
node scripts/ontology.cjs invoke logic.orders_lookup \
  --package . --bindings ../bindings.json --input-file ../request.json
```

请求示例：

```json
{"protocolVersion": 1, "requestId": "example", "arguments": {"query": {}}}
```

当前要求兼容 Node.js 22.22.2 及以上、`node:sqlite` 备份 API；声明 Python 或 shell 能力时需要对应解释器。数据库 JavaScript 驱动随 CLI 构建，Oracle 使用 thin 模式。不会自动安装任意脚本的依赖。

自定义脚本需要第三方环境时，在执行配置中填写 `dependencies`，例如 `[{"runtime":"python","name":"requests","version":"==2.32.5"}]`。声明随实现保存并汇总到运行要求中，供未来 Moss 准备环境；当前检查报告将其标为 `declaration-only`，不会把依赖已声明当成已经安装或验证通过。直接引用的脚本应当自包含，外部文件不能仅依赖作者机器上的路径。

`verify` / `validate` 检查包、绑定、解释器及资源，资源报告区分数据库结构检查、文件可访问性和仅绑定检查，不执行任意业务动作，也不声称已覆盖所有业务参数。桌面导出用宿主的校验 CLI 检查包，避免仅为重新封装而启动外来包中的 CLI；显式运行发布能力才使用固定版本的执行入口。

动作需要目标宿主提供 `allowedActions`，数据库写还需要连接 `writable: true`。包声明及提示词不代替宿主的数据权限和隔离措施。

## 当前边界

- 标准文件目前支持 RDF/XML、OWL/XML；不承诺完整 OWL 推理或所有 RDF 序列化格式。
- 内置查询与关系遍历由统一 CLI 中的实现解释模型；不是为每个对象另生成独立程序。
- 可识别的直接脚本源码随包固定；任意递归 import、原生库和第三方环境的自动封装不在当前能力内，需作者确保自包含或声明、配置外部程序绑定。
- 包身份、摘要及来源记录不等于发布者签名或发布权限。未来 Moss 仍需执行自己的可信性和目录授权检查。
- 保存工作稿与构建文件产物是两个步骤；构建失败会报告，运行前重新构建，不静默回退到本体 MCP。
- 本轮只实现客户端和共享包协议，不包含 Moss 服务端开发。

主要验收位于 `ontologyPackageCirculation.integration.test.ts`、`ontologySudoonto.dom.test.tsx`、`ontologyScriptPackage.integration.test.ts`，覆盖跨客户端恢复编辑、绑定新数据库、原样再导出、修改后版本来源、静态导入、秘密槽位、写权限与导出 UI。

# LibreOffice 预览功能测试指南

## 功能说明

根据用户需求实现的 LibreOffice 预览功能逻辑：

1. **非 Office 文件** → 使用原有的 PreviewPanel 预览
2. **LibreOffice 未安装** → 所有文件（包括 Office）使用 PreviewPanel 预览
3. **LibreOffice 已安装** → Office 文件 (.doc, .docx, .ppt, .pptx, .xls, .xlsx) 转换为 PDF 后预览

> **注意**: CSV 文件使用 Excel 预览器但不需要 LibreOffice

## 测试方法

### 方法 1: LibreOffice 转换测试脚本

```bash
# 测试 LibreOffice 是否可检测及转换功能
npm run test:libreoffice
```

**测试内容**:
- 检测 LibreOffice 是否已安装
- 执行实际的 PDF 转换测试
- 验证转换结果

### 方法 2: 开发模式下手动测试

```bash
# 启动应用
npm start
```

**手动测试步骤**:

1. **测试非 Office 文件预览**
   - 上传 `.txt`, `.js`, `.ts`, `.py` 文件
   - 预期：使用代码预览器显示内容

2. **测试 Markdown 文件预览**
   - 上传 `.md` 文件
   - 预期：使用 Markdown 渲染器显示

3. **测试图片文件预览**
   - 上传 `.png`, `.jpg` 文件
   - 预期：使用图片预览器显示

4. **测试 Office 文件预览（LibreOffice 未安装时）**
   - 当前系统状态：LibreOffice 未安装
   - 上传 `.doc`, `.docx` 文件
   - 预期：显示提示 "LibreOffice 未安装"，降级为代码预览

5. **测试 CSV 文件预览**
   - 上传 `.csv` 文件
   - 预期：使用 Excel 预览器（不需要 LibreOffice）

### 方法 3: 安装 LibreOffice 后测试

```bash
# macOS 安装 LibreOffice
brew install --cask libreoffice

# 或者从官网下载: https://www.libreoffice.org/download/
```

安装后重新运行测试：

```bash
# 再次运行转换测试
npm run test:libreoffice

# 启动应用测试 Office 文件预览
npm start
```

**预期结果**:
- `.doc`, `.docx` → PDF 转换后预览
- `.ppt`, `.pptx` → PDF 转换后预览
- `.xls`, `.xlsx` → PDF 转换后预览

## 代码验证清单

### 前端逻辑 (useWorkspaceFileOps.ts)

- [x] Office 文件扩展名检测（排除 CSV）
- [x] LibreOffice 可用性检查（带缓存）
- [x] 降级逻辑：LibreOffice 未安装时 contentType 降级为 'code'
- [x] 提示信息：显示 `libreOfficeNotAvailable` 翻译

### IPC Bridge (ipcBridge.ts)

- [x] `document.convert` 端点定义
- [x] `document.libreOffice.isAvailable` 端点定义

### 后端服务 (conversionService.ts)

- [x] `libreOfficeToPdf()` 方法
- [x] `isLibreOfficeAvailable()` 方法
- [x] `findLibreOffice()` 多路径检测
- [x] PDF 导出过滤器（calc_pdf_Export, writer_pdf_Export, impress_pdf_Export）

### 预览组件

- [x] WordViewer.tsx - 使用 IPC 转换为 PDF
- [x] PPTViewer.tsx - 使用 IPC 转换为 PDF
- [x] ExcelViewer.tsx - 使用 IPC 转换为 PDF
- [x] PDF 缓存机制（5 分钟超时）

## 测试场景矩阵

| 文件类型 | LibreOffice 未安装 | LibreOffice 已安装 |
|----------|-------------------|-------------------|
| .txt, .js, .ts | 代码预览 | 代码预览 |
| .md | Markdown 预览 | Markdown 预览 |
| .png, .jpg | 图片预览 | 图片预览 |
| .pdf | PDF 预览 | PDF 预览 |
| .csv | Excel 预览 | Excel 预览 |
| .doc, .docx | 代码预览（降级） | PDF 预览 |
| .ppt, .pptx | 代码预览（降级） | PDF 预览 |
| .xls, .xlsx | 代码预览（降级） | PDF 预览 |

## 当前系统状态

```
LibreOffice: ✅ 已安装
  路径：/Applications/LibreOffice.app/Contents/MacOS/soffice
  版本：LibreOffice 26.2.1.2
```

测试结果显示 PDF 转换功能正常工作。

## 清理测试文件

```bash
# 删除测试脚本（可选）
rm test-libreoffice.ts
```

## 故障排除

### LibreOffice 已安装但检测不到

1. 检查 LibreOffice 是否在 PATH 中：
   ```bash
   which soffice
   ```

2. macOS 常见路径：
   ```bash
   /Applications/LibreOffice.app/Contents/MacOS/soffice
   ```

3. 手动添加到 PATH：
   ```bash
   export PATH="/Applications/LibreOffice.app/Contents/MacOS:$PATH"
   ```

### 转换失败

1. 检查文件权限：
   ```bash
   ls -la your-file.docx
   ```

2. 检查 LibreOffice 版本：
   ```bash
   soffice --version
   ```

3. 查看详细错误日志：
   ```bash
   soffice --headless --convert-to pdf your-file.docx 2>&1
   ```

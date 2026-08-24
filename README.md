<p align="center">
  <img src="assets/logo2.svg" width="400" alt="DHI Taxonomic Notebook Logo">
</p>

<h1 align="center">
DHI Taxonomic Notebook / 虹蘅馆分类学笔记
</h1>

<p align="center">

  <img alt="Version" src="https://img.shields.io/badge/version-v1.3.1-blue">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Browser-orange">
  <img alt="Offline" src="https://img.shields.io/badge/offline-Yes-success">

</p>

<p align="center">
<b>Latest Release: v1.3.1</b><br>
Taxonomic Comparison & Research Workflow Expansion
</p>

<p align="center">
  <a href="https://Domus-Herbarum-Iridescentium.github.io/DHI-Taxonomic-Notebook/">
    🌿点击体验在线版！
  </a>
</p>

A lightweight, offline-first taxonomy management and research notebook for naturalists and taxonomists.

一款专为分类学研究设计的轻量化、离线优先知识管理工具。

---

<p align="center">
  <img src="Screenshots/Overview.png" alt="Overview" width="90%">
</p>

## 项目简介

想系统整理一个分类群的层级关系？

想系统学习辨识属内物种？

想记录形态描述、分布、异名、文献和观察资料？

现有笔记工具要么过于笨重，要么难以适配分类学研究中的层级结构？

**DHI Taxonomic Notebook** 正是为此而生。

它是一款**开箱即用、纯前端、可视化、离线优先**的分类学笔记工具，让您能够建立和维护自己的分类学知识库。

无论你是：

- **学生**：梳理课程知识，整理实习和学习记录；
- **自然爱好者**：建立自己的物种观察与分类笔记；
- **研究者**：为编目、专著、志书和分类学研究积累素材；
- **团队协作者**：通过 JSON 文件交换和共享分类学数据；

DHI Taxonomic Notebook 都希望成为陪伴你积累分类学知识的一本数字笔记。

## 主要特点

### 开箱即用

下载项目文件并在浏览器中打开 `index.html` 即可运行，无需安装软件、配置服务器或搭建数据库。

### 离线优先

核心数据处理和存储均在浏览器本地完成。

分类数据和本地图片默认保存在浏览器的 localStorage 与 IndexedDB 中，不需要服务器即可使用。

### 分类树管理

支持创建多级分类树，可自由增删分类群、终端分类单元与研究笔记，并支持拖拽整理。

支持的终端分类等级包括：

- species
- nothospecies
- subspecies
- variety
- form
- cultivar

### 卡片式浏览

以卡片形式浏览分类群、终端分类单元和研究笔记，支持拖拽排序、层级导航和多种浏览方式。

<p align="center">
  <img src="Screenshots/Editing.gif" alt="Editing" width="90%">
</p>

### 结构化分类学资料

为终端分类单元提供结构化 Profile，可记录分类学信息、分布、生态、形态与讨论、参考文献、异名、词源、标本和图片等资料。

<p align="center">
  <img src="Screenshots/species.png" alt="Taxon Profile" width="65%">
</p>

### 分类单元对比

Comparison Mode 支持同时选择最多 4 个终端分类单元进行横向比较。

提供：

- **Parallel**：独立展示各分类单元；
- **Table**：按照相同章节自动对齐，便于比较分类学信息、分布、形态、参考文献和相册。

### Excel 批量导入

支持 `.xlsx` 和 `.xls` 文件批量导入分类数据。

可根据 Excel 中的学名、中文名、分类等级、分布等字段批量建立终端分类单元及其 Profile。

### Markdown 批量导出

支持将当前分类树子树或整个笔记本导出为 Markdown，并自动生成 ZIP 压缩包。

导出内容包括分类层级、Taxon Profile、文本资料及可导出的本地图片，并自动处理 Markdown 中的图片路径。

### 图片管理

支持：

- URL 图片；
- 剪贴板粘贴；
- 本地图片上传；
- 拖拽排序；
- 大图预览；
- 相册折叠与展开。

本地图片保存在 IndexedDB 中，不占用主要的 localStorage 空间。

### 富文本研究笔记

支持 Markdown 及受控 HTML 内容，可用于保存：

- 文献摘录；
- 分类讨论；
- 形态描述；
- 观察记录；
- 研究笔记。

### 数据导入与备份

支持完整 JSON 数据导出与导入。

JSON 备份包含分类树、Taxon Profile、文本内容以及本地图片，可用于：

- 数据备份；
- 数据迁移；
- 跨设备转移；
- 与他人共享分类学资料。

导入现有 JSON 数据时，可选择追加或替换当前内容。

---

## 快速开始

> DHI Taxonomic Notebook 是一个无需安装、以浏览器运行的离线优先应用。

### 方法一：在线体验

[https://Domus-Herbarum-Iridescentium.github.io/DHI-Taxonomic-Notebook/](https://Domus-Herbarum-Iridescentium.github.io/DHI-Taxonomic-Notebook/)

无需安装，打开即可体验。

> Note: Core data is stored locally in your browser and is not uploaded to a server.
>
> 注意：核心数据保存在浏览器本地，不会上传到服务器。

---

### 方法二：下载发行版（推荐）

1. 在 **Releases** 页面下载最新版本；
2. 解压 ZIP 压缩包；
3. 使用 Chrome、Edge 或 Firefox 打开 `index.html`；

即可开始使用。

---

### 方法三：Git 克隆

```bash
git clone https://github.com/Domus-Herbarum-Iridescentium/DHI-Taxonomic-Notebook.git
cd DHI-Taxonomic-Notebook
```

随后直接打开：

```text
index.html
```

即可运行。

---

### 浏览器支持

推荐使用最新版：

- Google Chrome
- Microsoft Edge
- Mozilla Firefox

不建议使用 Internet Explorer。

## 数据安全与备份

### 本地数据

DHI Taxonomic Notebook 不需要服务器来保存分类学数据。

- **localStorage**：保存应用状态及部分文本数据；
- **IndexedDB**：保存本地图片等较大的二进制资源。

### 导出备份

建议定期使用 **“导出 → 导出 JSON”** 创建完整数据备份。建议将 JSON 备份保存至云盘、外部硬盘或其他安全位置。

**重要提醒**：浏览器本地数据不会自动同步到其他浏览器或设备。  如果清除浏览器的网站数据、使用其他浏览器或更换设备，原有数据可能无法自动恢复。

### 导入恢复

通过 **“导入 → 导入 JSON”** 可以恢复已有的 JSON 数据。

如果当前笔记本已经包含数据，程序会提供2个选项：

- 追加新内容
- 替换当前内容

如不确定应该选择哪一种，建议先导出当前数据作为备份。

## 路线图

### v1.0.0

- 树状分类管理
- 卡片式浏览
- Markdown 笔记
- 图片管理（IndexedDB）
- 数据导入 / 导出（含图片）

### v1.1.0

- 编辑体验优化
- 分类路径（Breadcrumb）
- 分类群 / 物种搜索增强
- 拉丁学名与异名检索
- 图片浏览体验优化
- 异名列表管理
- 物种详情结构优化
- 衬线模式切换
- 拖拽系统优化
- 数据迁移与稳定性增强

### v1.2.0

- 独立分类学数据存储
- 统一分类群节点类型
- 灵活的分类等级系统
- 结构化的分布数据
- 物候记录与可视化
- 学名解析
- 关联参考文献与异名管理
- 高级分类检索
- 分类单元信息展示优化
- JSON 导入/导出及迁移系统优化

### v1.3.0
- 新增终端分类等级 nothospecies 和 cultivar
- 新增终端分类单元 Comparison Mode
- 支持最多 4 个分类单元进行并排比较
- 新增 Parallel 与 Table 两种对比布局
- 新增 Excel 批量导入
- 新增 Markdown 批量导出及 ZIP 打包
- 新增 Etymology 字段
- 新增 Specimens 列表
- 新增本地图片批量上传
- 改进相册折叠与展开
- 新增描述文本辅助整理工具
- 增强 JSON 追加导入与替换导入
- 改进图片资源生命周期管理
- 完成核心代码模块化重构
- 系统性修复多个用户输入渲染路径中的潜在 XSS 问题
- 修复多项数据一致性、图片加载及界面交互问题

### 后续计划

DHI Taxonomic Notebook 将继续以可靠性、数据一致性和研究工作流为重点进行迭代。

- 更完善的文献与引文管理
- 更丰富的分类关系处理
- 更强大的搜索与筛选
- 图片组织与标注
- 更完善的数据校验与迁移
- 更多面向分类学研究的工作流工具

## 协议

本项目采用 **MIT License** 开源。

详见 [LICENSE](LICENSE)。

## 致谢

本项目使用了以下优秀的开源项目：

- **marked.js** —— Markdown 渲染
- **Sortable.js** —— 拖拽排序
- **DOMPurify** —— HTML 内容清理与 XSS 防护
- **JSZip** —— ZIP 文件生成
- **SheetJS (xlsx)** —— Excel 文件解析

示例图片来源（仅用于演示）：

- PPBC 中国植物图像库
- iNaturalist
- 其他自然爱好者与园艺社群

## 反馈

欢迎提交 **Issue** 或 **Pull Request**。

如果您发现 Bug、希望增加新功能，或有任何改进建议，都欢迎在 GitHub 中提出。

## 常见问题

### 是否需要安装？

不需要。

DHI Taxonomic Notebook 是浏览器应用，下载发行版后直接打开 `index.html` 即可运行。

---

### 是否需要联网？

核心功能不需要联网。

数据默认保存在浏览器本地，不需要服务器。

如果使用外部 URL 图片或在线版，则可能需要网络连接。

---

### 图片保存在哪里？

本地图片主要保存在浏览器的 IndexedDB 中。

图片不会默认上传到服务器。

---

### 导出的 JSON 是否包含图片？

包含。

导出 JSON 时，IndexedDB 中保存的本地图片会被编码并写入 JSON，因此一个 JSON 文件即可完整备份分类数据和本地图片。

---

### 可以批量导入物种吗？

可以。

v1.3.1 支持 `.xlsx` 和 `.xls` 文件批量导入，可以根据表格字段创建分类单元及对应资料。

---

### 可以把分类数据导出成 Markdown 吗？

可以。

使用**导出 → 导出Markdown ZIP**，可以将当前分类树子树或整个笔记本导出为 Markdown，并打包为 ZIP 文件。

---

### 可以同时比较多个物种吗？

可以。

使用**物种对比**进入 Comparison Mode，最多可以选择 4 个终端分类单元进行比较。

---

### 是否支持移动端？

支持浏览和部分基础编辑功能，但建议使用桌面浏览器获得最佳体验。

---

<p align="center">
<b>Happy botanizing! 🌿</b><br>
</p>

<p align="center">
  <img src="assets/logo3.svg" width="400" alt="DHI Taxonomic Notebook Logo3">
</p>

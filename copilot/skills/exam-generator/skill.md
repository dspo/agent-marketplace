---
name: exam-generator
description: 试卷生成器 — 基于知识库生成专业试卷，支持多种题型、LaTeX 排版和 PDF 导出
---

# 试卷生成器 (Exam Generator)

这是一个用于生成专业试卷的 skill，支持多种题型、LaTeX 排版和 PDF 导出。

## 依赖检查

使用此 skill 前，请确保已安装 LaTeX 环境。

### 检查 LaTeX 环境

```bash
which xelatex || echo "xelatex NOT_FOUND"
xelatex --version 2>/dev/null | head -1
```

### 安装 LaTeX

**macOS:**
```bash
brew install --cask mactex
# 或精简版
brew install --cask basictex
export PATH="/Library/TeX/texbin:$PATH"
sudo tlmgr update --self
sudo tlmgr install ctex xecjk fancyhdr enumitem lastpage booktabs tabularx ulem tikz pifont
```

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install -y texlive-xetex texlive-lang-chinese texlive-fonts-recommended texlive-latex-extra
```

## 工作流程

### 1. 环境检查

```bash
which xelatex || echo "NOT_FOUND"
```

### 2. 准备知识库

用户需要准备该领域的知识库文档作为出题素材来源（Markdown、文本文件或已有题库）。

### 3. 定义试题约束

参考约束模板：`${COPILOT_PLUGIN_ROOT}/skills/exam-generator/examples/exam-constraints.md`

约束文档应定义：基本信息（名称、总分、时间）、题型分布（题量、分值、难度比例）、知识点覆盖要求。

### 4. 生成试题

根据知识库和约束，按以下步骤：
1. 分析知识库内容
2. 按照约束要求设计题目
3. 确保难度分布合理
4. 生成 LaTeX 格式的试卷

LaTeX 模板参考：`${COPILOT_PLUGIN_ROOT}/skills/exam-generator/templates/exam-template.tex`
答题卡模板参考：`${COPILOT_PLUGIN_ROOT}/skills/exam-generator/templates/answer-sheet-template.tex`

### 5. 编译 PDF

```bash
cd <试卷目录>
xelatex exam_A.tex
# 如果有交叉引用，需要编译两次
xelatex exam_A.tex
```

## LaTeX 模板说明

### 基本结构

```latex
\documentclass[11pt,a4paper]{article}
\usepackage[top=2cm,bottom=2cm,left=2.2cm,right=2.2cm]{geometry}
\usepackage{ctex}
\usepackage{listings}
\usepackage{xcolor}
\usepackage{enumitem}
\usepackage{fancyhdr}
\usepackage{lastpage}
\usepackage{booktabs}
\usepackage{tabularx}
\usepackage{ulem}
\usepackage{tikz}
\usepackage{amssymb}
\usepackage{pifont}
```

### 字体配置（macOS）

```latex
\setCJKmainfont{Songti SC}[BoldFont={Heiti SC}]
\setCJKsansfont{Heiti SC}
\setmainfont{Times New Roman}[BoldFont={Times New Roman Bold}]
\setmonofont{Menlo}[Scale=0.88]
```

### 选项列表环境

```latex
\newlist{choices}{enumerate}{1}
\setlist[choices]{label=\Alph*.,leftmargin=2.5em,labelsep=0.5em,nosep,topsep=0.3em,itemsep=0.1em}
```

## 常见问题

- **字体缺失**: `fc-list :lang=zh` 检查系统中文字体
- **宏包缺失**: `tlmgr install <package>` 安装
- **编码问题**: 确保文件为 UTF-8 编码

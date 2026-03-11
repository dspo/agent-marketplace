# 试卷生成器 (Exam Generator)

这是一个用于生成专业试卷的 skill，支持多种题型、LaTeX 排版和 PDF 导出。

## 依赖检查

使用此 skill 前，请确保已安装 LaTeX 环境。

### 检查 LaTeX 环境

```bash
# 检查 xelatex 是否安装
which xelatex || echo "xelatex NOT_FOUND"

# 检查版本
xelatex --version 2>/dev/null | head -1
```

### 安装 LaTeX

**macOS:**
```bash
# 推荐：安装完整版 MacTeX（约 4GB，包含所有宏包）
brew install --cask mactex

# 或者：安装精简版 BasicTeX（约 100MB，需要手动安装宏包）
brew install --cask basictex
# 安装后需要添加到 PATH
export PATH="/Library/TeX/texbin:$PATH"
# 然后安装必要宏包
sudo tlmgr update --self
sudo tlmgr install ctex xecjk fancyhdr enumitem lastpage booktabs tabularx ulem tikz pifont
```

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install -y texlive-xetex texlive-lang-chinese texlive-fonts-recommended texlive-latex-extra
```

**Windows:**
- 下载安装 [MiKTeX](https://miktex.org/download) 或 [TeX Live](https://www.tug.org/texlive/)

### 环境变量

| 变量 | 用途 | 必需 |
|------|-----|------|
| PATH | 需要包含 TeX 二进制文件路径 | 是 |

## 工作流程

### 1. 环境检查

在开始出题前，首先检查用户环境是否具备必要的依赖。

```bash
# 检查 LaTeX 环境
which xelatex || echo "NOT_FOUND"
```

如果 `xelatex` 不存在，引导用户按上述说明安装。

### 2. 准备知识库

用户需要准备该领域的知识库文档，作为出题的素材来源。知识库可以是：
- Markdown 文件（推荐）
- 文本文件
- 已有的题库

知识库应包含：
- 核心概念和原理
- 常见问题和陷阱
- 代码示例（如适用）
- 不同难度的知识点

### 3. 定义试题约束

创建一个约束文档（如 `exam-constraints.md`），定义：

```markdown
# 试题约束

## 基本信息
- 试卷名称：XXX 岗位笔试题
- 总分：100 分
- 考试时间：100 分钟

## 题型分布

| 题型 | 答题方法 | 题量 | 每题分值 | 总分值 | 简单 | 中等 | 困难 |
|------|----------|------|----------|--------|------|------|------|
| 单选 | 四选一 | 10 | 3 | 30 | 3 | 5 | 2 |
| 多选 | 多选（错选多选不得分） | 5 | 4 | 20 | 1 | 3 | 1 |
| 判断 | 正确/错误 | 10 | 2 | 20 | 3 | 5 | 2 |
| 简答 | 文字作答 | 3 | 10 | 30 | 0 | 2 | 1 |

## 知识点覆盖

| 知识点 | 题量要求 | 特别说明 |
|--------|----------|----------|
| 知识点A | >= 2 | |
| 知识点B | >= 1 | 不出现在简答题 |
| ... | | |

## 其他约束
- A/B/C 卷允许 30% 重复原题
- 模拟卷不允许出现原题
```

### 4. 生成试题

根据知识库和约束，Claude 会：
1. 分析知识库内容
2. 按照约束要求设计题目
3. 确保难度分布合理
4. 生成 LaTeX 格式的试卷

### 5. 编译 PDF

```bash
# 编译试卷
cd <试卷目录>
xelatex exam_A.tex

# 如果有交叉引用（如页码），需要编译两次
xelatex exam_A.tex
```

常见编译问题：
- **字体缺失**: 检查系统是否安装了所需字体（宋体、黑体等）
- **宏包缺失**: 使用 `tlmgr install <package>` 安装
- **编码问题**: 确保文件为 UTF-8 编码

## LaTeX 模板说明

### 试卷模板结构

```latex
\documentclass[11pt,a4paper]{article}

% 页面设置
\usepackage[top=2cm,bottom=2cm,left=2.2cm,right=2.2cm]{geometry}

% 中文支持
\usepackage{ctex}

% 代码高亮（如需要）
\usepackage{listings}
\usepackage{xcolor}

% 列表和枚举
\usepackage{enumitem}

% 页眉页脚
\usepackage{fancyhdr}
\usepackage{lastpage}

% 表格
\usepackage{booktabs}
\usepackage{tabularx}

% 其他
\usepackage{ulem}      % 下划线
\usepackage{tikz}      % 绘图
\usepackage{amssymb}   % 数学符号
\usepackage{pifont}    % 特殊符号（如 checkmark cross）
```

### 字体配置（macOS）

```latex
\setCJKmainfont{Songti SC}[BoldFont={Heiti SC}]
\setCJKsansfont{Heiti SC}
\setmainfont{Times New Roman}[BoldFont={Times New Roman Bold}]
\setmonofont{Menlo}[Scale=0.88]
```

### 字体配置（Windows）

```latex
\setCJKmainfont{SimSun}[BoldFont={SimHei}]
\setCJKsansfont{SimHei}
\setmainfont{Times New Roman}
\setmonofont{Consolas}[Scale=0.88]
```

### 字体配置（Linux）

```latex
\setCJKmainfont{Noto Serif CJK SC}[BoldFont={Noto Sans CJK SC}]
\setCJKsansfont{Noto Sans CJK SC}
\setmainfont{DejaVu Serif}
\setmonofont{DejaVu Sans Mono}[Scale=0.88]
```

### 选项列表环境

```latex
% 定义选择题选项环境
\newlist{choices}{enumerate}{1}
\setlist[choices]{label=\Alph*.,leftmargin=2.5em,labelsep=0.5em,nosep,topsep=0.3em,itemsep=0.1em}

% 使用示例
\begin{choices}
\item 选项 A
\item 选项 B
\item 选项 C
\item 选项 D
\end{choices}
```

### 判断题格式

```latex
% 定义判断题空格
\newcommand{\tfblank}{\makebox[2em]{\rule[-0.3ex]{1.5em}{0.4pt}}}

% 使用示例
\noindent(\hspace{1.5em})\enspace\textbf{1.} 这是一个判断题的陈述。
```

### 简答题答题区

```latex
% 定义答题空白区域（参数为行数）
\newcommand{\answerlines}[1]{%
  \par\vspace{\dimexpr #1\baselineskip + 0.5em\relax}%
}

% 使用示例
\noindent\textbf{1.}（10 分）请简述 XXX 的原理。
\answerlines{8}
```

### 代码块（编程类试卷）

```latex
% 定义代码语言（以 Go 为例）
\lstdefinelanguage{Go}{
  keywords={break,case,const,continue,default,defer,else,for,func,go,
    if,import,interface,map,package,range,return,select,struct,switch,
    type,var,nil,true,false,make,new,len,cap,append},
  sensitive=true,
  morecomment=[l]{//},
  morecomment=[s]{/*}{*/},
  morestring=[b]",
  morestring=[b]`,
}

% 代码样式
\lstset{
  language=Go,
  basicstyle=\ttfamily\small,
  keywordstyle=\color{blue}\bfseries,
  commentstyle=\color{green!60!black}\itshape,
  stringstyle=\color{red!80!black},
  backgroundcolor=\color{gray!10},
  frame=single,
  breaklines=true,
  tabsize=4,
  showstringspaces=false,
}

% 使用示例
\begin{lstlisting}
func main() {
    fmt.Println("Hello, World!")
}
\end{lstlisting}
```

## 题目格式规范

### 单选题

```latex
\noindent(\hspace{1.5em})\enspace\textbf{1.} 题目内容？

\begin{choices}
\item 选项 A
\item 选项 B
\item 选项 C
\item 选项 D
\end{choices}
```

### 多选题

```latex
\noindent(\hspace{1.5em})\enspace\textbf{1.} 以下哪些说法是正确的？

\begin{choices}
\item 选项 A
\item 选项 B
\item 选项 C
\item 选项 D
\end{choices}
```

### 判断题

```latex
\noindent(\hspace{1.5em})\enspace\textbf{1.} 这是一个需要判断正误的陈述。
```

### 简答题

```latex
\noindent\textbf{1.}（10 分）问题描述。

\par\noindent（1）小问 1（3 分）
\answerlines{4}

\par\noindent（2）小问 2（4 分）
\answerlines{5}

\par\noindent（3）小问 3（3 分）
\answerlines{4}
```

## 参考答案格式

在试卷末尾或单独文件中提供参考答案：

```latex
\newpage
\subsection*{参考答案}

\subsubsection*{一、单选题}
1. \textbf{A} — 解析说明。
2. \textbf{C} — 解析说明。

\subsubsection*{二、多选题}
1. \textbf{A, B, D} — 解析说明。

\subsubsection*{三、判断题}
1. \textbf{$\checkmark$} — 解析说明。
2. \textbf{\ding{55}} — 解析说明。

\subsubsection*{四、简答题}
\textbf{1.}
答案要点：
\par\noindent\hspace{1em}$\bullet$ 要点 1
\par\noindent\hspace{1em}$\bullet$ 要点 2
```

## 快速开始示例

假设用户说："帮我出一套 Python 基础的试卷"

**步骤 1**: 检查环境
```bash
which xelatex
```

**步骤 2**: 询问试卷要求
- 总分多少？
- 考试时间多长？
- 需要哪些题型？
- 有没有特定的知识点要求？
- 是否需要代码题？

**步骤 3**: 根据要求生成 LaTeX 文件

**步骤 4**: 编译并验证
```bash
xelatex exam.tex
```

## 常见问题

### Q: 编译时提示字体找不到？

检查系统字体：
```bash
# macOS
fc-list :lang=zh

# Linux
fc-list :lang=zh-cn
```

### Q: 代码块中的特殊字符显示异常？

在 lstlisting 中使用 `escapeinside` 转义：
```latex
\lstset{escapeinside={(*}{*)}}

% 在代码中使用
for i := 0; i < 10; i++ { // (*\color{gray}循环10次*)
}
```

### Q: 如何调整页边距？

```latex
\usepackage[top=2cm,bottom=2cm,left=2cm,right=2cm]{geometry}
```

### Q: 如何添加水印？

```latex
\usepackage{draftwatermark}
\SetWatermarkText{内部资料}
\SetWatermarkScale{0.5}
\SetWatermarkColor[gray]{0.9}
```

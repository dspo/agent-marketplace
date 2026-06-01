package main

import (
	"bufio"
	"bytes"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type finding struct {
	Severity string // bug, spec-pitfall, note
	Code     string
	File     string
	Line     int
	Column   int
	Message  string
	Snippet  string
}

type loopContext struct {
	Kind         string // for, range
	Vars         []string
	PerIteration bool
}

type analyzer struct {
	fset       *token.FileSet
	filename   string
	lines      []string
	loopStack  []loopContext
	enterStack []bool
	findings   []finding
	loopVarSem loopVarSemantics
}

type loopVarSemantics struct {
	GoDirective string
	PerIterVars bool // true if Go >= 1.22
}

func main() {
	var repo string
	var base string
	var head string
	var maxFiles int
	var maxFindings int
	var includeTests bool

	var paths multiString
	flag.StringVar(&repo, "repo", ".", "Repo/module directory to scan")
	flag.StringVar(&base, "base", "", "Git base ref for diff (e.g. origin/main). If set, scan changed Go files only")
	flag.StringVar(&head, "head", "HEAD", "Git head ref for diff (default HEAD)")
	flag.IntVar(&maxFiles, "max-files", 200, "Max files to scan when using --base")
	flag.IntVar(&maxFindings, "max-findings", 200, "Max findings to print")
	flag.BoolVar(&includeTests, "include-tests", true, "Include *_test.go files")
	flag.Var(&paths, "path", "Relative Go file to scan (repeatable). If set, overrides --base and full scan")
	flag.Parse()

	absRepo, err := filepath.Abs(repo)
	must(err)

	sem := loopVarSemanticsFromRepo(absRepo)

	files := resolveFiles(absRepo, base, head, maxFiles, paths)
	if !includeTests {
		filtered := files[:0]
		for _, f := range files {
			if !strings.HasSuffix(f, "_test.go") {
				filtered = append(filtered, f)
			}
		}
		files = filtered
	}

	fmt.Println("## Spec risk sweep (heuristics)")
	fmt.Println()
	fmt.Printf("- Repo: `%s`\n", absRepo)
	if sem.GoDirective != "" {
		fmt.Printf("- `go` directive: `%s`\n", sem.GoDirective)
	}
	fmt.Printf("- Loop var semantics: `%s`\n", loopVarSemanticsLabel(sem))
	if base != "" {
		fmt.Printf("- File selection: `git diff %s...%s` (Go files: %d)\n", base, head, len(files))
	} else if len(paths) > 0 {
		fmt.Printf("- File selection: `--path` (Go files: %d)\n", len(files))
	} else {
		fmt.Printf("- File selection: full scan (Go files: %d)\n", len(files))
	}
	fmt.Println()

	var all []finding
	for _, rel := range files {
		full := filepath.Join(absRepo, rel)
		fs := token.NewFileSet()
		f, err := parser.ParseFile(fs, full, nil, parser.ParseComments)
		if err != nil {
			all = append(all, finding{
				Severity: "note",
				Code:     "parse-error",
				File:     rel,
				Message:  fmt.Sprintf("failed to parse: %v", err),
			})
			continue
		}

		lines, _ := readLines(full)
		a := &analyzer{
			fset:       fs,
			filename:   rel,
			lines:      lines,
			loopVarSem: sem,
		}
		a.scanRegexFindings(rel, lines)
		ast.Walk(a, f)
		all = append(all, a.findings...)
		if maxFindings > 0 && len(all) >= maxFindings {
			break
		}
	}

	printFindings(all, maxFindings)
	if hasBug(all) {
		os.Exit(2)
	}
}

func loopVarSemanticsFromRepo(repo string) loopVarSemantics {
	gomodPath := strings.TrimSpace(runCmdTrimmed(repo, "go", "env", "GOMOD"))
	if gomodPath == "" || gomodPath == "/dev/null" {
		return loopVarSemantics{}
	}
	goDirective := parseGoDirective(gomodPath)
	perIter := isGo122OrNewer(goDirective)
	return loopVarSemantics{GoDirective: goDirective, PerIterVars: perIter}
}

func loopVarSemanticsLabel(s loopVarSemantics) string {
	if s.GoDirective == "" {
		return "unknown (assume pre-1.22)"
	}
	if s.PerIterVars {
		return "Go 1.22+ (vars declared by := are per-iteration)"
	}
	return "Go <=1.21 (loop vars may be reused)"
}

func parseGoDirective(gomodPath string) string {
	b, err := os.ReadFile(gomodPath)
	if err != nil {
		return ""
	}
	scanner := bufio.NewScanner(bytes.NewReader(b))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "go ") {
			return strings.TrimSpace(strings.TrimPrefix(line, "go "))
		}
	}
	return ""
}

func isGo122OrNewer(goDirective string) bool {
	major, minor, ok := parseMajorMinor(goDirective)
	if !ok {
		return false
	}
	return major > 1 || (major == 1 && minor >= 22)
}

func parseMajorMinor(v string) (int, int, bool) {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0, 0, false
	}
	parts := strings.Split(v, ".")
	if len(parts) < 2 {
		return 0, 0, false
	}
	major, err1 := strconv.Atoi(parts[0])
	minor, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	return major, minor, true
}

type multiString []string

func (m *multiString) String() string {
	return strings.Join(*m, ",")
}

func (m *multiString) Set(s string) error {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	*m = append(*m, s)
	return nil
}

func resolveFiles(repo, base, head string, maxFiles int, paths []string) []string {
	if len(paths) > 0 {
		var out []string
		for _, p := range paths {
			p = strings.TrimSpace(p)
			if p == "" || !strings.HasSuffix(p, ".go") {
				continue
			}
			full := filepath.Join(repo, p)
			if _, err := os.Stat(full); err == nil {
				out = append(out, p)
			}
		}
		return out
	}

	if base != "" && isGitWorktree(repo) {
		return gitChangedGoFiles(repo, base, head, maxFiles)
	}

	return allGoFiles(repo)
}

func isGitWorktree(dir string) bool {
	if _, err := exec.LookPath("git"); err != nil {
		return false
	}
	return runCmdTrimmed(dir, "git", "rev-parse", "--is-inside-work-tree") == "true"
}

func gitChangedGoFiles(dir, base, head string, maxFiles int) []string {
	out := runCmdTrimmed(dir, "git", "diff", "--name-only", "--diff-filter=ACMRTUXB", fmt.Sprintf("%s...%s", base, head))
	if out == "" {
		return nil
	}
	var files []string
	scanner := bufio.NewScanner(bytes.NewBufferString(out))
	for scanner.Scan() {
		p := strings.TrimSpace(scanner.Text())
		if p == "" || !strings.HasSuffix(p, ".go") {
			continue
		}
		if _, err := os.Stat(filepath.Join(dir, p)); err != nil {
			continue
		}
		files = append(files, p)
		if maxFiles > 0 && len(files) >= maxFiles {
			break
		}
	}
	return files
}

func allGoFiles(repo string) []string {
	var files []string
	_ = filepath.WalkDir(repo, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			switch name {
			case ".git", "vendor", "node_modules", "dist", "build", "out":
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		rel, err := filepath.Rel(repo, path)
		if err != nil {
			return nil
		}
		files = append(files, rel)
		return nil
	})
	sort.Strings(files)
	return files
}

func readLines(path string) ([]string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	s := strings.ReplaceAll(string(b), "\r\n", "\n")
	return strings.Split(s, "\n"), nil
}

func printFindings(all []finding, max int) {
	sort.SliceStable(all, func(i, j int) bool {
		if all[i].Severity != all[j].Severity {
			return severityRank(all[i].Severity) < severityRank(all[j].Severity)
		}
		if all[i].File != all[j].File {
			return all[i].File < all[j].File
		}
		if all[i].Line != all[j].Line {
			return all[i].Line < all[j].Line
		}
		return all[i].Column < all[j].Column
	})

	grouped := map[string][]finding{}
	order := []string{"bug", "spec-pitfall", "note"}
	for _, f := range all {
		grouped[f.Severity] = append(grouped[f.Severity], f)
	}

	printed := 0
	for _, sev := range order {
		list := grouped[sev]
		if len(list) == 0 {
			continue
		}
		fmt.Printf("### %s (%d)\n", sev, len(list))
		for _, f := range list {
			fmt.Printf("- `%s`: `%s:%d:%d` %s\n", f.Code, f.File, f.Line, f.Column, f.Message)
			if strings.TrimSpace(f.Snippet) != "" {
				fmt.Printf("  - `%s`\n", strings.TrimSpace(f.Snippet))
			}
			printed++
			if max > 0 && printed >= max {
				fmt.Printf("\n(truncated at %d findings)\n", max)
				return
			}
		}
		fmt.Println()
	}

	if printed == 0 {
		fmt.Println("No findings.")
	}
}

func severityRank(sev string) int {
	switch sev {
	case "bug":
		return 0
	case "spec-pitfall":
		return 1
	default:
		return 2
	}
}

func hasBug(all []finding) bool {
	for _, f := range all {
		if f.Severity == "bug" {
			return true
		}
	}
	return false
}

func runCmdTrimmed(dir string, name string, args ...string) string {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func must(err error) {
	if err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func (a *analyzer) Visit(node ast.Node) ast.Visitor {
	if node == nil {
		if len(a.enterStack) == 0 {
			return a
		}
		pushed := a.enterStack[len(a.enterStack)-1]
		a.enterStack = a.enterStack[:len(a.enterStack)-1]
		if pushed && len(a.loopStack) > 0 {
			a.loopStack = a.loopStack[:len(a.loopStack)-1]
		}
		return a
	}

	pushedLoop := false
	switch n := node.(type) {
	case *ast.RangeStmt:
		ctx := rangeContext(n, a.loopVarSem)
		if len(ctx.Vars) > 0 {
			a.loopStack = append(a.loopStack, ctx)
			pushedLoop = true
		}
	case *ast.ForStmt:
		ctx := forContext(n, a.loopVarSem)
		if len(ctx.Vars) > 0 {
			a.loopStack = append(a.loopStack, ctx)
			pushedLoop = true
		}
	}
	a.enterStack = append(a.enterStack, pushedLoop)

	if len(a.loopStack) == 0 {
		return a
	}

	switch n := node.(type) {
	case *ast.UnaryExpr:
		a.checkAddrOfLoopVar(n)
	case *ast.GoStmt:
		a.checkAsyncFuncLit("go", n.Call)
	case *ast.DeferStmt:
		a.checkAsyncFuncLit("defer", n.Call)
	case *ast.CallExpr:
		a.checkKnownAsyncCalls(n)
	}

	return a
}

func rangeContext(n *ast.RangeStmt, sem loopVarSemantics) loopContext {
	var vars []string
	if id, ok := n.Key.(*ast.Ident); ok && id.Name != "_" {
		vars = append(vars, id.Name)
	}
	if id, ok := n.Value.(*ast.Ident); ok && id.Name != "_" {
		vars = append(vars, id.Name)
	}

	perIter := sem.PerIterVars && n.Tok == token.DEFINE
	return loopContext{
		Kind:         "range",
		Vars:         vars,
		PerIteration: perIter,
	}
}

func forContext(n *ast.ForStmt, sem loopVarSemantics) loopContext {
	var vars []string
	assign, ok := n.Init.(*ast.AssignStmt)
	if ok {
		for _, lhs := range assign.Lhs {
			if id, ok := lhs.(*ast.Ident); ok && id.Name != "_" {
				vars = append(vars, id.Name)
			}
		}
	}
	perIter := sem.PerIterVars && ok && assign.Tok == token.DEFINE
	return loopContext{
		Kind:         "for",
		Vars:         vars,
		PerIteration: perIter,
	}
}

func (a *analyzer) checkAddrOfLoopVar(n *ast.UnaryExpr) {
	if n.Op != token.AND {
		return
	}
	id := unwrapIdent(n.X)
	if id == nil || id.Name == "_" {
		return
	}
	ctx, ok := a.nearestLoopVarContext(id.Name)
	if !ok {
		return
	}

	sev := "bug"
	msg := fmt.Sprintf("taking address of loop variable `%s` inside %s loop", id.Name, ctx.Kind)
	if ctx.PerIteration {
		sev = "note"
		msg += " (Go 1.22+ per-iteration vars if declared by :=)"
	}
	a.addFinding(n.Pos(), sev, "loop-var-address", msg)
}

func (a *analyzer) checkAsyncFuncLit(kind string, call *ast.CallExpr) {
	if call == nil {
		return
	}
	flit, ok := call.Fun.(*ast.FuncLit)
	if !ok || flit.Body == nil {
		return
	}
	captured := funcLitCaptures(flit, a.allLoopVars())
	if len(captured) == 0 {
		return
	}

	sev := "bug"
	msg := fmt.Sprintf("%s func literal captures loop var(s) %s", kind, backtickList(captured))
	if allCapturedPerIteration(captured, a) {
		sev = "note"
		msg += " (Go 1.22+ per-iteration vars if declared by :=)"
	}
	a.addFinding(call.Pos(), sev, "loop-var-capture-"+kind, msg)
}

func (a *analyzer) checkKnownAsyncCalls(call *ast.CallExpr) {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || sel.Sel == nil {
		return
	}
	method := sel.Sel.Name
	if method != "Run" && method != "Go" {
		return
	}

	for _, arg := range call.Args {
		flit, ok := arg.(*ast.FuncLit)
		if !ok {
			continue
		}
		captured := funcLitCaptures(flit, a.allLoopVars())
		if len(captured) == 0 {
			continue
		}

		sev := "spec-pitfall"
		code := "loop-var-capture-call"
		msg := fmt.Sprintf("func literal passed to `.%s` captures loop var(s) %s", method, backtickList(captured))
		if method == "Run" && funcLitHasParallelCall(flit) {
			code = "loop-var-capture-t-run-parallel"
			msg += " (contains `.Parallel()`)"
		}
		if method == "Go" {
			code = "loop-var-capture-errgroup-go"
			sev = "bug"
		}
		if allCapturedPerIteration(captured, a) {
			sev = "note"
			msg += " (Go 1.22+ per-iteration vars if declared by :=)"
		}
		a.addFinding(call.Pos(), sev, code, msg)
	}
}

func (a *analyzer) addFinding(pos token.Pos, sev, code, msg string) {
	p := a.fset.Position(pos)
	snippet := ""
	if p.Line > 0 && p.Line-1 < len(a.lines) {
		snippet = a.lines[p.Line-1]
	}
	a.findings = append(a.findings, finding{
		Severity: sev,
		Code:     code,
		File:     a.filename,
		Line:     p.Line,
		Column:   p.Column,
		Message:  msg,
		Snippet:  snippet,
	})
}

func (a *analyzer) nearestLoopVarContext(name string) (loopContext, bool) {
	for i := len(a.loopStack) - 1; i >= 0; i-- {
		ctx := a.loopStack[i]
		for _, v := range ctx.Vars {
			if v == name {
				return ctx, true
			}
		}
	}
	return loopContext{}, false
}

func (a *analyzer) allLoopVars() map[string]struct{} {
	out := make(map[string]struct{})
	for _, ctx := range a.loopStack {
		for _, v := range ctx.Vars {
			out[v] = struct{}{}
		}
	}
	return out
}

func allCapturedPerIteration(captured []string, a *analyzer) bool {
	for _, name := range captured {
		ctx, ok := a.nearestLoopVarContext(name)
		if !ok || !ctx.PerIteration {
			return false
		}
	}
	return true
}

func unwrapIdent(expr ast.Expr) *ast.Ident {
	switch x := expr.(type) {
	case *ast.Ident:
		return x
	case *ast.ParenExpr:
		return unwrapIdent(x.X)
	default:
		return nil
	}
}

func funcLitCaptures(f *ast.FuncLit, names map[string]struct{}) []string {
	if f == nil || f.Body == nil || len(names) == 0 {
		return nil
	}
	params := map[string]struct{}{}
	if f.Type != nil && f.Type.Params != nil {
		for _, field := range f.Type.Params.List {
			for _, n := range field.Names {
				if n != nil && n.Name != "_" {
					params[n.Name] = struct{}{}
				}
			}
		}
	}

	captured := map[string]struct{}{}
	ast.Inspect(f.Body, func(n ast.Node) bool {
		id, ok := n.(*ast.Ident)
		if !ok || id.Name == "_" {
			return true
		}
		if _, want := names[id.Name]; !want {
			return true
		}
		if _, isParam := params[id.Name]; isParam {
			return true
		}
		captured[id.Name] = struct{}{}
		return true
	})

	if len(captured) == 0 {
		return nil
	}
	out := make([]string, 0, len(captured))
	for name := range captured {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func funcLitHasParallelCall(f *ast.FuncLit) bool {
	found := false
	ast.Inspect(f.Body, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || sel.Sel == nil {
			return true
		}
		if sel.Sel.Name == "Parallel" {
			found = true
			return false
		}
		return true
	})
	return found
}

func backtickList(items []string) string {
	if len(items) == 0 {
		return "`[]`"
	}
	var b strings.Builder
	b.WriteString("`[")
	for i, s := range items {
		if i > 0 {
			b.WriteString(", ")
		}
		b.WriteString(s)
	}
	b.WriteString("]`")
	return b.String()
}

func (a *analyzer) scanRegexFindings(rel string, lines []string) {
	typedNil := regexp.MustCompile(`\\(\\s*\\*[^)]+\\)\\s*\\(\\s*nil\\s*\\)`)
	closeNil := regexp.MustCompile(`\\bclose\\s*\\(\\s*nil\\s*\\)`)

	for i, line := range lines {
		ln := i + 1
		if typedNil.FindStringIndex(line) != nil {
			a.findings = append(a.findings, finding{
				Severity: "spec-pitfall",
				Code:     "typed-nil-conversion",
				File:     rel,
				Line:     ln,
				Column:   1,
				Message:  "typed nil conversion like `(*T)(nil)` can produce a non-nil interface; double-check intent (spec: Interface types; Assignments)",
				Snippet:  line,
			})
		}
		if closeNil.FindStringIndex(line) != nil {
			a.findings = append(a.findings, finding{
				Severity: "bug",
				Code:     "close-nil",
				File:     rel,
				Line:     ln,
				Column:   1,
				Message:  "`close(nil)` panics (spec: Built-in functions)",
				Snippet:  line,
			})
		}
	}
}

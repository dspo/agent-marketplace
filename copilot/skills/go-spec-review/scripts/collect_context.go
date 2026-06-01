package main

import (
	"bufio"
	"bytes"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

type goModInfo struct {
	Path      string
	Module    string
	Go        string
	Toolchain string
}

func main() {
	var repo string
	var base string
	var head string
	var maxFiles int

	flag.StringVar(&repo, "repo", ".", "Repo/module directory to inspect")
	flag.StringVar(&base, "base", "", "Git base ref for diff (e.g. origin/main). If set, list changed Go files and scan build tags")
	flag.StringVar(&head, "head", "HEAD", "Git head ref for diff (default HEAD)")
	flag.IntVar(&maxFiles, "max-files", 200, "Max changed files to list")
	flag.Parse()

	absRepo, err := filepath.Abs(repo)
	must(err)

	goPath, _ := exec.LookPath("go")
	goVersion := runCmdTrimmed(absRepo, "go", "version")
	if goVersion == "" {
		goVersion = "<failed to run `go version`>"
	}

	gomodPath := strings.TrimSpace(runCmdTrimmed(absRepo, "go", "env", "GOMOD"))
	gomod := parseGoMod(gomodPath)

	git := collectGit(absRepo)

	var changedGoFiles []string
	var buildTags map[string]int
	if base != "" && git.InWorktree {
		changedGoFiles = gitChangedGoFiles(absRepo, base, head, maxFiles)
		buildTags = scanBuildTags(absRepo, changedGoFiles)
	}

	fmt.Println("## Go context")
	fmt.Println()
	fmt.Printf("- Repo: `%s`\n", absRepo)
	if goPath != "" {
		fmt.Printf("- `go` binary: `%s`\n", goPath)
	}
	fmt.Printf("- Go toolchain: `%s`\n", oneLine(goVersion))
	if gomod.Path != "" {
		fmt.Printf("- `go env GOMOD`: `%s`\n", gomod.Path)
	}
	if gomod.Module != "" {
		fmt.Printf("- Module: `%s`\n", gomod.Module)
	}
	if gomod.Go != "" {
		fmt.Printf("- `go` directive: `%s`\n", gomod.Go)
	}
	if gomod.Toolchain != "" {
		fmt.Printf("- `toolchain` directive: `%s`\n", gomod.Toolchain)
	}

	if git.InWorktree {
		fmt.Printf("- Git: branch `%s`, HEAD `%s`, dirty `%v`\n", git.Branch, git.Head, git.Dirty)
	}

	if base != "" {
		if !git.InWorktree {
			fmt.Printf("- Diff: (skipped) not a git worktree\n")
		} else {
			fmt.Printf("- Diff: `%s...%s` (Go files: %d)\n", base, head, len(changedGoFiles))
			for _, p := range changedGoFiles {
				fmt.Printf("  - `%s`\n", p)
			}
			if len(buildTags) > 0 {
				fmt.Println("- Build tags found in changed files:")
				tags := make([]string, 0, len(buildTags))
				for tag := range buildTags {
					tags = append(tags, tag)
				}
				sort.Strings(tags)
				for _, tag := range tags {
					fmt.Printf("  - `%s` (x%d)\n", tag, buildTags[tag])
				}
			}
		}
	}
}

func must(err error) {
	if err != nil {
		fatal(err)
	}
}

func fatal(err error) {
	_, _ = fmt.Fprintf(os.Stderr, "error: %v\n", err)
	os.Exit(1)
}

func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
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

func parseGoMod(gomodPath string) goModInfo {
	if gomodPath == "" || gomodPath == "/dev/null" {
		return goModInfo{}
	}
	if _, err := os.Stat(gomodPath); err != nil {
		return goModInfo{}
	}

	f, err := os.Open(gomodPath)
	if err != nil {
		return goModInfo{}
	}
	defer f.Close()

	info := goModInfo{Path: gomodPath}
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "//") {
			continue
		}
		if strings.HasPrefix(line, "module ") && info.Module == "" {
			info.Module = strings.TrimSpace(strings.TrimPrefix(line, "module "))
			continue
		}
		if strings.HasPrefix(line, "go ") && info.Go == "" {
			info.Go = strings.TrimSpace(strings.TrimPrefix(line, "go "))
			continue
		}
		if strings.HasPrefix(line, "toolchain ") && info.Toolchain == "" {
			info.Toolchain = strings.TrimSpace(strings.TrimPrefix(line, "toolchain "))
			continue
		}
		if info.Module != "" && info.Go != "" && info.Toolchain != "" {
			break
		}
	}
	return info
}

type gitInfo struct {
	InWorktree bool
	Branch     string
	Head       string
	Dirty      bool
}

func collectGit(dir string) gitInfo {
	if _, err := exec.LookPath("git"); err != nil {
		return gitInfo{}
	}

	inside := runCmdTrimmed(dir, "git", "rev-parse", "--is-inside-work-tree")
	if inside != "true" {
		return gitInfo{}
	}

	branch := runCmdTrimmed(dir, "git", "rev-parse", "--abbrev-ref", "HEAD")
	head := runCmdTrimmed(dir, "git", "rev-parse", "HEAD")
	status := runCmdTrimmed(dir, "git", "status", "--porcelain")

	return gitInfo{
		InWorktree: true,
		Branch:     branch,
		Head:       head,
		Dirty:      strings.TrimSpace(status) != "",
	}
}

func gitChangedGoFiles(dir, base, head string, maxFiles int) []string {
	if base == "" {
		return nil
	}

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

func scanBuildTags(repo string, relPaths []string) map[string]int {
	if len(relPaths) == 0 {
		return nil
	}
	tags := make(map[string]int)
	for _, rel := range relPaths {
		full := filepath.Join(repo, rel)
		f, err := os.Open(full)
		if err != nil {
			continue
		}

		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if strings.HasPrefix(line, "//go:build") {
				expr := strings.TrimSpace(strings.TrimPrefix(line, "//go:build"))
				if expr != "" {
					tags[expr]++
				}
				continue
			}
			if strings.HasPrefix(line, "// +build") {
				expr := strings.TrimSpace(strings.TrimPrefix(line, "// +build"))
				if expr != "" {
					tags["(+build) "+expr]++
				}
				continue
			}
		}
		_ = f.Close()
	}
	if len(tags) == 0 {
		return nil
	}
	return tags
}

var errCmdFailed = errors.New("command failed")

func runCmd(dir, name string, args ...string) ([]byte, error) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return out, fmt.Errorf("%w: %s %s: %s", errCmdFailed, name, strings.Join(args, " "), strings.TrimSpace(string(out)))
	}
	return out, nil
}

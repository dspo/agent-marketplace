package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type step struct {
	Name string
	Args []string
	Soft bool // if true, skip when missing from PATH
}

func main() {
	var repo string
	var packages string
	var skipTests bool
	var skipVet bool
	var tryStaticcheck bool
	var tryGolangciLint bool
	var continueOnError bool

	flag.StringVar(&repo, "repo", ".", "Repo/module directory to run checks in")
	flag.StringVar(&packages, "packages", "./...", "Packages pattern (e.g. ./..., ./pkg/...)")
	flag.BoolVar(&skipTests, "skip-tests", false, "Skip `go test`")
	flag.BoolVar(&skipVet, "skip-vet", false, "Skip `go vet`")
	flag.BoolVar(&tryStaticcheck, "try-staticcheck", true, "Run staticcheck if found in PATH")
	flag.BoolVar(&tryGolangciLint, "try-golangci-lint", true, "Run golangci-lint if found in PATH")
	flag.BoolVar(&continueOnError, "continue", true, "Continue running steps after a failure")
	flag.Parse()

	absRepo, err := filepath.Abs(repo)
	must(err)

	var steps []step
	if !skipTests {
		steps = append(steps, step{Name: "go", Args: []string{"test", packages}})
	}
	if !skipVet {
		steps = append(steps, step{Name: "go", Args: []string{"vet", packages}})
	}
	if tryStaticcheck {
		steps = append(steps, step{Name: "staticcheck", Args: []string{packages}, Soft: true})
	}
	if tryGolangciLint {
		steps = append(steps, step{Name: "golangci-lint", Args: []string{"run"}, Soft: true})
	}

	fmt.Printf("## Light checks\n\n- Repo: `%s`\n- Packages: `%s`\n\n", absRepo, packages)

	failed := false
	for _, s := range steps {
		if s.Soft {
			if _, err := exec.LookPath(s.Name); err != nil {
				fmt.Printf("$ %s %s (skipped: not found)\n\n", s.Name, strings.Join(s.Args, " "))
				continue
			}
		}

		fmt.Printf("$ %s %s\n", s.Name, strings.Join(s.Args, " "))
		cmd := exec.Command(s.Name, s.Args...)
		cmd.Dir = absRepo
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		err := cmd.Run()
		fmt.Println()

		if err != nil {
			failed = true
			fmt.Fprintf(os.Stderr, "step failed: %s %s: %v\n", s.Name, strings.Join(s.Args, " "), err)
			if !continueOnError {
				os.Exit(1)
			}
		}
	}

	if failed {
		os.Exit(1)
	}
}

func must(err error) {
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

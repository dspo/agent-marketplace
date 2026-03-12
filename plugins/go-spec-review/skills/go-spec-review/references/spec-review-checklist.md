# Go spec review checklist

Use this checklist to catch spec-level correctness issues and places where code depends on unspecified/nondeterministic behavior.

## How to use

- Prefer checking `go.mod` (`go` directive) to know which spec version/semantics apply.
- When flagging an issue, cite the spec by **section name** (search the spec page by heading/keyword).
- If the issue is **not** defined by the language spec (e.g. memory ordering), label it and reference the correct document (e.g. Go memory model).

## Quick red flags (high ROI)

- `nil` interface vs typed `nil` (spec: Interface types; Type assertions).
- Method sets / pointer vs value receivers (spec: Method sets; Method declarations; Calls).
- Taking the address of a `range` variable (spec: Range clause).
- Loop variable captured by closure (Go 1.22 changed semantics; spec: For statements; Range clause).
- `append`/slicing aliasing bugs (spec: Slice types; Slice expressions; Built-in functions).
- `defer` argument evaluation time, named returns, and `recover` behavior (spec: Defer statements; Return statements; Handling panics).
- Relying on map iteration order or `select` case order (spec: Range clause; Select statements).
- Channel close/send/receive edge cases (`close(nil)`, send on closed, receive from closed) (spec: Built-in functions; Send statements; Receive operator).

## Checklist by topic

### Declarations, scope, and shadowing

- Validate `:=` redeclaration rules and avoid unintended shadowing (spec: Short variable declarations; Declarations and scope).
- Watch `if`/`switch`/`for` init statements creating new scoped variables (spec: If statements; Switch statements; For statements).
- Confirm `iota` use matches the intended constant block behavior (spec: Constant declarations).

### Types, assignability, and conversions

- Distinguish **defined types** vs **type aliases** when APIs accept/return them (spec: Type declarations; Type identity).
- Confirm assignability rules around interfaces, pointers, and defined types (spec: Assignments; Interface types).
- Prefer explicit conversions when moving between `string`, `[]byte`, and `[]rune`; ensure the code understands “byte index” vs “rune iteration” (spec: String types; Conversions; Range clause).

### Interfaces, method sets, and embedding

- Ensure interface satisfaction is checked against the correct method set (`T` vs `*T`) (spec: Method sets; Interface types).
- Be explicit about `nil` interfaces:
  - `var r io.Reader = (*bytes.Reader)(nil)` is **not** `nil`.
  - Prefer returning a typed `nil` only when the caller expects it; otherwise return a `nil` interface explicitly.
- For embedded fields, confirm promotion/ambiguity behavior and avoid surprising method resolution (spec: Struct types; Method sets).

### Composite types: arrays, slices, maps, strings

#### Arrays vs slices

- Remember arrays copy on assignment/pass-by-value; slices are descriptors over an underlying array (spec: Array types; Slice types).
- Use full slice expressions (`a[low:high:max]`) when you must cap capacity to prevent accidental aliasing via `append` (spec: Slice expressions).
- Treat any pointer/index into a slice as potentially invalidated after `append` that may reallocate (spec: Built-in functions).

#### Maps

- Never rely on iteration order; treat it as unspecified and potentially varying between runs (spec: Range clause).
- Check nil-map behavior: reads are ok, writes panic (spec: Map types; Assignments).
- Ensure map keys are comparable (spec: Comparison operators; Map types).

#### Strings

- Indexing yields bytes; `range` iterates runes and returns byte indices (spec: String types; Index expressions; Range clause).
- Avoid slicing strings by rune count unless you convert to `[]rune` or use a safe iterator (spec: Slice expressions; Conversions).

### Expressions and evaluation order

- Avoid writing code that relies on subtle evaluation order with side effects; simplify to make the order obvious (spec: Order of evaluation).
- In multiple assignment, ensure side effects on the LHS don’t depend on sequencing (spec: Assignments; Order of evaluation).

### Control flow: `defer`, `panic`, `recover`, `switch`, `select`

- `defer` arguments are evaluated when the `defer` statement executes; deferred calls run LIFO (spec: Defer statements).
- `recover` only works when called directly by a deferred function in the same goroutine; otherwise it returns `nil` (spec: Handling panics).
- Avoid depending on `select` fairness or case ordering; treat ready-case choice as nondeterministic (spec: Select statements).

### Channels and concurrency primitives

- Confirm send/receive/close edge cases:
  - send on a closed channel panics
  - receive from a closed channel yields the zero value, and the “ok” result is false
  - closing a nil channel panics
  - operations on a nil channel block forever
  (spec: Channel types; Send statements; Receive operator; Built-in functions; Select statements)
- When reviewing correctness under concurrency, separate:
  - **Language semantics** (channels/select per spec)
  - **Memory ordering** (Go memory model; not the spec)

### Generics (type parameters)

- Check that constraints/type sets match the operations used (spec: Type parameters; Interface types).
- Watch for accidental acceptance/rejection due to `~T` (underlying type) and `comparable` (spec: Type sets; Comparison operators).
- Ensure type inference does not change API meaning; prefer explicit instantiation when inference is ambiguous (spec: Type inference; Calls).

### Packages and initialization

- Confirm package initialization order and side effects (spec: Program initialization and execution; Packages).
- Ensure `init()` work is minimal, deterministic, and not order-dependent across packages (spec: Program initialization and execution).

## “Unspecified / don’t rely on it” bucket (call out explicitly)

- Map iteration order (spec: Range clause).
- Choice among ready `select` cases (spec: Select statements).
- Timing/scheduling behavior between goroutines (not specified; see Go memory model + runtime docs).

---
name: conformance-audit
description: How improve's analyst judges artifacts against the conformance rules that have no deterministic check. Use for the improve audit `judge` step.
---
# Conformance audit (improve)

1. Your step plan lists the rules of framework/rules/conformance.yaml that have no deterministic check
   (`previous.detect.manual`) and the detector results. Judge the project against those rules only.
2. Read files with your file tools or your use shim: `artifacts.read/v1.files|graph|text '<json>'`.
3. Report a violation only with exact evidence: the rule id, file:line, the offending text, and a tightened
   rewrite or the change needed. Every cited file:line must exist.
4. Do not restate what a detector already found. Rules with no violation are not reported. One finding per
   distinct problem; no padding.
5. Report only: never edit, create or delete files.

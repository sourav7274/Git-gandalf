import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
let command = 'git diff --cached --unified=0'

const execAsync = promisify(exec);

async function getStagedChanges() {
  try {
    const { stdout, stderr } = await execAsync(command);
    if (stderr) {
      console.error("stderr:", stderr);
    }
    if (stdout) {
      return stdout;
    }
    return "There are no staged changes.";
  } catch (err) {
    console.error("error:", err.message);
    return null;
  }
}
const codeChanges = await getStagedChanges();
// console.log("Staged code changes:", codeChanges);

// Early exit if no changes - saves LLM call
if (codeChanges === "There are no staged changes.") {
  console.log("✅ No staged changes detected. Commit allowed.");
  process.exit(0);
}


// rules reading
async function readRules(path) {
  try{
    const data = await readFile(path, 'utf8');
    const parsedData = JSON.parse(data);
    return parsedData;
  }
  catch(err){
    console.error("Error reading rules file:", err);
    return [];
  }
}
const myRules = await readRules('rules.json');
// console.log("Loaded rules:", myRules.gitSafetyRules);  


// ------------------------------------
// RULE 0 ENFORCEMENT (JS-side, no LLM)
// ------------------------------------
function diffOnlyTouchesSafeFiles(diffText) {
  const touchedFiles = new Set();

  const lines = diffText.split("\n");
  for (const line of lines) {
    if (line.startsWith("+++ b/") || line.startsWith("--- a/")) {
      const file = line.slice(6).trim();
      if (file !== "/dev/null") {
        touchedFiles.add(file);
      }
    }
  }

  // Safety: if we cannot detect files, do NOT bypass LLM
  if (touchedFiles.size === 0) return false;

  for (const file of touchedFiles) {
    if (file !== "index.js" && file !== "rules.json") {
      return false;
    }
  }

  return true;
}
if (diffOnlyTouchesSafeFiles(codeChanges)) {
  console.log("✅ Commit ALLOWED: Only index.js or rules.json changed.");
  process.exit(0);
}




// llm call 
function formatRulesForLLM(rules) {
  return rules
    .map(r => `Rule: ${r.rule}\nDescription: ${r.description}\nSeverity: ${r.severity}`)
    .join('\n\n'); // double newline between rules
}

// Usage
const rulesText = formatRulesForLLM(myRules.gitSafetyRules);
// console.log(rulesText);

const response = await fetch(
  "http://127.0.0.1:1234/v1/chat/completions",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "local-model",
      stream: true,
      messages: [
        { role: "system",
          content: `
            /no_think
MODE: STRICT_JSON_ONLY

You are a Git pre-commit security validator.
You MUST behave like a deterministic machine, not a chat assistant.

ABSOLUTE PRIORITY RULE:
- Rule id 0 MUST be evaluated FIRST.
- If changes are ONLY in index.js or rules.json:
  → Immediately return PASS.
  → Do NOT analyze anything else.
  → Do NOT list any violations.

EVALUATION LOGIC:
1. Read the rules below.
2. Apply Rule id 0 first.
3. If Rule id 0 does not apply, evaluate remaining rules in ascending order.
4. IMPORTANT: The input is a git diff. Lines starting with + are ADDITIONS, lines starting with - are DELETIONS.
5. ONLY flag secrets in ADDED lines (lines starting with +). Deletions of secrets are SAFE and should be ALLOWED.
6. If a HIGH or CRITICAL rule is violated in ADDED lines:
   → Immediately return BLOCK.
   → Do NOT evaluate further rules.
7. Detect secrets ONLY from the actual staged diff content in ADDED lines.

OUTPUT RULES (NON-NEGOTIABLE):
- Output MUST be a SINGLE valid JSON object.
- Do NOT use markdown.
- Do NOT use code fences.
- Do NOT include explanations, reasoning, analysis, or comments.
- Do NOT include text before or after the JSON.
- Every JSON key MUST be followed by a comma EXCEPT the last one.
- If unsure about anything, verdict MUST be BLOCK.

JSON SCHEMA (MUST MATCH EXACTLY):
{
  "verdict": "PASS" | "BLOCK",
  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "summary": "string",
  "violations": [
    {
      "rule": "string",
      "description": "string",
      "files": ["string"],
      "lines": [number]
    }
  ]
}

CONSTRAINTS:
- If verdict is PASS → violations MUST be []
- If no violations → severity MUST be LOW
- Always return the JSON object. NOTHING ELSE.

RULES:
${rulesText}
          ` },
        { role: "user", 
          content: `Staged git diff:${codeChanges}
` }
      ]
    })
  }
);

// Stream handling
const reader = response.body.getReader();
const decoder = new TextDecoder("utf-8");
let fullText = "";
let buffer = "";

process.stdout.write("Analyzing changes...\n");

try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    // Decode chunk and append to buffer
    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;
    
    // Split buffer by newlines
    const lines = buffer.split('\n');
    
    // Keep the last segment in the buffer (it might be incomplete)
    buffer = lines.pop(); 
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
        try {
          const data = JSON.parse(trimmedLine.slice(6));
          const content = data.choices[0]?.delta?.content || "";
          process.stdout.write(content);
          fullText += content;
        } catch (e) {
          // ignore parse errors for partial chunks (shouldn't happen with buffering)
        }
      }
    }
  }
} catch (err) {
  console.error("Error reading stream:", err);
}

// -------------------------------
// JSON EXTRACTION (robust)
// -------------------------------

// 1. Try splitting by separator (allow variable length dashes)
const parts = fullText.split(/-{3,}/);
// Take the last part that contains a '{' (or just use fullText if no separator)
let jsonTextCandidate = fullText;
if (parts.length > 1) {
    for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].includes('{')) {
            jsonTextCandidate = parts[i];
            break;
        }
    }
}

// CLEANUP: Remove Markdown code blocks if present
jsonTextCandidate = jsonTextCandidate.replace(/```json/g, "").replace(/```/g, "");

// 2. Find JSON object within the candidate text
const jsonStart = jsonTextCandidate.indexOf("{");
if (jsonStart === -1) {
  console.error("\n❌ No JSON found in output. Blocking commit.");
  console.error("DEBUG: fullText was:", fullText);
  process.exit(1);
}

// Find matching closing brace
let braceCount = 0;
let jsonEnd = -1;
for (let i = jsonStart; i < jsonTextCandidate.length; i++) {
  if (jsonTextCandidate[i] === '{') braceCount++;
  if (jsonTextCandidate[i] === '}') braceCount--;
  if (braceCount === 0) {
    jsonEnd = i;
    break;
  }
}

if (jsonEnd === -1) {
  console.error("\n❌ No complete JSON found in output. Blocking commit.");
  process.exit(1);
}

let finalJsonText = jsonTextCandidate.slice(jsonStart, jsonEnd + 1);

// Remove comments from JSON (// ...)
finalJsonText = finalJsonText.replace(/\/\/.*$/gm, '');
// Remove trailing commas (simple case)
finalJsonText = finalJsonText.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

// ------------------------------------
// PARSE + VALIDATE FINAL JSON
// ------------------------------------
function parseAndValidateFinalJSON(jsonText) {
  let result;

  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    console.error("\n❌ Could not parse JSON at all:");
    console.error(jsonText);
    process.exit(1);
  }

  // Ensure summary exists
  if (!result.summary) {
      result.summary = "No summary provided by model.";
  }

  // Ensure severity exists
  if (!result.severity) {
      result.severity = "LOW";
  }

  // Ensure violations exists
  if (!result.violations) {
      result.violations = [];
  }

  // ✅ CASE 1: Fully valid schema
  const isValidFinalSchema =
    typeof result === "object" &&
    typeof result.verdict === "string" &&
    Array.isArray(result.violations);

  if (isValidFinalSchema) {
    result.verdict = result.verdict.toUpperCase();
    result.severity = result.severity.toUpperCase();

    if (!["PASS", "BLOCK"].includes(result.verdict)) {
      console.error("\n❌ Invalid verdict value:", result.verdict);
      process.exit(1);
    }

    return result;
  }

  // ⚠️ CASE 2: Looks like a single violation object
  const looksLikeViolation =
    typeof result === "object" &&
    (result.rule || result.description || result.files || result.lines);

  if (looksLikeViolation) {
    console.warn("\n⚠️ Partial LLM response detected. Wrapping into BLOCK.");

    return {
      verdict: "BLOCK",
      severity: "HIGH",
      summary: "Model returned an invalid response format. Treating as violation.",
      violations: [result]
    };
  }

  // ❌ CASE 3: Completely unrecognized structure
  console.error("\n❌ Unrecognized JSON structure from model:");
  console.error(result);
  process.exit(1);
}

// ------------------------------------
// EXECUTION
// ------------------------------------
const result = parseAndValidateFinalJSON(finalJsonText);

// ------------------------------------
// ACT BASED ON VERDICT
// ------------------------------------
if (result.verdict === "BLOCK") {
  console.error("\n🚫 Commit BLOCKED:", result.summary);
  process.exit(1);
}

if (result.verdict === "PASS") {
  console.log("\n✅ Commit ALLOWED:", result.summary);
  process.exit(0);
}

// ------------------------------------
// SAFETY FALLBACK (should never happen)
// ------------------------------------
console.error("\n❌ Unknown verdict. Blocking commit.");
process.exit(1);
